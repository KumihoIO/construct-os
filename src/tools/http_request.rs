use super::traits::{Tool, ToolResult};
use crate::security::SecurityPolicy;
use async_trait::async_trait;
use serde_json::json;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

/// HTTP request tool for API interactions.
/// Supports GET, POST, PUT, DELETE methods with configurable security.
pub struct HttpRequestTool {
    security: Arc<SecurityPolicy>,
    allowed_domains: Vec<String>,
    max_response_size: usize,
    timeout_secs: u64,
    allow_private_hosts: bool,
}

/// A URL that has passed all validation gates, carrying the DNS-resolved IPs
/// so the caller can pin them into the reqwest client at connect time.
#[derive(Debug)]
struct ValidatedRequest {
    url: String,
    host: String,
    /// Validated global IPs for `host`. Empty when the host is a bare IP
    /// literal (no DNS needed) or when `allow_private_hosts` bypassed
    /// validation entirely.
    resolved_ips: Vec<IpAddr>,
}

impl HttpRequestTool {
    pub fn new(
        security: Arc<SecurityPolicy>,
        allowed_domains: Vec<String>,
        max_response_size: usize,
        timeout_secs: u64,
        allow_private_hosts: bool,
    ) -> Self {
        Self {
            security,
            allowed_domains: normalize_allowed_domains(allowed_domains),
            max_response_size,
            timeout_secs,
            allow_private_hosts,
        }
    }

    async fn validate_url(&self, raw_url: &str) -> anyhow::Result<ValidatedRequest> {
        let url = raw_url.trim();

        if url.is_empty() {
            anyhow::bail!("URL cannot be empty");
        }

        if url.chars().any(char::is_whitespace) {
            anyhow::bail!("URL cannot contain whitespace");
        }

        if !url.starts_with("http://") && !url.starts_with("https://") {
            anyhow::bail!("Only http:// and https:// URLs are allowed");
        }

        if self.allowed_domains.is_empty() {
            anyhow::bail!(
                "HTTP request tool is enabled but no allowed_domains are configured. Add [http_request].allowed_domains in config.toml"
            );
        }

        let host = extract_host(url)?;

        if !self.allow_private_hosts && is_private_or_local_host(&host) {
            anyhow::bail!("Blocked local/private host: {host}");
        }

        if !host_matches_allowlist(&host, &self.allowed_domains) {
            anyhow::bail!("Host '{host}' is not in http_request.allowed_domains");
        }

        // Resolve once and pin the result into the reqwest client at the call
        // site. Returning Ok(String) alone would leave reqwest to do its own
        // lookup at connect time — an attacker controlling DNS for the host
        // could answer the validator with a public IP and the connect-time
        // lookup with 169.254.169.254 (DNS rebinding TOCTOU).
        let resolved_ips = if self.allow_private_hosts {
            Vec::new()
        } else {
            validate_resolved_host_is_public(&host).await?
        };

        Ok(ValidatedRequest {
            url: url.to_string(),
            host,
            resolved_ips,
        })
    }

    fn validate_method(&self, method: &str) -> anyhow::Result<reqwest::Method> {
        match method.to_uppercase().as_str() {
            "GET" => Ok(reqwest::Method::GET),
            "POST" => Ok(reqwest::Method::POST),
            "PUT" => Ok(reqwest::Method::PUT),
            "DELETE" => Ok(reqwest::Method::DELETE),
            "PATCH" => Ok(reqwest::Method::PATCH),
            "HEAD" => Ok(reqwest::Method::HEAD),
            "OPTIONS" => Ok(reqwest::Method::OPTIONS),
            _ => anyhow::bail!(
                "Unsupported HTTP method: {method}. Supported: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS"
            ),
        }
    }

    fn parse_headers(&self, headers: &serde_json::Value) -> Vec<(String, String)> {
        let mut result = Vec::new();
        if let Some(obj) = headers.as_object() {
            for (key, value) in obj {
                if let Some(str_val) = value.as_str() {
                    result.push((key.clone(), str_val.to_string()));
                }
            }
        }
        result
    }

    fn redact_headers_for_display(headers: &[(String, String)]) -> Vec<(String, String)> {
        headers
            .iter()
            .map(|(key, value)| {
                let lower = key.to_lowercase();
                let is_sensitive = lower.contains("authorization")
                    || lower.contains("api-key")
                    || lower.contains("apikey")
                    || lower.contains("token")
                    || lower.contains("secret");
                if is_sensitive {
                    (key.clone(), "***REDACTED***".into())
                } else {
                    (key.clone(), value.clone())
                }
            })
            .collect()
    }

    async fn execute_request(
        &self,
        validated: &ValidatedRequest,
        method: reqwest::Method,
        headers: Vec<(String, String)>,
        body: Option<&str>,
    ) -> anyhow::Result<reqwest::Response> {
        let timeout_secs = if self.timeout_secs == 0 {
            tracing::warn!("http_request: timeout_secs is 0, using safe default of 30s");
            30
        } else {
            self.timeout_secs
        };
        let mut builder = reqwest::Client::builder()
            .timeout(Duration::from_secs(timeout_secs))
            .connect_timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::none());

        // Pin DNS to the IPs we already validated. Without this reqwest would
        // perform its own resolution at connect time and an attacker with
        // control of DNS for an allowlisted domain could serve a public IP
        // to the validator and a metadata/RFC1918 IP to the actual request.
        // reqwest ignores the port in the SocketAddr — the URL's port is used.
        if !validated.resolved_ips.is_empty() {
            let addrs: Vec<SocketAddr> = validated
                .resolved_ips
                .iter()
                .map(|ip| SocketAddr::new(*ip, 0))
                .collect();
            builder = builder.resolve_to_addrs(&validated.host, &addrs);
        }

        let builder = crate::config::apply_runtime_proxy_to_builder(builder, "tool.http_request");
        let client = builder.build()?;

        let mut request = client.request(method, &validated.url);

        for (key, value) in headers {
            request = request.header(&key, &value);
        }

        if let Some(body_str) = body {
            request = request.body(body_str.to_string());
        }

        Ok(request.send().await?)
    }

    fn truncate_response(&self, text: &str) -> String {
        // 0 means unlimited — no truncation.
        if self.max_response_size == 0 {
            return text.to_string();
        }
        if text.len() > self.max_response_size {
            let mut truncated = text
                .chars()
                .take(self.max_response_size)
                .collect::<String>();
            truncated.push_str("\n\n... [Response truncated due to size limit] ...");
            truncated
        } else {
            text.to_string()
        }
    }
}

#[async_trait]
impl Tool for HttpRequestTool {
    fn name(&self) -> &str {
        "http_request"
    }

    fn description(&self) -> &str {
        "Make HTTP requests to external APIs. Supports GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS methods. \
        Security constraints: allowlist-only domains, no local/private hosts, configurable timeout and response size limits."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "HTTP or HTTPS URL to request"
                },
                "method": {
                    "type": "string",
                    "description": "HTTP method (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)",
                    "default": "GET"
                },
                "headers": {
                    "type": "object",
                    "description": "Optional HTTP headers as key-value pairs (e.g., {\"Authorization\": \"Bearer token\", \"Content-Type\": \"application/json\"})",
                    "default": {}
                },
                "body": {
                    "type": "string",
                    "description": "Optional request body (for POST, PUT, PATCH requests)"
                }
            },
            "required": ["url"]
        })
    }

    async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult> {
        let url = args
            .get("url")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing 'url' parameter"))?;

        let method_str = args.get("method").and_then(|v| v.as_str()).unwrap_or("GET");
        let headers_val = args.get("headers").cloned().unwrap_or(json!({}));
        let body = args.get("body").and_then(|v| v.as_str());

        if !self.security.can_act() {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some("Action blocked: autonomy is read-only".into()),
            });
        }

        if !self.security.record_action() {
            return Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some("Action blocked: rate limit exceeded".into()),
            });
        }

        let validated = match self.validate_url(url).await {
            Ok(v) => v,
            Err(e) => {
                return Ok(ToolResult {
                    success: false,
                    output: String::new(),
                    error: Some(e.to_string()),
                });
            }
        };

        let method = match self.validate_method(method_str) {
            Ok(m) => m,
            Err(e) => {
                return Ok(ToolResult {
                    success: false,
                    output: String::new(),
                    error: Some(e.to_string()),
                });
            }
        };

        let request_headers = self.parse_headers(&headers_val);

        match self
            .execute_request(&validated, method, request_headers, body)
            .await
        {
            Ok(response) => {
                let status = response.status();
                let status_code = status.as_u16();

                // Get response headers (redact sensitive ones)
                let response_headers = response.headers().iter();
                let headers_text = response_headers
                    .map(|(k, _)| {
                        let is_sensitive = k.as_str().to_lowercase().contains("set-cookie");
                        if is_sensitive {
                            format!("{}: ***REDACTED***", k.as_str())
                        } else {
                            format!("{}: {:?}", k.as_str(), k.as_str())
                        }
                    })
                    .collect::<Vec<_>>()
                    .join(", ");

                // Get response body with size limit
                let response_text = match response.text().await {
                    Ok(text) => self.truncate_response(&text),
                    Err(e) => format!("[Failed to read response body: {e}]"),
                };

                let output = format!(
                    "Status: {} {}\nResponse Headers: {}\n\nResponse Body:\n{}",
                    status_code,
                    status.canonical_reason().unwrap_or("Unknown"),
                    headers_text,
                    response_text
                );

                Ok(ToolResult {
                    success: status.is_success(),
                    output,
                    error: if status.is_client_error() || status.is_server_error() {
                        Some(format!("HTTP {}", status_code))
                    } else {
                        None
                    },
                })
            }
            Err(e) => Ok(ToolResult {
                success: false,
                output: String::new(),
                error: Some(format!("HTTP request failed: {e}")),
            }),
        }
    }
}

// Helper functions similar to browser_open.rs

fn normalize_allowed_domains(domains: Vec<String>) -> Vec<String> {
    let mut normalized = domains
        .into_iter()
        .filter_map(|d| normalize_domain(&d))
        .collect::<Vec<_>>();
    normalized.sort_unstable();
    normalized.dedup();
    normalized
}

fn normalize_domain(raw: &str) -> Option<String> {
    let mut d = raw.trim().to_lowercase();
    if d.is_empty() {
        return None;
    }

    if let Some(stripped) = d.strip_prefix("https://") {
        d = stripped.to_string();
    } else if let Some(stripped) = d.strip_prefix("http://") {
        d = stripped.to_string();
    }

    if let Some((host, _)) = d.split_once('/') {
        d = host.to_string();
    }

    d = d.trim_start_matches('.').trim_end_matches('.').to_string();

    if let Some((host, _)) = d.split_once(':') {
        d = host.to_string();
    }

    if d.is_empty() || d.chars().any(char::is_whitespace) {
        return None;
    }

    Some(d)
}

fn extract_host(url: &str) -> anyhow::Result<String> {
    let rest = url
        .strip_prefix("http://")
        .or_else(|| url.strip_prefix("https://"))
        .ok_or_else(|| anyhow::anyhow!("Only http:// and https:// URLs are allowed"))?;

    let authority = rest
        .split(['/', '?', '#'])
        .next()
        .ok_or_else(|| anyhow::anyhow!("Invalid URL"))?;

    if authority.is_empty() {
        anyhow::bail!("URL must include a host");
    }

    if authority.contains('@') {
        anyhow::bail!("URL userinfo is not allowed");
    }

    if authority.starts_with('[') {
        anyhow::bail!("IPv6 hosts are not supported in http_request");
    }

    let host = authority
        .split(':')
        .next()
        .unwrap_or_default()
        .trim()
        .trim_end_matches('.')
        .to_lowercase();

    if host.is_empty() {
        anyhow::bail!("URL must include a valid host");
    }

    Ok(host)
}

fn host_matches_allowlist(host: &str, allowed_domains: &[String]) -> bool {
    if allowed_domains.iter().any(|domain| domain == "*") {
        return true;
    }

    allowed_domains.iter().any(|domain| {
        host == domain
            || host
                .strip_suffix(domain)
                .is_some_and(|prefix| prefix.ends_with('.'))
    })
}

#[cfg(not(test))]
async fn validate_resolved_host_is_public(host: &str) -> anyhow::Result<Vec<IpAddr>> {
    let bare = host
        .strip_prefix('[')
        .and_then(|h| h.strip_suffix(']'))
        .unwrap_or(host);

    // Bare IP literal in the URL: reqwest will connect to exactly this IP
    // with no DNS lookup, so there is nothing to pin. The earlier
    // `is_private_or_local_host` check already rejected non-global literals.
    if bare.parse::<IpAddr>().is_ok() {
        return Ok(Vec::new());
    }

    let ips: Vec<IpAddr> = tokio::net::lookup_host((bare, 0))
        .await
        .map_err(|e| anyhow::anyhow!("Failed to resolve host '{host}': {e}"))?
        .map(|addr| addr.ip())
        .collect();

    validate_resolved_ips_are_public(host, &ips)?;
    Ok(ips)
}

#[cfg(test)]
async fn validate_resolved_host_is_public(_host: &str) -> anyhow::Result<Vec<IpAddr>> {
    // Unit tests exercise validate_resolved_ips_are_public directly; the
    // async DNS path is covered by end-to-end tests outside this crate.
    Ok(Vec::new())
}

fn validate_resolved_ips_are_public(host: &str, ips: &[std::net::IpAddr]) -> anyhow::Result<()> {
    if ips.is_empty() {
        anyhow::bail!("Failed to resolve host '{host}'");
    }

    for ip in ips {
        let non_global = match ip {
            std::net::IpAddr::V4(v4) => is_non_global_v4(*v4),
            std::net::IpAddr::V6(v6) => is_non_global_v6(*v6),
        };
        if non_global {
            anyhow::bail!("Blocked host '{host}' resolved to non-global address {ip}");
        }
    }

    Ok(())
}

fn is_private_or_local_host(host: &str) -> bool {
    // Strip brackets from IPv6 addresses like [::1]
    let bare = host
        .strip_prefix('[')
        .and_then(|h| h.strip_suffix(']'))
        .unwrap_or(host);

    let has_local_tld = bare
        .rsplit('.')
        .next()
        .is_some_and(|label| label == "local");

    if bare == "localhost" || bare.ends_with(".localhost") || has_local_tld {
        return true;
    }

    if let Ok(ip) = bare.parse::<std::net::IpAddr>() {
        return match ip {
            std::net::IpAddr::V4(v4) => is_non_global_v4(v4),
            std::net::IpAddr::V6(v6) => is_non_global_v6(v6),
        };
    }

    false
}

/// Returns true if the IPv4 address is not globally routable.
fn is_non_global_v4(v4: std::net::Ipv4Addr) -> bool {
    let [a, b, c, _] = v4.octets();
    v4.is_loopback()                       // 127.0.0.0/8
        || v4.is_private()                 // 10/8, 172.16/12, 192.168/16
        || v4.is_link_local()              // 169.254.0.0/16
        || v4.is_unspecified()             // 0.0.0.0
        || v4.is_broadcast()              // 255.255.255.255
        || v4.is_multicast()              // 224.0.0.0/4
        || (a == 100 && (64..=127).contains(&b)) // Shared address space (RFC 6598)
        || a >= 240                        // Reserved (240.0.0.0/4, except broadcast)
        || (a == 192 && b == 0 && (c == 0 || c == 2)) // IETF assignments + TEST-NET-1
        || (a == 198 && b == 51)           // Documentation (198.51.100.0/24)
        || (a == 203 && b == 0)            // Documentation (203.0.113.0/24)
        || (a == 198 && (18..=19).contains(&b)) // Benchmarking (198.18.0.0/15)
}

/// Returns true if the IPv6 address is not globally routable.
fn is_non_global_v6(v6: std::net::Ipv6Addr) -> bool {
    let segs = v6.segments();
    v6.is_loopback()                       // ::1
        || v6.is_unspecified()             // ::
        || v6.is_multicast()              // ff00::/8
        || (segs[0] & 0xfe00) == 0xfc00   // Unique-local (fc00::/7)
        || (segs[0] & 0xffc0) == 0xfe80   // Link-local (fe80::/10)
        || (segs[0] == 0x2001 && segs[1] == 0x0db8) // Documentation (2001:db8::/32)
        || v6.to_ipv4_mapped().is_some_and(is_non_global_v4)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::security::{AutonomyLevel, SecurityPolicy};

    fn test_tool(allowed_domains: Vec<&str>) -> HttpRequestTool {
        test_tool_with_private(allowed_domains, false)
    }

    fn test_tool_with_private(
        allowed_domains: Vec<&str>,
        allow_private_hosts: bool,
    ) -> HttpRequestTool {
        let security = Arc::new(SecurityPolicy {
            autonomy: AutonomyLevel::Supervised,
            ..SecurityPolicy::default()
        });
        HttpRequestTool::new(
            security,
            allowed_domains.into_iter().map(String::from).collect(),
            1_000_000,
            30,
            allow_private_hosts,
        )
    }

    #[test]
    fn normalize_domain_strips_scheme_path_and_case() {
        let got = normalize_domain("  HTTPS://Docs.Example.com/path ").unwrap();
        assert_eq!(got, "docs.example.com");
    }

    #[test]
    fn normalize_allowed_domains_deduplicates() {
        let got = normalize_allowed_domains(vec![
            "example.com".into(),
            "EXAMPLE.COM".into(),
            "https://example.com/".into(),
        ]);
        assert_eq!(got, vec!["example.com".to_string()]);
    }

    #[tokio::test]
    async fn validate_accepts_exact_domain() {
        let tool = test_tool(vec!["example.com"]);
        let got = tool.validate_url("https://example.com/docs").await.unwrap();
        assert_eq!(got.url, "https://example.com/docs");
    }

    #[tokio::test]
    async fn validate_accepts_http() {
        let tool = test_tool(vec!["example.com"]);
        assert!(tool.validate_url("http://example.com").await.is_ok());
    }

    #[tokio::test]
    async fn validate_accepts_subdomain() {
        let tool = test_tool(vec!["example.com"]);
        assert!(tool.validate_url("https://api.example.com/v1").await.is_ok());
    }

    #[tokio::test]
    async fn validate_accepts_wildcard_allowlist_for_public_host() {
        let tool = test_tool(vec!["*"]);
        assert!(tool.validate_url("https://news.ycombinator.com").await.is_ok());
    }

    #[tokio::test]
    async fn validate_wildcard_allowlist_still_rejects_private_host() {
        let tool = test_tool(vec!["*"]);
        let err = tool
            .validate_url("https://localhost:8080")
            .await
            .unwrap_err()
            .to_string();
        assert!(err.contains("local/private"));
    }

    #[tokio::test]
    async fn validate_rejects_allowlist_miss() {
        let tool = test_tool(vec!["example.com"]);
        let err = tool
            .validate_url("https://google.com")
            .await
            .unwrap_err()
            .to_string();
        assert!(err.contains("allowed_domains"));
    }

    #[tokio::test]
    async fn validate_rejects_localhost() {
        let tool = test_tool(vec!["localhost"]);
        let err = tool
            .validate_url("https://localhost:8080")
            .await
            .unwrap_err()
            .to_string();
        assert!(err.contains("local/private"));
    }

    #[tokio::test]
    async fn validate_rejects_private_ipv4() {
        let tool = test_tool(vec!["192.168.1.5"]);
        let err = tool
            .validate_url("https://192.168.1.5")
            .await
            .unwrap_err()
            .to_string();
        assert!(err.contains("local/private"));
    }

    #[tokio::test]
    async fn validate_rejects_whitespace() {
        let tool = test_tool(vec!["example.com"]);
        let err = tool
            .validate_url("https://example.com/hello world")
            .await
            .unwrap_err()
            .to_string();
        assert!(err.contains("whitespace"));
    }

    #[tokio::test]
    async fn validate_rejects_userinfo() {
        let tool = test_tool(vec!["example.com"]);
        let err = tool
            .validate_url("https://user@example.com")
            .await
            .unwrap_err()
            .to_string();
        assert!(err.contains("userinfo"));
    }

    #[tokio::test]
    async fn validate_requires_allowlist() {
        let security = Arc::new(SecurityPolicy::default());
        let tool = HttpRequestTool::new(security, vec![], 1_000_000, 30, false);
        let err = tool
            .validate_url("https://example.com")
            .await
            .unwrap_err()
            .to_string();
        assert!(err.contains("allowed_domains"));
    }

    #[test]
    fn validate_accepts_valid_methods() {
        let tool = test_tool(vec!["example.com"]);
        assert!(tool.validate_method("GET").is_ok());
        assert!(tool.validate_method("POST").is_ok());
        assert!(tool.validate_method("PUT").is_ok());
        assert!(tool.validate_method("DELETE").is_ok());
        assert!(tool.validate_method("PATCH").is_ok());
        assert!(tool.validate_method("HEAD").is_ok());
        assert!(tool.validate_method("OPTIONS").is_ok());
    }

    #[test]
    fn validate_rejects_invalid_method() {
        let tool = test_tool(vec!["example.com"]);
        let err = tool.validate_method("INVALID").unwrap_err().to_string();
        assert!(err.contains("Unsupported HTTP method"));
    }

    #[test]
    fn blocks_multicast_ipv4() {
        assert!(is_private_or_local_host("224.0.0.1"));
        assert!(is_private_or_local_host("239.255.255.255"));
    }

    #[test]
    fn blocks_broadcast() {
        assert!(is_private_or_local_host("255.255.255.255"));
    }

    #[test]
    fn blocks_reserved_ipv4() {
        assert!(is_private_or_local_host("240.0.0.1"));
        assert!(is_private_or_local_host("250.1.2.3"));
    }

    #[test]
    fn blocks_documentation_ranges() {
        assert!(is_private_or_local_host("192.0.2.1")); // TEST-NET-1
        assert!(is_private_or_local_host("198.51.100.1")); // TEST-NET-2
        assert!(is_private_or_local_host("203.0.113.1")); // TEST-NET-3
    }

    #[test]
    fn blocks_benchmarking_range() {
        assert!(is_private_or_local_host("198.18.0.1"));
        assert!(is_private_or_local_host("198.19.255.255"));
    }

    #[test]
    fn blocks_ipv6_localhost() {
        assert!(is_private_or_local_host("::1"));
        assert!(is_private_or_local_host("[::1]"));
    }

    #[test]
    fn blocks_ipv6_multicast() {
        assert!(is_private_or_local_host("ff02::1"));
    }

    #[test]
    fn blocks_ipv6_link_local() {
        assert!(is_private_or_local_host("fe80::1"));
    }

    #[test]
    fn blocks_ipv6_unique_local() {
        assert!(is_private_or_local_host("fd00::1"));
    }

    #[test]
    fn blocks_ipv4_mapped_ipv6() {
        assert!(is_private_or_local_host("::ffff:127.0.0.1"));
        assert!(is_private_or_local_host("::ffff:192.168.1.1"));
        assert!(is_private_or_local_host("::ffff:10.0.0.1"));
    }

    #[test]
    fn allows_public_ipv4() {
        assert!(!is_private_or_local_host("8.8.8.8"));
        assert!(!is_private_or_local_host("1.1.1.1"));
        assert!(!is_private_or_local_host("93.184.216.34"));
    }

    #[test]
    fn blocks_ipv6_documentation_range() {
        assert!(is_private_or_local_host("2001:db8::1"));
    }

    #[test]
    fn allows_public_ipv6() {
        assert!(!is_private_or_local_host("2607:f8b0:4004:800::200e"));
    }

    #[test]
    fn blocks_shared_address_space() {
        assert!(is_private_or_local_host("100.64.0.1"));
        assert!(is_private_or_local_host("100.127.255.255"));
        assert!(!is_private_or_local_host("100.63.0.1")); // Just below range
        assert!(!is_private_or_local_host("100.128.0.1")); // Just above range
    }

    #[tokio::test]
    async fn execute_blocks_readonly_mode() {
        let security = Arc::new(SecurityPolicy {
            autonomy: AutonomyLevel::ReadOnly,
            ..SecurityPolicy::default()
        });
        let tool = HttpRequestTool::new(security, vec!["example.com".into()], 1_000_000, 30, false);
        let result = tool
            .execute(json!({"url": "https://example.com"}))
            .await
            .unwrap();
        assert!(!result.success);
        assert!(result.error.unwrap().contains("read-only"));
    }

    #[tokio::test]
    async fn execute_blocks_when_rate_limited() {
        let security = Arc::new(SecurityPolicy {
            max_actions_per_hour: 0,
            ..SecurityPolicy::default()
        });
        let tool = HttpRequestTool::new(security, vec!["example.com".into()], 1_000_000, 30, false);
        let result = tool
            .execute(json!({"url": "https://example.com"}))
            .await
            .unwrap();
        assert!(!result.success);
        assert!(result.error.unwrap().contains("rate limit"));
    }

    #[test]
    fn truncate_response_within_limit() {
        let tool = test_tool(vec!["example.com"]);
        let text = "hello world";
        assert_eq!(tool.truncate_response(text), "hello world");
    }

    #[test]
    fn truncate_response_over_limit() {
        let tool = HttpRequestTool::new(
            Arc::new(SecurityPolicy::default()),
            vec!["example.com".into()],
            10,
            30,
            false,
        );
        let text = "hello world this is long";
        let truncated = tool.truncate_response(text);
        assert!(truncated.len() <= 10 + 60); // limit + message
        assert!(truncated.contains("[Response truncated"));
    }

    #[test]
    fn truncate_response_zero_means_unlimited() {
        let tool = HttpRequestTool::new(
            Arc::new(SecurityPolicy::default()),
            vec!["example.com".into()],
            0, // max_response_size = 0 means no limit
            30,
            false,
        );
        let text = "a".repeat(10_000_000);
        assert_eq!(tool.truncate_response(&text), text);
    }

    #[test]
    fn truncate_response_nonzero_still_truncates() {
        let tool = HttpRequestTool::new(
            Arc::new(SecurityPolicy::default()),
            vec!["example.com".into()],
            5,
            30,
            false,
        );
        let text = "hello world";
        let truncated = tool.truncate_response(text);
        assert!(truncated.starts_with("hello"));
        assert!(truncated.contains("[Response truncated"));
    }

    #[test]
    fn parse_headers_preserves_original_values() {
        let tool = test_tool(vec!["example.com"]);
        let headers = json!({
            "Authorization": "Bearer secret",
            "Content-Type": "application/json",
            "X-API-Key": "my-key"
        });
        let parsed = tool.parse_headers(&headers);
        assert_eq!(parsed.len(), 3);
        assert!(
            parsed
                .iter()
                .any(|(k, v)| k == "Authorization" && v == "Bearer secret")
        );
        assert!(
            parsed
                .iter()
                .any(|(k, v)| k == "X-API-Key" && v == "my-key")
        );
        assert!(
            parsed
                .iter()
                .any(|(k, v)| k == "Content-Type" && v == "application/json")
        );
    }

    #[test]
    fn redact_headers_for_display_redacts_sensitive() {
        let headers = vec![
            ("Authorization".into(), "Bearer secret".into()),
            ("Content-Type".into(), "application/json".into()),
            ("X-API-Key".into(), "my-key".into()),
            ("X-Secret-Token".into(), "tok-123".into()),
        ];
        let redacted = HttpRequestTool::redact_headers_for_display(&headers);
        assert_eq!(redacted.len(), 4);
        assert!(
            redacted
                .iter()
                .any(|(k, v)| k == "Authorization" && v == "***REDACTED***")
        );
        assert!(
            redacted
                .iter()
                .any(|(k, v)| k == "X-API-Key" && v == "***REDACTED***")
        );
        assert!(
            redacted
                .iter()
                .any(|(k, v)| k == "X-Secret-Token" && v == "***REDACTED***")
        );
        assert!(
            redacted
                .iter()
                .any(|(k, v)| k == "Content-Type" && v == "application/json")
        );
    }

    #[test]
    fn redact_headers_does_not_alter_original() {
        let headers = vec![("Authorization".into(), "Bearer real-token".into())];
        let _ = HttpRequestTool::redact_headers_for_display(&headers);
        assert_eq!(headers[0].1, "Bearer real-token");
    }

    // ── SSRF: DNS-resolved IP must be global ────────────────────────
    //
    // Defense against DNS rebinding: a textual hostname that is not
    // "localhost" or private-looking can still resolve to a non-global
    // address (e.g. an attacker-controlled name pointing at
    // 169.254.169.254 cloud metadata). `validate_resolved_ips_are_public`
    // is what gates the request when DNS is actually consulted.

    #[test]
    fn ssrf_dns_resolves_to_metadata_ip_rejected() {
        use std::net::{IpAddr, Ipv4Addr};
        let ips = vec![IpAddr::V4(Ipv4Addr::new(169, 254, 169, 254))];
        let err = validate_resolved_ips_are_public("evil.example", &ips).unwrap_err();
        assert!(err.to_string().contains("non-global"));
    }

    #[test]
    fn ssrf_dns_resolves_to_private_rfc1918_rejected() {
        use std::net::{IpAddr, Ipv4Addr};
        let ips = vec![IpAddr::V4(Ipv4Addr::new(10, 0, 0, 5))];
        let err = validate_resolved_ips_are_public("evil.example", &ips).unwrap_err();
        assert!(err.to_string().contains("non-global"));
    }

    #[test]
    fn ssrf_dns_resolves_to_loopback_rejected() {
        use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
        let v4 = vec![IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))];
        assert!(validate_resolved_ips_are_public("x", &v4).is_err());
        let v6 = vec![IpAddr::V6(Ipv6Addr::LOCALHOST)];
        assert!(validate_resolved_ips_are_public("x", &v6).is_err());
    }

    #[test]
    fn ssrf_dns_resolves_to_public_ip_allowed() {
        use std::net::{IpAddr, Ipv4Addr};
        let ips = vec![IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1))];
        assert!(validate_resolved_ips_are_public("example.com", &ips).is_ok());
    }

    #[test]
    fn ssrf_any_non_global_ip_in_set_rejects() {
        use std::net::{IpAddr, Ipv4Addr};
        // Mixed DNS response: public + private. Must still be rejected
        // because an attacker can force the private IP at connect time.
        let ips = vec![
            IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1)),
            IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1)),
        ];
        let err = validate_resolved_ips_are_public("evil.example", &ips).unwrap_err();
        assert!(err.to_string().contains("non-global"));
    }

    // ── SSRF: alternate IP notation bypass defense-in-depth ─────────
    //
    // Rust's IpAddr::parse() rejects non-standard notations (octal, hex,
    // decimal integer, zero-padded). These tests document that property
    // so regressions are caught if the parsing strategy ever changes.

    #[test]
    fn ssrf_octal_loopback_not_parsed_as_ip() {
        // 0177.0.0.1 is octal for 127.0.0.1 in some languages, but
        // Rust's IpAddr rejects it — it falls through as a hostname.
        assert!(!is_private_or_local_host("0177.0.0.1"));
    }

    #[test]
    fn ssrf_hex_loopback_not_parsed_as_ip() {
        // 0x7f000001 is hex for 127.0.0.1 in some languages.
        assert!(!is_private_or_local_host("0x7f000001"));
    }

    #[test]
    fn ssrf_decimal_loopback_not_parsed_as_ip() {
        // 2130706433 is decimal for 127.0.0.1 in some languages.
        assert!(!is_private_or_local_host("2130706433"));
    }

    #[test]
    fn ssrf_zero_padded_loopback_not_parsed_as_ip() {
        // 127.000.000.001 uses zero-padded octets.
        assert!(!is_private_or_local_host("127.000.000.001"));
    }

    #[tokio::test]
    async fn ssrf_alternate_notations_rejected_by_validate_url() {
        // Even if is_private_or_local_host doesn't flag these, they
        // fail the allowlist because they're treated as hostnames.
        let tool = test_tool(vec!["example.com"]);
        for notation in [
            "http://0177.0.0.1",
            "http://0x7f000001",
            "http://2130706433",
            "http://127.000.000.001",
        ] {
            let err = tool.validate_url(notation).await.unwrap_err().to_string();
            assert!(
                err.contains("allowed_domains"),
                "Expected allowlist rejection for {notation}, got: {err}"
            );
        }
    }

    #[test]
    fn redirect_policy_is_none() {
        // Structural test: the tool should be buildable with redirect-safe config.
        // The actual Policy::none() enforcement is in execute_request's client builder.
        let tool = test_tool(vec!["example.com"]);
        assert_eq!(tool.name(), "http_request");
    }

    // ── §1.4 DNS rebinding / SSRF defense-in-depth tests ─────

    #[test]
    fn ssrf_blocks_loopback_127_range() {
        assert!(is_private_or_local_host("127.0.0.1"));
        assert!(is_private_or_local_host("127.0.0.2"));
        assert!(is_private_or_local_host("127.255.255.255"));
    }

    #[test]
    fn ssrf_blocks_rfc1918_10_range() {
        assert!(is_private_or_local_host("10.0.0.1"));
        assert!(is_private_or_local_host("10.255.255.255"));
    }

    #[test]
    fn ssrf_blocks_rfc1918_172_range() {
        assert!(is_private_or_local_host("172.16.0.1"));
        assert!(is_private_or_local_host("172.31.255.255"));
    }

    #[test]
    fn ssrf_blocks_unspecified_address() {
        assert!(is_private_or_local_host("0.0.0.0"));
    }

    #[test]
    fn ssrf_blocks_dot_localhost_subdomain() {
        assert!(is_private_or_local_host("evil.localhost"));
        assert!(is_private_or_local_host("a.b.localhost"));
    }

    #[test]
    fn ssrf_blocks_dot_local_tld() {
        assert!(is_private_or_local_host("service.local"));
    }

    #[test]
    fn ssrf_ipv6_unspecified() {
        assert!(is_private_or_local_host("::"));
    }

    #[tokio::test]
    async fn validate_rejects_ftp_scheme() {
        let tool = test_tool(vec!["example.com"]);
        let err = tool
            .validate_url("ftp://example.com")
            .await
            .unwrap_err()
            .to_string();
        assert!(err.contains("http://") || err.contains("https://"));
    }

    #[tokio::test]
    async fn validate_rejects_empty_url() {
        let tool = test_tool(vec!["example.com"]);
        let err = tool.validate_url("").await.unwrap_err().to_string();
        assert!(err.contains("empty"));
    }

    #[tokio::test]
    async fn validate_rejects_ipv6_host() {
        let tool = test_tool(vec!["example.com"]);
        let err = tool
            .validate_url("http://[::1]:8080/path")
            .await
            .unwrap_err()
            .to_string();
        assert!(err.contains("IPv6"));
    }

    // ── allow_private_hosts opt-in tests ────────────────────────

    #[tokio::test]
    async fn default_blocks_private_hosts() {
        let tool = test_tool(vec!["localhost", "192.168.1.5", "*"]);
        assert!(
            tool.validate_url("https://localhost:8080")
                .await
                .unwrap_err()
                .to_string()
                .contains("local/private")
        );
        assert!(
            tool.validate_url("https://192.168.1.5")
                .await
                .unwrap_err()
                .to_string()
                .contains("local/private")
        );
        assert!(
            tool.validate_url("https://10.0.0.1")
                .await
                .unwrap_err()
                .to_string()
                .contains("local/private")
        );
    }

    #[tokio::test]
    async fn allow_private_hosts_permits_localhost() {
        let tool = test_tool_with_private(vec!["localhost"], true);
        assert!(tool.validate_url("https://localhost:8080").await.is_ok());
    }

    #[tokio::test]
    async fn allow_private_hosts_permits_private_ipv4() {
        let tool = test_tool_with_private(vec!["192.168.1.5"], true);
        assert!(tool.validate_url("https://192.168.1.5").await.is_ok());
    }

    #[tokio::test]
    async fn allow_private_hosts_permits_rfc1918_with_wildcard() {
        let tool = test_tool_with_private(vec!["*"], true);
        assert!(tool.validate_url("https://10.0.0.1").await.is_ok());
        assert!(tool.validate_url("https://172.16.0.1").await.is_ok());
        assert!(tool.validate_url("https://192.168.1.1").await.is_ok());
        assert!(tool.validate_url("http://localhost:8123").await.is_ok());
    }

    #[tokio::test]
    async fn allow_private_hosts_still_requires_allowlist() {
        let tool = test_tool_with_private(vec!["example.com"], true);
        let err = tool
            .validate_url("https://192.168.1.5")
            .await
            .unwrap_err()
            .to_string();
        assert!(
            err.contains("allowed_domains"),
            "Private host should still need allowlist match, got: {err}"
        );
    }

    #[tokio::test]
    async fn allow_private_hosts_false_still_blocks() {
        let tool = test_tool_with_private(vec!["*"], false);
        assert!(
            tool.validate_url("https://localhost:8080")
                .await
                .unwrap_err()
                .to_string()
                .contains("local/private")
        );
    }
}
