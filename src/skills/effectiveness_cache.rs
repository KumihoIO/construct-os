//! Daemon-level effectiveness cache.
//!
//! Step 4 of the self-improving agent plan.  Backs the read side of
//! `record_skill_outcome` from PR #23 with a process-wide cache the
//! prompt builder can query synchronously while building each agent's
//! system prompt.
//!
//! ## Layout
//!
//! Per the operator-side handler in PR #23, each successful or failed
//! skill use is recorded under
//! `<memory_project>/Skills/<skill>/Outcomes/` with the outcome's slug
//! prefixed by `ok-` (success) or `fail-` (failure).  This cache lists
//! those items via [`KumihoClient::list_items`], classifies each by the
//! prefix, and stores `(rate, total)` per skill.
//!
//! ## Concurrency
//!
//! The cache is `Arc<EffectivenessCache>`-shareable and uses an internal
//! `RwLock` so the prompt builder can read scores without blocking the
//! background refresh task.  Refreshes are coalesced — multiple concurrent
//! callers of `refresh_for_skills` overlap their work but only the latest
//! snapshot is published.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::RwLock;

use crate::gateway::kumiho_client::{ItemResponse, KumihoClient, KumihoError};
use crate::skills::effectiveness::{EffectivenessScore, SkillEffectivenessProvider};

/// Default refresh interval for the background task — 5 minutes is a
/// reasonable balance between freshness (so a recent regression in a
/// skill propagates to the rerank quickly) and load on Kumiho (one
/// list-items call per skill per interval).
pub const DEFAULT_REFRESH_INTERVAL: Duration = Duration::from_secs(5 * 60);

/// Process-wide cache of recency-weighted skill effectiveness scores.
///
/// Construct this once at daemon startup, share via `Arc`, and call
/// [`Self::refresh_for_skills`] periodically (or use
/// [`Self::spawn_refresh_task`] for the standard background loop).
pub struct EffectivenessCache {
    scores: RwLock<HashMap<String, EffectivenessScore>>,
    /// Wall-clock time of the most recent successful refresh.  Used by
    /// callers that want to know whether the cache has any usable data
    /// before consulting it.
    last_refresh: RwLock<Option<Instant>>,
}

impl EffectivenessCache {
    /// Empty cache — every skill returns `None` until the first refresh
    /// completes.
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            scores: RwLock::new(HashMap::new()),
            last_refresh: RwLock::new(None),
        })
    }

    /// Number of skills currently in the cache.  Mostly useful for tests.
    pub fn len(&self) -> usize {
        self.scores.read().len()
    }

    /// Returns true when no scores have been loaded yet.
    pub fn is_empty(&self) -> bool {
        self.scores.read().is_empty()
    }

    /// Snapshot of the current scores — convenient for diagnostics or
    /// constructing an [`InMemoryProvider`] in tests.
    ///
    /// [`InMemoryProvider`]: crate::skills::effectiveness::InMemoryProvider
    pub fn snapshot(&self) -> HashMap<String, EffectivenessScore> {
        self.scores.read().clone()
    }

    /// `Some(elapsed)` since the last successful refresh, or `None` if
    /// the cache has never been refreshed.
    pub fn age(&self) -> Option<Duration> {
        self.last_refresh.read().map(|t| t.elapsed())
    }

    /// Replace the per-skill score map atomically.  Used internally by
    /// `refresh_for_skills` after computing fresh scores; exposed `pub`
    /// so callers (mostly tests + future daemon hooks) can publish their
    /// own snapshots without going through Kumiho.
    pub fn replace_scores(&self, scores: HashMap<String, EffectivenessScore>) {
        *self.scores.write() = scores;
        *self.last_refresh.write() = Some(Instant::now());
    }

    /// Refresh scores for the given skill names by listing each skill's
    /// outcomes space and tallying success / failure items.
    ///
    /// Failures for individual skills are logged and counted as zero —
    /// they don't poison the whole refresh.  The cache is replaced
    /// atomically once all skills have been processed.
    pub async fn refresh_for_skills(
        &self,
        client: &KumihoClient,
        memory_project: &str,
        skill_names: &[String],
    ) -> Result<(), KumihoError> {
        let mut new_scores: HashMap<String, EffectivenessScore> = HashMap::new();

        for name in skill_names {
            let safe = sanitize_skill_name(name);
            let space_path = format!("/{memory_project}/Skills/{safe}/Outcomes");
            // `include_deprecated=false` — deprecated outcomes are typically
            // ones the user explicitly retracted, so excluding them from the
            // success-rate calculation is the right default.
            let items = match client.list_items(&space_path, false).await {
                Ok(items) => items,
                Err(KumihoError::Api { status: 404, .. }) => {
                    // Space doesn't exist yet — skill has never been used.
                    Vec::new()
                }
                Err(e) => {
                    tracing::warn!(
                        skill = %name,
                        space = %space_path,
                        error = %e,
                        "skill effectiveness refresh failed for one skill; \
                         excluding from this snapshot",
                    );
                    continue;
                }
            };

            new_scores.insert(name.clone(), classify_outcomes(&items));
        }

        self.replace_scores(new_scores);
        Ok(())
    }

    /// Spawn a background tokio task that periodically calls
    /// `refresh_for_skills` until the daemon shuts down.  Returns the
    /// `JoinHandle` so callers can `abort()` on shutdown.
    ///
    /// The task runs immediately once on spawn, then on the supplied
    /// interval.  Errors from individual refresh cycles are logged and
    /// the task continues — only an explicit `abort()` stops it.
    pub fn spawn_refresh_task(
        self: Arc<Self>,
        client: Arc<KumihoClient>,
        memory_project: String,
        skill_names: Vec<String>,
        interval: Duration,
    ) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(interval);
            // Don't fall behind if a refresh takes longer than `interval`.
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                ticker.tick().await;
                if let Err(e) = self
                    .refresh_for_skills(&client, &memory_project, &skill_names)
                    .await
                {
                    tracing::warn!(
                        error = %e,
                        "effectiveness cache refresh cycle failed; will retry",
                    );
                }
            }
        })
    }
}

impl SkillEffectivenessProvider for EffectivenessCache {
    fn score(&self, skill_name: &str) -> Option<EffectivenessScore> {
        self.scores.read().get(skill_name).copied()
    }
}

/// Sanitize a skill name into the slug used by `record_skill_outcome`
/// when building the storage space path.  Mirrors the Python helper
/// `_outcomes_space` in `skill_outcomes.py`: replace `/` with `-`.
fn sanitize_skill_name(name: &str) -> String {
    name.replace('/', "-")
}

/// Classify a list of outcome items into a single [`EffectivenessScore`].
///
/// Detection mirrors the Python `_outcome_is_success` logic: items
/// whose `item_name` starts with `ok-` count as successes, items whose
/// `item_name` starts with `fail-` count as failures, anything else is
/// ignored as undetermined.  This keeps detection single-round-trip:
/// no per-item revision fetches required because the `[OK]` / `[FAIL]`
/// title prefix is preserved through slugification.
pub(crate) fn classify_outcomes(items: &[ItemResponse]) -> EffectivenessScore {
    let mut successes: u32 = 0;
    let mut failures: u32 = 0;
    for it in items {
        if it.item_name.starts_with("ok-") {
            successes = successes.saturating_add(1);
        } else if it.item_name.starts_with("fail-") {
            failures = failures.saturating_add(1);
        }
    }
    let total = successes.saturating_add(failures);
    let rate = if total == 0 {
        None
    } else {
        Some(f64::from(successes) / f64::from(total))
    };
    EffectivenessScore { rate, total }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(item_name: &str) -> ItemResponse {
        ItemResponse {
            kref: format!("kref://test/{item_name}"),
            name: item_name.to_string(),
            item_name: item_name.to_string(),
            kind: "skill_outcome".to_string(),
            deprecated: false,
            created_at: None,
            metadata: HashMap::new(),
        }
    }

    #[test]
    fn classify_outcomes_counts_ok_and_fail_prefixes() {
        let items = vec![
            item("ok-skill-on-mar-1-aa"),
            item("ok-skill-on-mar-2-bb"),
            item("ok-skill-on-mar-3-cc"),
            item("fail-skill-on-mar-4-dd"),
            item("fail-skill-on-mar-5-ee"),
        ];
        let score = classify_outcomes(&items);
        assert_eq!(score.total, 5);
        assert_eq!(score.rate, Some(0.6));
    }

    #[test]
    fn classify_outcomes_ignores_unprefixed_items() {
        let items = vec![
            item("ok-skill-aa"),
            item("legacy-undated-bb"), // no ok-/fail- prefix
            item("fail-skill-cc"),
        ];
        let score = classify_outcomes(&items);
        assert_eq!(score.total, 2);
        assert_eq!(score.rate, Some(0.5));
    }

    #[test]
    fn classify_outcomes_returns_none_rate_for_empty() {
        let score = classify_outcomes(&[]);
        assert_eq!(score.total, 0);
        assert_eq!(score.rate, None);
    }

    #[test]
    fn cache_score_returns_none_before_refresh() {
        let cache = EffectivenessCache::new();
        assert!(cache.is_empty());
        assert!(cache.score("anything").is_none());
        assert!(cache.age().is_none());
    }

    #[test]
    fn cache_replace_scores_publishes_atomically() {
        let cache = EffectivenessCache::new();
        let mut scores = HashMap::new();
        scores.insert(
            "alpha".to_string(),
            EffectivenessScore {
                rate: Some(0.9),
                total: 10,
            },
        );
        scores.insert(
            "beta".to_string(),
            EffectivenessScore {
                rate: Some(0.1),
                total: 5,
            },
        );
        cache.replace_scores(scores);

        let alpha = cache.score("alpha").expect("alpha present");
        assert_eq!(alpha.rate, Some(0.9));
        assert_eq!(alpha.total, 10);
        let beta = cache.score("beta").expect("beta present");
        assert_eq!(beta.total, 5);
        assert_eq!(cache.len(), 2);
        assert!(cache.age().is_some());
    }

    #[test]
    fn cache_implements_skill_effectiveness_provider() {
        let cache = EffectivenessCache::new();
        let mut scores = HashMap::new();
        scores.insert(
            "foo".to_string(),
            EffectivenessScore {
                rate: Some(0.75),
                total: 4,
            },
        );
        cache.replace_scores(scores);

        // Borrow through the trait — what PromptContext consumers do.
        let provider: &dyn SkillEffectivenessProvider = &*cache;
        assert!(provider.score("foo").is_some());
        assert!(provider.score("missing").is_none());
    }

    #[test]
    fn sanitize_skill_name_replaces_slashes() {
        assert_eq!(sanitize_skill_name("plain"), "plain");
        assert_eq!(sanitize_skill_name("with/slash"), "with-slash");
        assert_eq!(sanitize_skill_name("a/b/c"), "a-b-c");
    }
}
