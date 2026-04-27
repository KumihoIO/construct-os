//! LLM-driven skill rewrite.
//!
//! Step 5 of the self-improving agent plan — closes the feedback loop.
//! [`crate::skills::EffectivenessCache::improvement_candidates`] surfaces
//! skills whose rolling success rate has regressed; this module takes a
//! candidate, asks an LLM to propose a revised SKILL.toml, validates the
//! response, and writes it through the cooldown-aware
//! [`SkillImprover`].
//!
//! Gated behind `#[cfg(feature = "skill-creation")]` to mirror
//! [`SkillImprover`]'s own gate.
//!
//! ## Design
//!
//! The hot path is intentionally narrow:
//!
//!   1. Cooldown check via `SkillImprover::should_improve_skill` so we
//!      don't spam an LLM call for a skill we just rewrote.
//!   2. Read the current `SKILL.toml` content from
//!      `<workspace>/skills/<slug>/SKILL.toml`.  If the file does not
//!      exist we skip — the cache may be tracking outcomes for a skill
//!      that was loaded from a different location and we cannot rewrite
//!      it safely.
//!   3. Build a focused system + user prompt that includes the current
//!      content, the regression statistics, and a strict response format
//!      ("only valid TOML inside a ```toml fence").
//!   4. Call `provider.chat` with `tools=None` — this is a pure
//!      generation request, no tool calls expected.
//!   5. Extract the first ```toml fence from the response.  Return early
//!      if no fence is found rather than guess.
//!   6. Hand the extracted content + a structured improvement reason to
//!      `SkillImprover::improve_skill`, which validates + atomically
//!      writes + records the cooldown.
//!
//! Test coverage focuses on the two pure helpers — fence extraction and
//! prompt composition — which are the parts most likely to misbehave on
//! variant LLM responses.  The end-to-end async path is covered by the
//! daemon integration that consumes this module.

use anyhow::{Context, Result, anyhow, bail};
use std::path::Path;
use std::sync::Arc;

use crate::providers::traits::{ChatMessage, ChatRequest, Provider};
use crate::skills::effectiveness_cache::SkillImprovementCandidate;
use crate::skills::improver::SkillImprover;

/// All the pieces an auto-improvement attempt needs from the daemon.  The
/// daemon constructs one of these once at startup (or per attempt — the
/// fields are cheap clones) and threads it into the background task that
/// consumes [`SkillImprovementCandidate`]s.
pub struct AutoImproveContext {
    /// Construct workspace root — `SKILL.toml` lives at
    /// `<workspace>/skills/<slug>/SKILL.toml`.
    pub workspace_dir: std::path::PathBuf,
    /// LLM provider to call for the rewrite proposal.
    pub provider: Arc<dyn Provider>,
    /// Model name to pass through to `provider.chat`.
    pub model: String,
    /// Sampling temperature.  Default conservative — these rewrites
    /// should be deterministic-ish.
    pub temperature: f64,
}

/// Default temperature for skill rewrite LLM calls.  Low so the proposed
/// TOML stays close to the original structure rather than wandering.
pub const DEFAULT_REWRITE_TEMPERATURE: f64 = 0.3;

/// Attempt to improve a single regressed skill.
///
/// Returns:
/// - `Ok(Some(slug))` — improvement was generated, validated, and atomically
///   written.  `improver`'s cooldown is now armed for this skill.
/// - `Ok(None)` — skipped (cooldown not expired, file missing, LLM
///   response unparseable).  No state was changed.
/// - `Err(_)` — fatal error (filesystem, network, validation).  Caller
///   should log and continue with the next candidate.
pub async fn attempt_skill_improvement(
    ctx: &AutoImproveContext,
    candidate: &SkillImprovementCandidate,
    improver: &mut SkillImprover,
) -> Result<Option<String>> {
    if !improver.should_improve_skill(&candidate.skill_name) {
        return Ok(None);
    }

    // Read current SKILL.toml.  If it doesn't exist on disk we can't
    // rewrite it — skip silently so the loop doesn't fail on every
    // refresh.
    let toml_path = ctx
        .workspace_dir
        .join("skills")
        .join(&candidate.skill_name)
        .join("SKILL.toml");

    let current = match tokio::fs::read_to_string(&toml_path).await {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            tracing::debug!(
                skill = %candidate.skill_name,
                path = %toml_path.display(),
                "auto-improve: SKILL.toml not found on disk; skipping",
            );
            return Ok(None);
        }
        Err(e) => {
            return Err(anyhow!(e).context(format!(
                "auto-improve: failed to read {}",
                toml_path.display()
            )));
        }
    };

    let prompt = build_improvement_prompt(&current, candidate);

    let messages = [
        ChatMessage::system(
            "You revise SKILL.toml files so they avoid the failure patterns the user reports. \
             Return ONLY a single complete SKILL.toml inside a ```toml ... ``` fenced code block. \
             Preserve the [skill] name and version-bump the patch component. \
             Do not include explanation outside the fence.",
        ),
        ChatMessage::user(prompt),
    ];

    let response = ctx
        .provider
        .chat(
            ChatRequest {
                messages: &messages,
                tools: None,
            },
            &ctx.model,
            ctx.temperature,
        )
        .await
        .context("auto-improve: LLM chat call failed")?;

    let new_content = match extract_toml_fence(response.text_or_empty()) {
        Some(s) => s,
        None => {
            tracing::warn!(
                skill = %candidate.skill_name,
                rate = candidate.rate,
                "auto-improve: LLM response missing ```toml fence; skipping",
            );
            return Ok(None);
        }
    };

    let reason = format!(
        "auto-improve: rolling success {:.0}% over last {} outcomes",
        candidate.rate * 100.0,
        candidate.total
    );

    improver
        .improve_skill(&candidate.skill_name, &new_content, &reason)
        .await
}

/// Build the user-side prompt content.  Pure function — exposed so tests
/// can assert it includes what we need without spinning up an LLM.
pub fn build_improvement_prompt(
    current_skill_toml: &str,
    candidate: &SkillImprovementCandidate,
) -> String {
    format!(
        "The skill below has regressed.  Recent rolling success rate is \
         **{rate_pct:.0}%** over **{total}** outcomes — well below our \
         {threshold_pct:.0}% threshold for healthy skills.\n\n\
         Please propose an improved SKILL.toml that addresses common \
         failure modes for this kind of skill.  Focus on:\n\
         - clearer step-by-step instructions in the `prompts` array,\n\
         - tighter parameter validation,\n\
         - explicit handling of edge cases the original may have missed,\n\
         - safer defaults,\n\
         - keeping the `[skill]` name unchanged and bumping `version` \
         patch component (e.g. `0.1.0` → `0.1.1`).\n\n\
         Return ONLY the complete revised SKILL.toml inside a ```toml \
         fenced block — no commentary outside the fence.\n\n\
         ## Current SKILL.toml\n\n\
         ```toml\n\
         {current}\n\
         ```\n",
        rate_pct = candidate.rate * 100.0,
        total = candidate.total,
        threshold_pct = crate::skills::effectiveness_cache::DEFAULT_IMPROVEMENT_THRESHOLD * 100.0,
        current = current_skill_toml.trim_end(),
    )
}

/// Extract the contents of the first ```toml ... ``` fenced code block.
///
/// We are deliberately lenient about formatting — the fence may have
/// trailing whitespace on the opening line, the closing fence may be
/// preceded by a newline or be on its own line.  We are strict about
/// requiring the explicit `toml` language tag so we don't accidentally
/// pick up an unrelated block.
///
/// Returns `None` if no `toml` fence is found.  Returns the contents
/// trimmed of leading and trailing whitespace.
pub fn extract_toml_fence(text: &str) -> Option<String> {
    // Look for the opening fence.  We tolerate optional whitespace after
    // the language tag (some models emit `​```toml ` or `​```toml\r\n`).
    let needle = "```toml";
    let start = text.find(needle)?;
    let after_open = &text[start + needle.len()..];

    // Skip the rest of the opening fence line.
    let body_start = after_open.find('\n').map(|i| i + 1).unwrap_or(0);
    let body = &after_open[body_start..];

    // Find the closing fence.  We accept either `\n```` at the start of
    // a line or the bare `\`\`\`` if the body has no trailing newline.
    let close = body.find("\n```").or_else(|| body.find("```"))?;
    let inner = &body[..close];

    // Strip leading newlines / trailing whitespace.
    let trimmed = inner.trim_matches(|c: char| c == '\n' || c == '\r');
    let final_trim = trimmed.trim_end();
    if final_trim.is_empty() {
        None
    } else {
        Some(final_trim.to_string())
    }
}

/// Validate that a workspace directory is shaped the way `improve_skill`
/// expects (has `skills/<slug>/SKILL.toml`).  Used by the daemon hook
/// before it bothers calling the LLM, so a misconfigured workspace fails
/// fast with a clear error.
pub fn skill_toml_path(workspace_dir: &Path, skill_name: &str) -> std::path::PathBuf {
    workspace_dir
        .join("skills")
        .join(skill_name)
        .join("SKILL.toml")
}

/// Convenience guard for callers that want to bail before any I/O when
/// the skill isn't on disk.  Returns true when `SKILL.toml` exists.
pub async fn skill_is_writable(workspace_dir: &Path, skill_name: &str) -> bool {
    tokio::fs::try_exists(skill_toml_path(workspace_dir, skill_name))
        .await
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Tests — focus on the pure helpers (extract_toml_fence + build_improvement_prompt).
// The end-to-end async path is exercised by the daemon integration.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn cand(name: &str, rate: f64, total: u32) -> SkillImprovementCandidate {
        SkillImprovementCandidate {
            skill_name: name.to_string(),
            rate,
            total,
        }
    }

    // ── extract_toml_fence ─────────────────────────────────────────

    #[test]
    fn extract_toml_fence_basic() {
        let text = "Here is the rewrite:\n\
                    ```toml\n\
                    [skill]\n\
                    name = \"foo\"\n\
                    ```\n";
        let got = extract_toml_fence(text).expect("fence present");
        assert!(got.contains("[skill]"));
        assert!(got.contains("name = \"foo\""));
    }

    #[test]
    fn extract_toml_fence_handles_trailing_whitespace_on_opener() {
        let text = "```toml   \n\
                    name = \"x\"\n\
                    ```";
        let got = extract_toml_fence(text).expect("fence present");
        assert_eq!(got, "name = \"x\"");
    }

    #[test]
    fn extract_toml_fence_returns_none_when_missing() {
        assert!(extract_toml_fence("no fence here").is_none());
        assert!(extract_toml_fence("```python\nprint('x')\n```").is_none());
    }

    #[test]
    fn extract_toml_fence_returns_none_when_empty_body() {
        let text = "```toml\n```";
        assert!(extract_toml_fence(text).is_none());
    }

    #[test]
    fn extract_toml_fence_first_block_only() {
        let text = "```toml\n\
                    [skill]\nname = \"a\"\n\
                    ```\n\
                    \n\
                    ```toml\n\
                    [skill]\nname = \"b\"\n\
                    ```";
        let got = extract_toml_fence(text).expect("fence present");
        assert!(got.contains("name = \"a\""));
        assert!(!got.contains("name = \"b\""));
    }

    #[test]
    fn extract_toml_fence_strips_leading_newlines() {
        let text = "```toml\n\n\nname = \"y\"\n```";
        let got = extract_toml_fence(text).expect("fence present");
        // No leading newlines.
        assert!(got.starts_with("name"));
    }

    // ── build_improvement_prompt ───────────────────────────────────

    #[test]
    fn build_improvement_prompt_includes_stats() {
        let current = "[skill]\nname = \"x\"\n";
        let prompt = build_improvement_prompt(current, &cand("x", 0.25, 40));
        // Includes the rate (rounded to integer percent in the prompt).
        assert!(
            prompt.contains("**25%**"),
            "rate not in prompt: {prompt}"
        );
        // Includes the sample count.
        assert!(prompt.contains("**40** outcomes"));
        // Includes the threshold so the LLM knows the bar.
        assert!(prompt.contains("40%"));
    }

    #[test]
    fn build_improvement_prompt_includes_current_skill() {
        let current = "[skill]\nname = \"sentinel-skill\"\nversion = \"0.4.2\"\n";
        let prompt = build_improvement_prompt(current, &cand("sentinel-skill", 0.1, 20));
        assert!(prompt.contains("sentinel-skill"));
        assert!(prompt.contains("0.4.2"));
        // Wrapped in a ```toml fence so the LLM sees a clean block.
        assert!(prompt.contains("```toml"));
    }

    #[test]
    fn build_improvement_prompt_keeps_response_format_strict() {
        let prompt = build_improvement_prompt("[skill]\nname = \"x\"\n", &cand("x", 0.2, 15));
        assert!(prompt.contains("Return ONLY"));
        assert!(prompt.contains("toml fenced block"));
    }

    // ── skill_toml_path ────────────────────────────────────────────

    #[test]
    fn skill_toml_path_composes_correctly() {
        let p = skill_toml_path(Path::new("/tmp/ws"), "my-skill");
        assert!(p.ends_with("skills/my-skill/SKILL.toml"));
    }
}
