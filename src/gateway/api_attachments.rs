//! Per-session attachment uploads for the Operator chat surface.
//!
//! Frontend flow:
//!   1. User picks a file (or drops/pastes one) in the chat composer
//!   2. Frontend POSTs `multipart/form-data` to
//!      `POST /api/sessions/{session_id}/attachments`
//!   3. Server writes the file to
//!      `<workspace>/attachments/<session_id>/<file_id>` plus a sidecar
//!      `<file_id>.json` carrying filename/mime/size metadata
//!   4. Server returns `AttachmentMeta` JSON; frontend stashes the
//!      `file_id` and includes it on the next WS `message` payload as
//!      `attachments: [file_id, ...]`
//!   5. Gateway WS handler resolves each id to a marker
//!      (`[IMAGE:/path]` for image MIMEs, `[DOCUMENT:/path]` for everything
//!      else) and prepends the markers to the user's text before the
//!      agent turn. The existing `multimodal::prepare_messages_for_provider`
//!      pipeline takes it from there.
//!
//! No SQLite — the on-disk layout (file + sibling `.json` per attachment)
//! is enough for session-scoped uploads. Concurrent uploads can't collide
//! because each `file_id` is a fresh UUID, and each upload writes its own
//! files.

use super::{AppState, client_key_from_request};
use axum::{
    extract::{ConnectInfo, Multipart, Path as AxumPath, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Json},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use tracing::{debug, error, warn};

/// Hard upper bound on a single uploaded file. 25 MiB matches what
/// Anthropic and OpenAI accept for image content blocks; documents are
/// usually smaller.
const MAX_ATTACHMENT_BYTES: usize = 25 * 1024 * 1024;

/// MIME prefixes we treat as images (route to the existing `[IMAGE:...]`
/// marker so vision-capable providers see them as content blocks).
const IMAGE_MIME_PREFIXES: &[&str] = &["image/"];

/// Stored metadata for one attachment. Mirrors what the frontend needs
/// to render a chip preview (filename, size, mime, timestamp) plus the
/// `file_id` that goes back into the WS message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentMeta {
    /// UUID assigned at upload time, used as both the on-disk filename
    /// (without extension) and the reference in WS `attachments` arrays.
    pub file_id: String,
    /// Original filename as supplied by the browser. Used only for the
    /// chip label and the `[DOCUMENT:]` marker hint — never for filesystem
    /// path resolution.
    pub filename: String,
    /// Bytes on disk. Capped at [`MAX_ATTACHMENT_BYTES`] at upload time.
    pub size: u64,
    /// MIME type as supplied by the browser, falling back to
    /// `application/octet-stream` if missing or empty.
    pub mime: String,
    /// Session this attachment belongs to. The handler uses this to scope
    /// the storage path; the WS resolver checks it matches the session
    /// claiming the file.
    pub session_id: String,
    pub created_at: DateTime<Utc>,
    /// Absolute path to the file on disk. Not serialized to clients —
    /// only used internally by the WS resolver.
    #[serde(skip)]
    pub path: PathBuf,
}

impl AttachmentMeta {
    /// True when the MIME type is in the image family. Used by the WS
    /// resolver to choose between `[IMAGE:]` (rides the existing vision
    /// marker pipeline) and `[DOCUMENT:]` (text inlining).
    pub fn is_image(&self) -> bool {
        IMAGE_MIME_PREFIXES
            .iter()
            .any(|prefix| self.mime.starts_with(prefix))
    }
}

/// Compute the directory holding all attachments for a given session.
/// Created lazily by the upload handler.
fn session_dir(workspace_dir: &Path, session_id: &str) -> PathBuf {
    workspace_dir.join("attachments").join(session_id)
}

/// Upload a single file via multipart form. Expects exactly one file
/// field named `file`; returns the persisted [`AttachmentMeta`] as JSON.
///
/// Auth: gated by the same per-client rate limiter and pairing check as
/// other write endpoints (via [`client_key_from_request`] + the gateway
/// router's middleware stack — same pattern as the workflows API).
pub async fn handle_upload(
    State(state): State<AppState>,
    AxumPath(session_id): AxumPath<String>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> impl IntoResponse {
    let _client_key = client_key_from_request(Some(addr), &headers, state.trust_forwarded_headers);

    let workspace_dir = state.config.lock().workspace_dir.clone();
    let dir = session_dir(&workspace_dir, &session_id);
    if let Err(err) = tokio::fs::create_dir_all(&dir).await {
        error!(err = %err, dir = %dir.display(), "failed to create attachment dir");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "failed to create attachment storage" })),
        )
            .into_response();
    }

    while let Ok(Some(field)) = multipart.next_field().await {
        if field.name() != Some("file") {
            // Permit arbitrary other form fields silently; we only care about `file`.
            continue;
        }

        let filename = field
            .file_name()
            .map(|s| sanitize_filename(s))
            .unwrap_or_else(|| "attachment".to_string());
        let mime = field
            .content_type()
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "application/octet-stream".to_string());

        let bytes = match field.bytes().await {
            Ok(b) => b,
            Err(err) => {
                warn!(err = %err, "multipart field read failed");
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({ "error": "failed to read upload body" })),
                )
                    .into_response();
            }
        };

        if bytes.len() > MAX_ATTACHMENT_BYTES {
            return (
                StatusCode::PAYLOAD_TOO_LARGE,
                Json(serde_json::json!({
                    "error": format!(
                        "attachment exceeds {} byte limit (received {} bytes)",
                        MAX_ATTACHMENT_BYTES,
                        bytes.len(),
                    ),
                })),
            )
                .into_response();
        }
        if bytes.is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "empty file" })),
            )
                .into_response();
        }

        let file_id = uuid::Uuid::new_v4().to_string();
        let file_path = dir.join(&file_id);
        let meta_path = dir.join(format!("{file_id}.json"));

        if let Err(err) = tokio::fs::write(&file_path, &bytes).await {
            error!(err = %err, "failed to persist attachment bytes");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "failed to persist file" })),
            )
                .into_response();
        }

        let meta = AttachmentMeta {
            file_id: file_id.clone(),
            filename,
            size: bytes.len() as u64,
            mime,
            session_id: session_id.clone(),
            created_at: Utc::now(),
            path: file_path,
        };

        // Strip the non-serialized `path` field by going through serde.
        let serialized = match serde_json::to_string(&meta) {
            Ok(s) => s,
            Err(err) => {
                error!(err = %err, "failed to serialize attachment metadata");
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": "failed to serialize metadata" })),
                )
                    .into_response();
            }
        };
        if let Err(err) = tokio::fs::write(&meta_path, serialized).await {
            error!(err = %err, "failed to persist attachment metadata");
            // Best-effort: try to clean up the orphan bytes so we don't
            // leave a file on disk that can never be looked up.
            let _ = tokio::fs::remove_file(&meta.path).await;
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "failed to persist metadata" })),
            )
                .into_response();
        }

        debug!(
            session_id = %session_id,
            file_id = %meta.file_id,
            filename = %meta.filename,
            size = meta.size,
            mime = %meta.mime,
            "attachment stored",
        );

        return (
            StatusCode::CREATED,
            Json(serde_json::json!({
                "file_id": meta.file_id,
                "filename": meta.filename,
                "size": meta.size,
                "mime": meta.mime,
                "session_id": meta.session_id,
                "created_at": meta.created_at,
            })),
        )
            .into_response();
    }

    (
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({
            "error": "missing 'file' field in multipart upload",
        })),
    )
        .into_response()
}

/// Resolve a list of `file_id`s for a session into their on-disk metadata.
/// Missing or malformed sidecars are skipped with a warning rather than
/// failing the whole turn — a single bad upload shouldn't kill the chat.
pub async fn resolve_for_session(
    workspace_dir: &Path,
    session_id: &str,
    file_ids: &[String],
) -> Vec<AttachmentMeta> {
    let dir = session_dir(workspace_dir, session_id);
    let mut out = Vec::with_capacity(file_ids.len());
    for file_id in file_ids {
        // Defense in depth — reject anything that could escape the session dir.
        if file_id.contains('/') || file_id.contains('\\') || file_id.contains("..") {
            warn!(
                session_id,
                file_id, "rejecting attachment id with path separators"
            );
            continue;
        }
        let meta_path = dir.join(format!("{file_id}.json"));
        let raw = match tokio::fs::read(&meta_path).await {
            Ok(r) => r,
            Err(err) => {
                warn!(err = %err, path = %meta_path.display(), "attachment metadata not found");
                continue;
            }
        };
        let mut meta: AttachmentMeta = match serde_json::from_slice(&raw) {
            Ok(m) => m,
            Err(err) => {
                warn!(err = %err, "attachment metadata parse failed");
                continue;
            }
        };
        // Re-anchor `path` (it's #[serde(skip)]) to the canonical layout
        // — the sidecar JSON doesn't carry the absolute path, by design.
        meta.path = dir.join(file_id);
        if !meta.path.exists() {
            warn!(file_id = %meta.file_id, "attachment bytes missing for metadata");
            continue;
        }
        out.push(meta);
    }
    out
}

/// Strip directory components and control characters from a user-supplied
/// filename before we use it in marker text. Filesystem paths use the
/// `file_id` as the actual on-disk name, so this is purely cosmetic /
/// log-safe; we also clamp the length to avoid the LLM seeing megabyte
/// labels if a misbehaving client sends one.
fn sanitize_filename(name: &str) -> String {
    let basename = std::path::Path::new(name)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(name);
    let cleaned: String = basename
        .chars()
        .filter(|c| !c.is_control())
        .take(255)
        .collect();
    if cleaned.trim().is_empty() {
        "attachment".to_string()
    } else {
        cleaned
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_strips_paths_and_control_chars() {
        assert_eq!(sanitize_filename("../etc/passwd"), "passwd");
        assert_eq!(sanitize_filename("/abs/foo.txt"), "foo.txt");
        assert_eq!(sanitize_filename("hello\x00world.png"), "helloworld.png");
        assert_eq!(sanitize_filename("   "), "attachment");
        assert_eq!(sanitize_filename(""), "attachment");
    }

    #[test]
    fn sanitize_clamps_length() {
        let long = "a".repeat(1000);
        assert_eq!(sanitize_filename(&long).len(), 255);
    }

    #[test]
    fn meta_classifies_image_vs_document() {
        let meta = AttachmentMeta {
            file_id: "x".into(),
            filename: "x".into(),
            size: 1,
            mime: "image/png".into(),
            session_id: "s".into(),
            created_at: Utc::now(),
            path: PathBuf::new(),
        };
        assert!(meta.is_image());

        let meta = AttachmentMeta {
            mime: "application/pdf".into(),
            ..meta
        };
        assert!(!meta.is_image());
    }

    #[tokio::test]
    async fn resolve_skips_path_traversal_ids() {
        let tmp = tempfile::tempdir().unwrap();
        let out = resolve_for_session(tmp.path(), "session-1", &["../escape".to_string()]).await;
        assert!(out.is_empty());
    }

    #[tokio::test]
    async fn resolve_returns_meta_for_valid_id() {
        let tmp = tempfile::tempdir().unwrap();
        let session_id = "session-1";
        let dir = session_dir(tmp.path(), session_id);
        tokio::fs::create_dir_all(&dir).await.unwrap();

        let file_id = "00000000-0000-0000-0000-000000000001";
        tokio::fs::write(dir.join(file_id), b"hello").await.unwrap();
        let meta = AttachmentMeta {
            file_id: file_id.to_string(),
            filename: "hello.txt".into(),
            size: 5,
            mime: "text/plain".into(),
            session_id: session_id.into(),
            created_at: Utc::now(),
            path: PathBuf::new(),
        };
        tokio::fs::write(
            dir.join(format!("{file_id}.json")),
            serde_json::to_string(&meta).unwrap(),
        )
        .await
        .unwrap();

        let resolved = resolve_for_session(tmp.path(), session_id, &[file_id.to_string()]).await;
        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].filename, "hello.txt");
        assert_eq!(resolved[0].mime, "text/plain");
        assert!(resolved[0].path.exists());
    }
}
