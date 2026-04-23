//! Generic Kumiho API proxy — forwards `/api/kumiho/*` requests to the
//! upstream Kumiho FastAPI server, injecting the service token and remapping
//! auth errors so they don't trigger browser re-pairing.

use super::AppState;
use super::api::require_auth;
use super::api_agents::build_kumiho_client;
use axum::{
    Json,
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use std::collections::HashMap;

/// GET /api/kumiho/{*path} — proxy any GET request to Kumiho API.
///
/// The browser sends `/api/kumiho/projects` and this handler forwards it
/// to `{kumiho_api_url}/api/v1/projects` with the service token header.
/// Query parameters are forwarded as-is.
pub async fn handle_kumiho_proxy(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(path): axum::extract::Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    let client = build_kumiho_client(&state);
    let base_url = {
        let config = state.config.lock();
        config.kumiho.api_url.clone()
    };
    let service_token = std::env::var("KUMIHO_SERVICE_TOKEN").unwrap_or_default();

    // Build the upstream URL
    let mut url = format!("{}/api/v1/{}", base_url.trim_end_matches('/'), path);
    if !params.is_empty() {
        let qs: Vec<String> = params
            .iter()
            .map(|(k, v)| format!("{}={}", urlencoding::encode(k), urlencoding::encode(v)))
            .collect();
        url = format!("{}?{}", url, qs.join("&"));
    }

    // Forward the request
    let resp = client
        .client()
        .get(&url)
        .header("X-Kumiho-Token", &service_token)
        .send()
        .await;

    match resp {
        Ok(r) => {
            let status = r.status().as_u16();
            let body = r.text().await.unwrap_or_default();

            // Remap 401/403 to 502 so browser doesn't clear pairing token
            let code = if status == 401 || status == 403 {
                StatusCode::BAD_GATEWAY
            } else {
                StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY)
            };

            if code.is_success() {
                // Forward the JSON body as-is
                (
                    code,
                    [(axum::http::header::CONTENT_TYPE, "application/json")],
                    body,
                )
                    .into_response()
            } else {
                (
                    code,
                    Json(serde_json::json!({ "error": format!("Kumiho upstream: {body}") })),
                )
                    .into_response()
            }
        }
        Err(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "error": format!("Kumiho service unavailable: {e}") })),
        )
            .into_response(),
    }
}
