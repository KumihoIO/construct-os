//! Register an installed skill with Kumiho.
//!
//! Step 6b of the self-improving skill plan.  This module exposes the
//! single canonical "this skill exists, give it a Kumiho identity"
//! operation that step 6c will route every install path through —
//! ClawHub, GitHub link, dashboard, `creator.rs`, daemon-startup scan,
//! the operator's `capture_skill` MCP tool.
//!
//! ## What `register_skill_with_kumiho` does
//!
//! Given a skill directory on disk (`~/.construct/workspace/skills/<slug>/`)
//! and a Kumiho client + memory_project name from config:
//!
//! 1. **No-op if already registered** — when the skill's `SKILL.toml`
//!    already has `[skill].kref` set, the existing kref is returned.
//!    This is what makes the function safe to call from every install
//!    path including a daemon-startup scan: re-registering a skill that
//!    was registered yesterday costs zero Kumiho calls.
//!
//! 2. **Auto-migrate legacy embedded prompts** to a content file.  The
//!    [`super::migrate_skill_toml_to_content_file`] helper added in step
//!    6a runs first when the manifest is still in legacy form, so the
//!    revision's artifact has a stable file path to point at.
//!
//! 3. **Resolve the absolute content file path** the artifact will
//!    reference.  Kumiho stores the kref → file location mapping; the
//!    file itself stays canonical on disk.
//!
//! 4. **Create item + revision + artifact + tag** in
//!    `<memory_project>/Skills/`:
//!      - `create_item(kind = "skilldef", item_name = slug)`
//!      - `create_revision(item_kref, metadata)` with manifest fields
//!      - `create_artifact(revision_kref, name = "skill", location = "file://<abs>")`
//!      - `tag_revision(revision_kref, "published")`
//!
//! 5. **Rewrite `SKILL.toml`** with `[skill].kref =
//!    "kref://<memory_project>/Skills/<slug>.skilldef?t=published"`.
//!    The `?t=published` query is what makes the manifest write-once
//!    across revisions: subsequent improvements that retag `published`
//!    onto a new revision are picked up automatically without touching
//!    the manifest again.
//!
//! ## Error handling
//!
//! Any Kumiho-side failure leaves the file system in its starting state
//! — the manifest is only rewritten after every Kumiho call has
//! succeeded, so a partial registration cannot end up with a kref
//! pointing at a non-existent revision.

use anyhow::{Context, Result, anyhow};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::gateway::kumiho_client::{KumihoClient, slugify};
use crate::skills::{SkillContentMigration, SkillManifest, migrate_skill_toml_to_content_file};

/// The kind used for skill items in Kumiho.  Matches the kref convention
/// `kref://<memory_project>/Skills/<slug>.skilldef`.
pub const SKILL_ITEM_KIND: &str = "skilldef";

/// Default tag for the current revision of a skill.
pub const PUBLISHED_TAG: &str = "published";

/// Default artifact name for a skill revision.  Single artifact per
/// revision, named uniformly so consumers can locate it without a
/// listing call.
pub const SKILL_ARTIFACT_NAME: &str = "skill";

/// Build the published-kref pointer for a skill — the string written
/// into `SKILL.toml`'s `[skill].kref` field.  Always resolves to
/// whichever revision currently holds the `published` tag, so the
/// manifest never needs to be rewritten when a new revision lands.
pub fn build_published_kref(memory_project: &str, slug: &str) -> String {
    format!("kref://{memory_project}/Skills/{slug}.{SKILL_ITEM_KIND}?t={PUBLISHED_TAG}")
}

/// Outcome returned by [`register_skill_with_kumiho`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SkillRegistration {
    /// `SKILL.toml` already had `[skill].kref` set; no Kumiho calls
    /// were made.  The existing kref is returned so callers can use it
    /// without parsing the manifest themselves.
    AlreadyRegistered { kref: String },
    /// Created a fresh item + revision + artifact + tag and updated
    /// the manifest with the new kref.
    Registered {
        kref: String,
        item_kref: String,
        revision_kref: String,
    },
}

impl SkillRegistration {
    /// The published-kref pointer either way (existing or freshly
    /// minted).  Convenient for callers that don't need to distinguish.
    pub fn kref(&self) -> &str {
        match self {
            Self::AlreadyRegistered { kref } => kref,
            Self::Registered { kref, .. } => kref,
        }
    }
}

/// Register an installed skill with Kumiho — see module docs.
pub async fn register_skill_with_kumiho(
    skill_dir: &Path,
    client: &KumihoClient,
    memory_project: &str,
) -> Result<SkillRegistration> {
    let manifest_path = skill_dir.join("SKILL.toml");
    if !manifest_path.exists() {
        return Err(anyhow!("no SKILL.toml at {}", manifest_path.display()));
    }

    // Phase 1: read the manifest and short-circuit if already registered.
    let manifest = read_manifest(&manifest_path)?;
    if let Some(kref) = manifest.skill.kref.as_ref() {
        return Ok(SkillRegistration::AlreadyRegistered { kref: kref.clone() });
    }

    // Phase 2: ensure the skill has an external content file.  Legacy
    // skills with embedded prompts get migrated here so step 4's
    // artifact has a stable file path to point at.
    if manifest.skill.content_file.is_none() && !manifest.prompts.is_empty() {
        let result = migrate_skill_toml_to_content_file(&manifest_path)
            .context("auto-migrating legacy embedded prompts to content file")?;
        if !matches!(result, SkillContentMigration::Migrated { .. }) {
            // The earlier check guaranteed prompts were non-empty, so
            // anything other than Migrated here is unexpected.
            return Err(anyhow!(
                "unexpected migrate_skill_toml_to_content_file result: {result:?}"
            ));
        }
    }

    // Reload after potential migration — the manifest now has
    // content_file set if it didn't before.
    let manifest = read_manifest(&manifest_path)?;
    let slug = slugify(&manifest.skill.name);
    if slug.is_empty() {
        return Err(anyhow!(
            "skill name {:?} slugified to empty; cannot register",
            manifest.skill.name
        ));
    }

    // Phase 3: resolve the absolute content file path the artifact will
    // reference.  Kumiho stores the kref → file mapping; the file stays
    // canonical on disk.
    let content_path = resolve_content_file(skill_dir, &manifest)?;
    let content_uri = format_file_uri(&content_path);

    // Phase 4: create item + revision + artifact + tag.  Each step
    // mutates Kumiho but not the manifest, so the file system stays
    // consistent with the partial-registration invariant: SKILL.toml is
    // only rewritten after EVERY Kumiho call has succeeded.
    client
        .ensure_project(memory_project)
        .await
        .with_context(|| format!("ensure_project({memory_project})"))?;
    client
        .ensure_space(memory_project, "Skills")
        .await
        .with_context(|| format!("ensure_space({memory_project}/Skills)"))?;

    let space_path = format!("/{memory_project}/Skills");
    let item = client
        .create_item(&space_path, &slug, SKILL_ITEM_KIND, HashMap::new())
        .await
        .with_context(|| format!("create_item({space_path}/{slug}.{SKILL_ITEM_KIND})"))?;

    let revision_metadata = revision_metadata_from_manifest(&manifest);
    let revision = client
        .create_revision(&item.kref, revision_metadata)
        .await
        .with_context(|| format!("create_revision({})", item.kref))?;

    client
        .create_artifact(
            &revision.kref,
            SKILL_ARTIFACT_NAME,
            &content_uri,
            HashMap::new(),
        )
        .await
        .with_context(|| format!("create_artifact({} -> {content_uri})", revision.kref))?;

    client
        .tag_revision(&revision.kref, PUBLISHED_TAG)
        .await
        .with_context(|| format!("tag_revision({}, {PUBLISHED_TAG})", revision.kref))?;

    // Phase 5: rewrite the manifest with the published kref pointer.
    let kref = build_published_kref(memory_project, &slug);
    write_kref_to_manifest(&manifest_path, &kref)?;

    Ok(SkillRegistration::Registered {
        kref,
        item_kref: item.kref,
        revision_kref: revision.kref,
    })
}

/// Read and parse the manifest TOML.  Kept as a small helper so
/// callers + tests can exercise the parsing path consistently.
fn read_manifest(path: &Path) -> Result<SkillManifest> {
    let raw = std::fs::read_to_string(path)
        .with_context(|| format!("reading SKILL.toml: {}", path.display()))?;
    toml::from_str(&raw).with_context(|| format!("parsing SKILL.toml: {}", path.display()))
}

/// Resolve the absolute path of the file the artifact will reference.
/// Prefers `[skill].content_file`; falls back to a synthesized
/// `contents/r1.md` only when the migrator hasn't run yet (which the
/// caller guarantees won't happen — but we error cleanly if it does).
fn resolve_content_file(skill_dir: &Path, manifest: &SkillManifest) -> Result<PathBuf> {
    let rel = manifest.skill.content_file.as_deref().ok_or_else(|| {
        anyhow!(
            "skill {:?} has no content_file after migration; cannot register",
            manifest.skill.name
        )
    })?;
    let path = skill_dir.join(rel);
    if !path.exists() {
        return Err(anyhow!(
            "skill content_file does not exist: {}",
            path.display()
        ));
    }
    // Resolve to an absolute path so the artifact location is portable
    // across daemon working directories.
    std::fs::canonicalize(&path).with_context(|| format!("canonicalising {}", path.display()))
}

/// Build the metadata HashMap stored on the Kumiho revision.  Kept
/// minimal — name / description / version / author / tags — so the
/// revision is queryable without fetching the artifact.  Tags are
/// joined with `,` because Kumiho metadata values are strings.
fn revision_metadata_from_manifest(manifest: &SkillManifest) -> HashMap<String, String> {
    let mut meta = HashMap::with_capacity(5);
    meta.insert("name".into(), manifest.skill.name.clone());
    meta.insert("description".into(), manifest.skill.description.clone());
    meta.insert("version".into(), manifest.skill.version.clone());
    if let Some(a) = &manifest.skill.author {
        meta.insert("author".into(), a.clone());
    }
    if !manifest.skill.tags.is_empty() {
        meta.insert("tags".into(), manifest.skill.tags.join(","));
    }
    meta
}

/// Format an absolute path as a `file://` URI suitable for a Kumiho
/// artifact location.  Uses simple URL-escaping of percent characters
/// so paths with `%` round-trip cleanly.
fn format_file_uri(path: &Path) -> String {
    let s = path.to_string_lossy();
    format!("file://{}", s.replace('%', "%25"))
}

/// Read SKILL.toml, set `[skill].kref`, write it back.  Preserves
/// every other field through the toml round-trip.
fn write_kref_to_manifest(path: &Path, kref: &str) -> Result<()> {
    let mut manifest = read_manifest(path)?;
    manifest.skill.kref = Some(kref.to_string());
    let serialized =
        toml::to_string_pretty(&manifest).context("serializing SKILL.toml with kref")?;
    std::fs::write(path, serialized.as_bytes())
        .with_context(|| format!("writing SKILL.toml: {}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_published_kref_uses_memory_project_and_slug() {
        let kref = build_published_kref("CognitiveMemory", "code-review");
        assert_eq!(
            kref,
            "kref://CognitiveMemory/Skills/code-review.skilldef?t=published"
        );
    }

    #[test]
    fn build_published_kref_respects_custom_memory_project() {
        // `memory_project` comes from config — never hardcode CognitiveMemory.
        let kref = build_published_kref("MyOrgMemory", "deploy-runner");
        assert_eq!(
            kref,
            "kref://MyOrgMemory/Skills/deploy-runner.skilldef?t=published"
        );
    }

    #[test]
    fn format_file_uri_basic() {
        let p = PathBuf::from("/Users/neo/.construct/workspace/skills/foo/contents/r1.md");
        assert_eq!(
            format_file_uri(&p),
            "file:///Users/neo/.construct/workspace/skills/foo/contents/r1.md"
        );
    }

    #[test]
    fn format_file_uri_escapes_percent() {
        let p = PathBuf::from("/tmp/has%percent");
        assert_eq!(format_file_uri(&p), "file:///tmp/has%25percent");
    }

    #[test]
    fn revision_metadata_from_manifest_includes_required_fields() {
        let manifest = SkillManifest {
            skill: super::super::SkillMeta {
                name: "demo".into(),
                description: "demo skill".into(),
                version: "0.1.0".into(),
                author: Some("alice".into()),
                tags: vec!["safety".into(), "ops".into()],
                content_file: Some("contents/r1.md".into()),
                kref: None,
            },
            tools: vec![],
            prompts: vec![],
        };
        let meta = revision_metadata_from_manifest(&manifest);
        assert_eq!(meta.get("name").map(String::as_str), Some("demo"));
        assert_eq!(
            meta.get("description").map(String::as_str),
            Some("demo skill")
        );
        assert_eq!(meta.get("version").map(String::as_str), Some("0.1.0"));
        assert_eq!(meta.get("author").map(String::as_str), Some("alice"));
        assert_eq!(meta.get("tags").map(String::as_str), Some("safety,ops"));
    }

    #[test]
    fn revision_metadata_omits_optional_when_absent() {
        let manifest = SkillManifest {
            skill: super::super::SkillMeta {
                name: "minimal".into(),
                description: "x".into(),
                version: "0.1.0".into(),
                author: None,
                tags: vec![],
                content_file: Some("contents/r1.md".into()),
                kref: None,
            },
            tools: vec![],
            prompts: vec![],
        };
        let meta = revision_metadata_from_manifest(&manifest);
        assert!(!meta.contains_key("author"));
        assert!(!meta.contains_key("tags"));
    }

    #[test]
    fn write_kref_to_manifest_round_trips_other_fields() {
        let dir = tempfile::tempdir().unwrap();
        let manifest_path = dir.path().join("SKILL.toml");
        std::fs::write(
            &manifest_path,
            r#"[skill]
name = "round-trip"
description = "preserves other fields"
version = "0.4.2"
content_file = "contents/r1.md"
"#,
        )
        .unwrap();

        write_kref_to_manifest(
            &manifest_path,
            "kref://CognitiveMemory/Skills/round-trip.skilldef?t=published",
        )
        .unwrap();

        let raw = std::fs::read_to_string(&manifest_path).unwrap();
        assert!(raw.contains("name = \"round-trip\""));
        assert!(raw.contains("version = \"0.4.2\""));
        assert!(raw.contains("content_file = \"contents/r1.md\""));
        assert!(
            raw.contains(
                "kref = \"kref://CognitiveMemory/Skills/round-trip.skilldef?t=published\""
            )
        );
    }

    #[test]
    fn resolve_content_file_errors_when_path_missing() {
        let dir = tempfile::tempdir().unwrap();
        let manifest = SkillManifest {
            skill: super::super::SkillMeta {
                name: "missing".into(),
                description: "x".into(),
                version: "0.1.0".into(),
                author: None,
                tags: vec![],
                content_file: Some("contents/does-not-exist.md".into()),
                kref: None,
            },
            tools: vec![],
            prompts: vec![],
        };
        let err = resolve_content_file(dir.path(), &manifest).unwrap_err();
        assert!(err.to_string().contains("does not exist"));
    }

    #[test]
    fn resolve_content_file_errors_when_not_set() {
        let dir = tempfile::tempdir().unwrap();
        let manifest = SkillManifest {
            skill: super::super::SkillMeta {
                name: "no-pointer".into(),
                description: "x".into(),
                version: "0.1.0".into(),
                author: None,
                tags: vec![],
                content_file: None,
                kref: None,
            },
            tools: vec![],
            prompts: vec![],
        };
        let err = resolve_content_file(dir.path(), &manifest).unwrap_err();
        assert!(err.to_string().contains("no content_file"));
    }
}
