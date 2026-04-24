//! Serves the raw bytes of a Kumiho artifact's underlying local file.
//!
//! The `/api/artifact-body?location=<path>` endpoint reads a file from the
//! local filesystem (the artifact's `location` as stored in Kumiho) and
//! streams it back with a best-effort Content-Type. Required so the web
//! Asset Browser and Workflow Runs viewers can render text / images /
//! video artifacts without each viewer re-implementing file IO.

use super::AppState;
use super::api::require_auth;
use axum::{
    Json,
    extract::{Query, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use std::path::{Path, PathBuf};

const MAX_ARTIFACT_BYTES: u64 = 256 * 1024 * 1024; // 256 MiB

#[derive(Deserialize)]
pub struct ArtifactBodyQuery {
    pub location: String,
}

pub async fn handle_artifact_body(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<ArtifactBodyQuery>,
) -> Response {
    if let Err(e) = require_auth(&state, &headers) {
        return e.into_response();
    }

    let path = match resolve_location(&q.location) {
        Ok(p) => p,
        Err(msg) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": msg })),
            )
                .into_response();
        }
    };

    let meta = match tokio::fs::metadata(&path).await {
        Ok(m) => m,
        Err(e) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({
                    "error": format!("artifact not found on disk: {e}"),
                    "path": path.display().to_string(),
                })),
            )
                .into_response();
        }
    };

    if !meta.is_file() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "artifact location is not a regular file",
                "path": path.display().to_string(),
            })),
        )
            .into_response();
    }

    if meta.len() > MAX_ARTIFACT_BYTES {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(serde_json::json!({
                "error": format!(
                    "artifact exceeds {} MiB preview limit",
                    MAX_ARTIFACT_BYTES / (1024 * 1024)
                ),
                "size": meta.len(),
            })),
        )
            .into_response();
    }

    let bytes = match tokio::fs::read(&path).await {
        Ok(b) => b,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("read failed: {e}") })),
            )
                .into_response();
        }
    };

    let mime = mime_guess::from_path(&path)
        .first_or_octet_stream()
        .to_string();

    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("artifact");

    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, mime),
            (header::CACHE_CONTROL, "private, max-age=60".to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("inline; filename=\"{filename}\""),
            ),
        ],
        bytes,
    )
        .into_response()
}

fn resolve_location(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("location is empty".to_string());
    }

    let stripped = trimmed
        .strip_prefix("file://")
        .unwrap_or(trimmed)
        .to_string();

    let expanded = if let Some(rest) = stripped.strip_prefix("~/") {
        match directories::UserDirs::new() {
            Some(dirs) => dirs.home_dir().join(rest),
            None => return Err("cannot resolve '~': no home directory".to_string()),
        }
    } else if stripped == "~" {
        match directories::UserDirs::new() {
            Some(dirs) => dirs.home_dir().to_path_buf(),
            None => return Err("cannot resolve '~': no home directory".to_string()),
        }
    } else {
        PathBuf::from(stripped)
    };

    if !Path::new(&expanded).is_absolute() {
        return Err("location must be an absolute path".to_string());
    }

    Ok(expanded)
}
