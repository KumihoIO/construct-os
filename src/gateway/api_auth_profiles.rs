//! REST API handlers for auth-profile dropdown surface.
//!
//! Two endpoints:
//!   - `GET /api/auth/profiles` — bearer-auth — lists profile metadata
//!     for the editor dropdown. **Token bytes never appear in the response.**
//!   - `POST /api/auth/profiles/{id}/resolve` — service-token-auth —
//!     decrypts and returns the bound credential for a single profile.
//!     Used only by the operator-mcp runtime at step-execution time.
//!
//! The actual encryption + storage lives in `crate::auth::profiles::AuthProfilesStore`
//! (ChaCha20-Poly1305 AEAD via `crate::security::SecretStore`). This module is a
//! thin readonly view over that store.

use super::AppState;
use super::api::require_auth;
use crate::auth::profiles::AuthProfileKind;
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Json},
};
use chrono::{DateTime, Utc};
use serde::Serialize;

const SERVICE_TOKEN_HEADER: &str = "X-Construct-Service-Token";

// ── Response shapes ─────────────────────────────────────────────────────

/// Metadata-only profile summary returned from `GET /api/auth/profiles`.
///
/// **Audit point:** confirm by code-read that this struct contains no token,
/// access_token, refresh_token, id_token, or any other decrypted material —
/// only display metadata + safe lifecycle hints.
#[derive(Serialize, Clone)]
pub struct AuthProfileSummary {
    pub id: String,
    pub provider: String,
    pub profile_name: String,
    /// "oauth" or "token".
    pub kind: String,
    pub account_id: Option<String>,
    pub workspace_id: Option<String>,
    /// OAuth profiles only — used by the editor to show expiry chips.
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Resolved credential — only ever returned from the service-token-gated
/// resolve endpoint. **Never serialized into list responses or YAML.**
#[derive(Serialize)]
pub struct ResolvedAuth {
    pub token: String,
    /// "oauth" or "token".
    pub kind: String,
    pub provider: String,
    pub profile_name: String,
    pub expires_at: Option<DateTime<Utc>>,
}

// ── List handler ────────────────────────────────────────────────────────

/// `GET /api/auth/profiles` — bearer-auth, metadata-only listing.
pub async fn handle_list_auth_profiles(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    let Some(store) = state.auth_profiles.as_ref() else {
        // Auth profile store not configured — return empty list rather than 500.
        return Json(serde_json::json!({ "profiles": [] })).into_response();
    };

    let data = match store.load().await {
        Ok(d) => d,
        Err(err) => {
            tracing::warn!(error = %err, "auth-profiles list failed");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Failed to load auth profiles" })),
            )
                .into_response();
        }
    };

    let mut profiles: Vec<AuthProfileSummary> = data
        .profiles
        .into_values()
        .map(|p| AuthProfileSummary {
            id: p.id,
            provider: p.provider,
            profile_name: p.profile_name,
            kind: match p.kind {
                AuthProfileKind::OAuth => "oauth".to_string(),
                AuthProfileKind::Token => "token".to_string(),
            },
            account_id: p.account_id,
            workspace_id: p.workspace_id,
            expires_at: p.token_set.as_ref().and_then(|t| t.expires_at),
            created_at: p.created_at,
            updated_at: p.updated_at,
        })
        .collect();
    profiles.sort_by(|a, b| {
        a.provider
            .cmp(&b.provider)
            .then_with(|| a.profile_name.cmp(&b.profile_name))
    });

    Json(serde_json::json!({ "profiles": profiles })).into_response()
}

// ── Resolve handler ─────────────────────────────────────────────────────

fn require_service_token(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let provided = headers
        .get(SERVICE_TOKEN_HEADER)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let expected = state.service_token.as_ref();
    if expected.is_empty() {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "error": "service token not configured on this gateway"
            })),
        ));
    }
    // Constant-time compare to dodge timing oracles even though both bytes
    // are local — same posture the rest of the gateway uses for shared secrets.
    if crate::security::pairing::constant_time_eq(provided, expected) {
        Ok(())
    } else {
        Err((
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({
                "error": "missing or invalid X-Construct-Service-Token header"
            })),
        ))
    }
}

/// `POST /api/auth/profiles/{id}/resolve` — service-token only.
///
/// Loads the named profile, returns the decrypted credential. 404 if the
/// profile doesn't exist; 410 Gone for OAuth profiles whose `expires_at` is
/// in the past (the runtime should fail the step rather than silently send
/// a stale token).
pub async fn handle_resolve_auth_profile(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if let Err(e) = require_service_token(&state, &headers) {
        return e.into_response();
    }

    let Some(store) = state.auth_profiles.as_ref() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "error": "auth profile store not configured",
                "code": "auth_store_unavailable"
            })),
        )
            .into_response();
    };

    let data = match store.load().await {
        Ok(d) => d,
        Err(err) => {
            tracing::warn!(error = %err, "auth-profile resolve: load failed");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": "Failed to load auth profiles",
                    "code": "auth_store_load_failed"
                })),
            )
                .into_response();
        }
    };

    let Some(profile) = data.profiles.get(&id) else {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "error": format!("auth profile not found: {id}"),
                "code": "auth_profile_not_found"
            })),
        )
            .into_response();
    };

    match profile.kind {
        AuthProfileKind::Token => {
            let token = profile
                .token
                .clone()
                .filter(|t| !t.trim().is_empty())
                .unwrap_or_default();
            if token.is_empty() {
                return (
                    StatusCode::GONE,
                    Json(serde_json::json!({
                        "error": "auth profile is empty",
                        "code": "auth_profile_empty"
                    })),
                )
                    .into_response();
            }
            // Avoid the X-Construct-Service-Token bouncing back into proxies'
            // shared cache layers.
            let mut resp = Json(ResolvedAuth {
                token,
                kind: "token".into(),
                provider: profile.provider.clone(),
                profile_name: profile.profile_name.clone(),
                expires_at: None,
            })
            .into_response();
            resp.headers_mut()
                .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
            resp
        }
        AuthProfileKind::OAuth => {
            let Some(token_set) = profile.token_set.as_ref() else {
                return (
                    StatusCode::GONE,
                    Json(serde_json::json!({
                        "error": "OAuth profile missing token_set",
                        "code": "auth_profile_missing_tokens"
                    })),
                )
                    .into_response();
            };
            // Already-expired? 410 Gone — the runtime should classify this as
            // auth_resolve_failed with the structured reason.
            if let Some(expires_at) = token_set.expires_at {
                if expires_at <= Utc::now() {
                    return (
                        StatusCode::GONE,
                        Json(serde_json::json!({
                            "error": "OAuth profile expired",
                            "code": "auth_profile_expired",
                            "expired_at": expires_at,
                        })),
                    )
                        .into_response();
                }
            }
            let mut resp = Json(ResolvedAuth {
                token: token_set.access_token.clone(),
                kind: "oauth".into(),
                provider: profile.provider.clone(),
                profile_name: profile.profile_name.clone(),
                expires_at: token_set.expires_at,
            })
            .into_response();
            resp.headers_mut()
                .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
            resp
        }
    }
}
