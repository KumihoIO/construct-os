// Skill self-improvement (step 6e — Kumiho-versioned).
//
// Each improvement writes a NEW markdown file under
// `<workspace>/skills/<slug>/contents/r<N+1>-<UTC-timestamp>.md`.  The
// caller (`auto_improve.rs`) then publishes that file as a fresh Kumiho
// revision tagged `published`, and the load-time
// `sync_published_content_path` rewrites SKILL.toml's `content_file`
// pointer.  SKILL.toml itself never gets overwritten by the improver —
// that's the property the user asked for: every improvement is a new
// addressable revision rather than an in-place edit.
//
// Gated behind `#[cfg(feature = "skill-creation")]` at the module level
// in `src/skills/mod.rs`.

use crate::config::SkillImprovementConfig;
use anyhow::{Context, Result, bail};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Instant;

/// Manages skill self-improvement with cooldown tracking.
pub struct SkillImprover {
    workspace_dir: PathBuf,
    config: SkillImprovementConfig,
    cooldowns: HashMap<String, Instant>,
}

impl SkillImprover {
    pub fn new(workspace_dir: PathBuf, config: SkillImprovementConfig) -> Self {
        Self {
            workspace_dir,
            config,
            cooldowns: HashMap::new(),
        }
    }

    /// Check whether a skill is eligible for improvement (enabled + cooldown expired).
    pub fn should_improve_skill(&self, slug: &str) -> bool {
        if !self.config.enabled {
            return false;
        }
        if let Some(last) = self.cooldowns.get(slug) {
            let elapsed = Instant::now().saturating_duration_since(*last);
            elapsed.as_secs() >= self.config.cooldown_secs
        } else {
            true
        }
    }

    /// Write improved markdown content to a new revision file under
    /// `<skill_dir>/contents/`.
    ///
    /// Returns:
    /// - `Ok(Some(path))` — the absolute path of the newly written file.
    ///   Cooldown is now armed for this skill.  Caller is responsible for
    ///   publishing this file as a Kumiho revision via
    ///   `registration::publish_skill_revision`.
    /// - `Ok(None)` — skipped because the cooldown is still active or
    ///   the skill is not enabled for improvement.
    /// - `Err(_)` — disk failure or invalid content.  No state changed.
    ///
    /// The improver never overwrites `SKILL.toml`.  The `content_file`
    /// pointer is updated by the caller after the new revision is
    /// tagged `published` and synced.
    pub async fn improve_skill(
        &mut self,
        slug: &str,
        improved_content: &str,
        improvement_reason: &str,
    ) -> Result<Option<PathBuf>> {
        if !self.should_improve_skill(slug) {
            return Ok(None);
        }

        validate_skill_content(improved_content)?;

        let skill_dir = self.skills_dir().join(slug);
        if !skill_dir.exists() {
            bail!("Skill directory not found: {}", skill_dir.display());
        }

        let contents_dir = skill_dir.join("contents");
        tokio::fs::create_dir_all(&contents_dir)
            .await
            .with_context(|| format!("creating {}", contents_dir.display()))?;

        let filename = next_revision_filename(&contents_dir).await?;
        let new_path = contents_dir.join(&filename);

        let body = format_content_with_audit(improved_content, improvement_reason);

        // Atomic-write: temp file → rename.  Write into the same
        // directory so the rename stays on one filesystem.
        let temp_path = contents_dir.join(format!(".{filename}.tmp"));
        tokio::fs::write(&temp_path, body.as_bytes())
            .await
            .with_context(|| format!("writing temp file: {}", temp_path.display()))?;

        if let Err(e) = tokio::fs::rename(&temp_path, &new_path).await {
            // Best-effort cleanup of the temp file before returning.
            let _ = tokio::fs::remove_file(&temp_path).await;
            return Err(e).with_context(|| {
                format!("renaming {} → {}", temp_path.display(), new_path.display())
            });
        }

        self.cooldowns.insert(slug.to_string(), Instant::now());
        Ok(Some(new_path))
    }

    fn skills_dir(&self) -> PathBuf {
        self.workspace_dir.join("skills")
    }
}

/// Validate improved content (markdown body the agent reads at runtime).
///
/// Step 6e shifts the unit of improvement from `SKILL.toml` to the
/// markdown content file referenced by `[skill].content_file`.  We
/// therefore only enforce that the content is non-empty and not
/// pathologically large — TOML structural validation lives in
/// `registration::register_skill_with_kumiho` for the manifest itself.
pub fn validate_skill_content(content: &str) -> Result<()> {
    if content.trim().is_empty() {
        bail!("Skill content is empty");
    }
    // Soft cap to catch runaway LLM responses.  1 MiB is well above any
    // realistic prompt body; if a legitimate skill grows past that the
    // bound can be revisited.
    if content.len() > 1_048_576 {
        bail!(
            "Skill content too large ({} bytes); max 1 MiB",
            content.len()
        );
    }
    Ok(())
}

/// Append a small audit footer to the improved markdown so a reader
/// looking at the file alone can tell when and why it was generated.
/// The footer is written as HTML comments so it doesn't render in
/// markdown viewers.
fn format_content_with_audit(content: &str, reason: &str) -> String {
    let now = chrono::Utc::now().to_rfc3339();
    let trimmed = content.trim_end();
    // Defang any literal `-->` in the reason so the comment can't be
    // closed early.
    let safe_reason = reason.replace('\n', " ").replace("-->", "—>");
    format!("{trimmed}\n\n<!-- improvement: {now} -->\n<!-- reason: {safe_reason} -->\n")
}

/// Determine the next-revision filename for `<contents_dir>/`.
///
/// Scans the directory for files matching `r<N>(-...).md` and returns
/// `r<N+1>-<YYYYMMDD-HHMMSS>.md`.  When the directory is empty (no
/// `r<N>` files yet, e.g. a freshly-migrated skill that's about to land
/// its first improvement on top of `r1`) the next index is computed as
/// `max + 1` where `max = 0` ⇒ `r1`.  Migrations create `r1-<date>.md`
/// already, so the typical first improvement lands as `r2-...`.
async fn next_revision_filename(contents_dir: &Path) -> Result<String> {
    let mut max_rev: u32 = 0;
    let mut entries = tokio::fs::read_dir(contents_dir)
        .await
        .with_context(|| format!("reading {}", contents_dir.display()))?;
    while let Ok(Some(entry)) = entries.next_entry().await {
        if let Some(rev) = parse_revision_index(&entry.file_name().to_string_lossy()) {
            if rev > max_rev {
                max_rev = rev;
            }
        }
    }
    let next = max_rev.saturating_add(1);
    let ts = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    Ok(format!("r{next}-{ts}.md"))
}

/// Extract the `<N>` from `r<N>(-...).md`.  Returns `None` for files
/// that don't fit the pattern (so the scan ignores README.md, sidecar
/// notes, etc.).
fn parse_revision_index(filename: &str) -> Option<u32> {
    let stem = filename.strip_suffix(".md")?;
    let rest = stem.strip_prefix('r')?;
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return None;
    }
    digits.parse::<u32>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Validation ──────────────────────────────────────────

    #[test]
    fn validate_empty_content_rejected() {
        assert!(validate_skill_content("").is_err());
        assert!(validate_skill_content("   \n  ").is_err());
    }

    #[test]
    fn validate_oversize_content_rejected() {
        let huge = "x".repeat(1_048_577);
        assert!(validate_skill_content(&huge).is_err());
    }

    #[test]
    fn validate_markdown_content_accepted() {
        // No TOML required — markdown body is fine.
        assert!(validate_skill_content("# Heading\n\nBody.\n").is_ok());
    }

    // ── Cooldown enforcement ────────────────────────────────

    #[test]
    fn cooldown_allows_first_improvement() {
        let improver = SkillImprover::new(
            PathBuf::from("/tmp/test"),
            SkillImprovementConfig {
                enabled: true,
                cooldown_secs: 3600,
            },
        );
        assert!(improver.should_improve_skill("test-skill"));
    }

    #[test]
    fn cooldown_blocks_recent_improvement() {
        let mut improver = SkillImprover::new(
            PathBuf::from("/tmp/test"),
            SkillImprovementConfig {
                enabled: true,
                cooldown_secs: 3600,
            },
        );
        improver
            .cooldowns
            .insert("test-skill".to_string(), Instant::now());
        assert!(!improver.should_improve_skill("test-skill"));
    }

    #[test]
    fn cooldown_disabled_blocks_all() {
        let improver = SkillImprover::new(
            PathBuf::from("/tmp/test"),
            SkillImprovementConfig {
                enabled: false,
                cooldown_secs: 0,
            },
        );
        assert!(!improver.should_improve_skill("test-skill"));
    }

    // ── next_revision_filename ──────────────────────────────

    #[tokio::test]
    async fn next_revision_filename_starts_at_r1_when_empty() {
        let dir = tempfile::tempdir().unwrap();
        let name = next_revision_filename(dir.path()).await.unwrap();
        assert!(
            name.starts_with("r1-") && name.ends_with(".md"),
            "got {name}"
        );
    }

    #[tokio::test]
    async fn next_revision_filename_increments_past_max() {
        let dir = tempfile::tempdir().unwrap();
        for f in ["r1-2026-01-01.md", "r2-2026-02-01.md", "README.md"] {
            tokio::fs::write(dir.path().join(f), b"x").await.unwrap();
        }
        let name = next_revision_filename(dir.path()).await.unwrap();
        assert!(name.starts_with("r3-"), "got {name}");
    }

    #[tokio::test]
    async fn next_revision_filename_handles_sparse_indices() {
        let dir = tempfile::tempdir().unwrap();
        for f in ["r1-x.md", "r5-x.md", "r3-x.md"] {
            tokio::fs::write(dir.path().join(f), b"x").await.unwrap();
        }
        let name = next_revision_filename(dir.path()).await.unwrap();
        assert!(name.starts_with("r6-"), "got {name}");
    }

    #[tokio::test]
    async fn next_revision_filename_ignores_non_revision_files() {
        let dir = tempfile::tempdir().unwrap();
        for f in ["readme.md", "notes-r99.md", "rabbit.md", "r.md"] {
            tokio::fs::write(dir.path().join(f), b"x").await.unwrap();
        }
        let name = next_revision_filename(dir.path()).await.unwrap();
        assert!(name.starts_with("r1-"), "got {name}");
    }

    #[test]
    fn parse_revision_index_basic() {
        assert_eq!(parse_revision_index("r1.md"), Some(1));
        assert_eq!(parse_revision_index("r12-2026-01-01.md"), Some(12));
        assert_eq!(parse_revision_index("r0001-x.md"), Some(1));
    }

    #[test]
    fn parse_revision_index_rejects_non_pattern() {
        assert_eq!(parse_revision_index("README.md"), None);
        assert_eq!(parse_revision_index("rabbit.md"), None);
        assert_eq!(parse_revision_index("r.md"), None);
        assert_eq!(parse_revision_index("r12.txt"), None);
    }

    // ── improve_skill ──────────────────────────────────────

    #[tokio::test]
    async fn improve_skill_writes_new_file_without_touching_manifest() {
        let dir = tempfile::tempdir().unwrap();
        let skill_dir = dir.path().join("skills").join("test-skill");
        tokio::fs::create_dir_all(skill_dir.join("contents"))
            .await
            .unwrap();

        let original_manifest = "[skill]\nname = \"test-skill\"\nversion = \"0.1.0\"\n";
        tokio::fs::write(skill_dir.join("SKILL.toml"), original_manifest)
            .await
            .unwrap();
        // Pre-existing r1 so the new file should be r2.
        tokio::fs::write(
            skill_dir.join("contents/r1-2026-04-01.md"),
            "# original\n\nBody v1.\n",
        )
        .await
        .unwrap();

        let mut improver = SkillImprover::new(
            dir.path().to_path_buf(),
            SkillImprovementConfig {
                enabled: true,
                cooldown_secs: 0,
            },
        );

        let new_path = improver
            .improve_skill(
                "test-skill",
                "# improved\n\nBody v2.\n",
                "auto-improve test",
            )
            .await
            .unwrap()
            .expect("improvement written");

        // New file was created in contents/ and starts with `r2-`.
        let filename = new_path.file_name().unwrap().to_string_lossy().to_string();
        assert!(filename.starts_with("r2-"), "got {filename}");
        assert!(new_path.exists());
        let body = tokio::fs::read_to_string(&new_path).await.unwrap();
        assert!(body.contains("Body v2."));
        assert!(body.contains("<!-- improvement:"));
        assert!(body.contains("<!-- reason: auto-improve test -->"));

        // SKILL.toml is byte-for-byte unchanged.
        let manifest_after = tokio::fs::read_to_string(skill_dir.join("SKILL.toml"))
            .await
            .unwrap();
        assert_eq!(manifest_after, original_manifest);

        // r1 file is still there.
        assert!(skill_dir.join("contents/r1-2026-04-01.md").exists());

        // Temp file is cleaned up.
        let mut entries = tokio::fs::read_dir(skill_dir.join("contents"))
            .await
            .unwrap();
        while let Ok(Some(e)) = entries.next_entry().await {
            let n = e.file_name().to_string_lossy().to_string();
            assert!(!n.starts_with('.'), "stray temp file: {n}");
        }
    }

    #[tokio::test]
    async fn improve_skill_creates_contents_dir_if_missing() {
        let dir = tempfile::tempdir().unwrap();
        let skill_dir = dir.path().join("skills").join("fresh-skill");
        tokio::fs::create_dir_all(&skill_dir).await.unwrap();
        tokio::fs::write(skill_dir.join("SKILL.toml"), "[skill]\nname = \"fresh\"\n")
            .await
            .unwrap();

        let mut improver = SkillImprover::new(
            dir.path().to_path_buf(),
            SkillImprovementConfig {
                enabled: true,
                cooldown_secs: 0,
            },
        );

        let new_path = improver
            .improve_skill("fresh-skill", "# fresh\n", "first improvement")
            .await
            .unwrap()
            .expect("improvement written");
        assert!(
            new_path
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("r1-")
        );
        assert!(skill_dir.join("contents").is_dir());
    }

    #[tokio::test]
    async fn improve_skill_cooldown_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        let skill_dir = dir.path().join("skills").join("cd-skill");
        tokio::fs::create_dir_all(&skill_dir).await.unwrap();
        tokio::fs::write(skill_dir.join("SKILL.toml"), "[skill]\nname = \"cd\"\n")
            .await
            .unwrap();

        let mut improver = SkillImprover::new(
            dir.path().to_path_buf(),
            SkillImprovementConfig {
                enabled: true,
                cooldown_secs: 9999,
            },
        );
        improver
            .cooldowns
            .insert("cd-skill".to_string(), Instant::now());

        let result = improver
            .improve_skill("cd-skill", "# x\n", "test")
            .await
            .unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn improve_skill_invalid_content_aborts() {
        let dir = tempfile::tempdir().unwrap();
        let skill_dir = dir.path().join("skills").join("bad");
        tokio::fs::create_dir_all(&skill_dir).await.unwrap();
        tokio::fs::write(skill_dir.join("SKILL.toml"), "[skill]\nname = \"bad\"\n")
            .await
            .unwrap();

        let mut improver = SkillImprover::new(
            dir.path().to_path_buf(),
            SkillImprovementConfig {
                enabled: true,
                cooldown_secs: 0,
            },
        );

        let err = improver.improve_skill("bad", "", "empty").await;
        assert!(err.is_err());

        // Nothing was written under contents/.
        let contents_dir = skill_dir.join("contents");
        if contents_dir.exists() {
            let mut entries = tokio::fs::read_dir(&contents_dir).await.unwrap();
            if let Ok(Some(e)) = entries.next_entry().await {
                panic!("unexpected file: {}", e.path().display());
            }
        }
    }

    #[tokio::test]
    async fn improve_skill_missing_skill_dir_errors() {
        let dir = tempfile::tempdir().unwrap();
        let mut improver = SkillImprover::new(
            dir.path().to_path_buf(),
            SkillImprovementConfig {
                enabled: true,
                cooldown_secs: 0,
            },
        );
        let err = improver.improve_skill("nope", "# x\n", "r").await;
        assert!(err.is_err());
    }

    // ── Audit footer formatting ────────────────────────────

    #[test]
    fn format_content_with_audit_appends_footer() {
        let out = format_content_with_audit("# hi\n\nbody.\n", "smoother prompts");
        assert!(out.starts_with("# hi"));
        assert!(out.contains("<!-- improvement:"));
        assert!(out.contains("<!-- reason: smoother prompts -->"));
        assert!(out.ends_with('\n'));
    }

    #[test]
    fn format_content_with_audit_defangs_comment_close() {
        let out = format_content_with_audit("body", "evil --> escape");
        assert!(!out.contains("--> escape"));
        assert!(out.contains("—> escape"));
    }

    #[test]
    fn format_content_with_audit_collapses_newlines_in_reason() {
        let out = format_content_with_audit("body", "line1\nline2");
        assert!(out.contains("<!-- reason: line1 line2 -->"));
    }
}
