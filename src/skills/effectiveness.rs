//! Skill effectiveness — recency-weighted success scores for skill reranking.
//!
//! The operator MCP records success / failure outcomes per skill use under
//! `<memory_project>/Skills/<skill>/Outcomes/`.  This module is the **read
//! side** of that pipeline: it defines the score type and the provider trait
//! the prompt builder consumes when injecting the "Available Skills" section.
//!
//! ## Why a trait, not a concrete type
//!
//! The actual score source lives outside this crate's hot path:
//!
//!   - In production it is a daemon-level cache that periodically queries
//!     Kumiho via the operator's `get_skill_effectiveness` tool.
//!   - In tests it is whatever in-memory map the test wires up.
//!   - In default / disabled mode it is the [`NoOpProvider`] returned by
//!     [`no_op_provider`] which keeps the existing static skill order.
//!
//! Keeping the trait small (one synchronous lookup) means the prompt builder
//! can call it for each skill at sort time without adding async machinery to
//! the build path.

use std::collections::HashMap;

/// A single skill's recency-weighted effectiveness score.
///
/// `rate` is `successes / (successes + failures)`.  `None` means we have
/// no data for this skill yet — callers should treat that as neutral
/// rather than penalising the skill.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct EffectivenessScore {
    /// Success rate in [0.0, 1.0].  `None` when no outcomes have been
    /// recorded (cold start).
    pub rate: Option<f64>,
    /// Total number of resolved outcomes (successes + failures) backing
    /// this score.  Used as a confidence tie-breaker when rates match.
    pub total: u32,
}

impl EffectivenessScore {
    /// Score that's used for sorting when `rate` is unknown.
    ///
    /// We default to `0.5` (neutral) for cold-start skills so they neither
    /// dominate the top of the list (which would be unfair to skills with a
    /// proven track record) nor sink to the bottom (which would prevent new
    /// skills from ever accumulating outcomes in the first place).
    pub const NEUTRAL: f64 = 0.5;

    /// Sortable key for ranking.  Higher key = preferred placement.
    ///
    /// Ties on `rate` break in favour of higher `total` so skills with
    /// more evidence rank above skills with the same rate but fewer
    /// outcomes — `(0.8, 50)` outranks `(0.8, 3)`.
    pub fn sort_key(&self) -> (f64, u32) {
        (self.rate.unwrap_or(Self::NEUTRAL), self.total)
    }
}

/// Read-only lookup of `EffectivenessScore` per skill name.
///
/// Implementations must be cheap and synchronous — the prompt builder calls
/// `score()` once per skill while assembling the system prompt.
pub trait SkillEffectivenessProvider: Send + Sync {
    fn score(&self, skill_name: &str) -> Option<EffectivenessScore>;
}

/// Returns no scores — preserves the existing static load order of skills
/// in the prompt.  Used as the default when scoring is disabled or when
/// a daemon hasn't wired a real provider yet.
#[derive(Debug, Default, Clone, Copy)]
pub struct NoOpProvider;

impl SkillEffectivenessProvider for NoOpProvider {
    fn score(&self, _skill_name: &str) -> Option<EffectivenessScore> {
        None
    }
}

/// Convenience constructor — returns a [`NoOpProvider`] reference suitable
/// for `Option<&dyn SkillEffectivenessProvider>` defaults.  Static so call
/// sites don't need to manage lifetimes for the no-op case.
pub fn no_op_provider() -> &'static dyn SkillEffectivenessProvider {
    static NOOP: NoOpProvider = NoOpProvider;
    &NOOP
}

/// In-memory provider backed by a `HashMap<String, EffectivenessScore>`.
///
/// Convenient for tests, daemon caches, and any caller that already has
/// a snapshot of scores in memory.  See `src/skills/mod.rs` tests for
/// usage.
#[derive(Debug, Default, Clone)]
pub struct InMemoryProvider {
    scores: HashMap<String, EffectivenessScore>,
}

impl InMemoryProvider {
    pub fn new(scores: HashMap<String, EffectivenessScore>) -> Self {
        Self { scores }
    }

    pub fn insert(&mut self, name: impl Into<String>, score: EffectivenessScore) {
        self.scores.insert(name.into(), score);
    }
}

impl SkillEffectivenessProvider for InMemoryProvider {
    fn score(&self, skill_name: &str) -> Option<EffectivenessScore> {
        self.scores.get(skill_name).copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neutral_constant_is_half() {
        assert_eq!(EffectivenessScore::NEUTRAL, 0.5);
    }

    #[test]
    fn sort_key_uses_neutral_for_unknown_rate() {
        let s = EffectivenessScore {
            rate: None,
            total: 0,
        };
        assert_eq!(s.sort_key(), (0.5, 0));
    }

    #[test]
    fn sort_key_breaks_ties_by_total() {
        let a = EffectivenessScore {
            rate: Some(0.8),
            total: 50,
        };
        let b = EffectivenessScore {
            rate: Some(0.8),
            total: 3,
        };
        assert!(a.sort_key() > b.sort_key());
    }

    #[test]
    fn no_op_provider_returns_none() {
        let p = NoOpProvider;
        assert!(p.score("anything").is_none());
    }

    #[test]
    fn no_op_provider_static_works() {
        let p = no_op_provider();
        assert!(p.score("foo").is_none());
    }

    #[test]
    fn in_memory_provider_returns_inserted_scores() {
        let mut p = InMemoryProvider::default();
        p.insert(
            "foo",
            EffectivenessScore {
                rate: Some(0.9),
                total: 10,
            },
        );
        let s = p.score("foo").expect("foo should be present");
        assert_eq!(s.rate, Some(0.9));
        assert_eq!(s.total, 10);
        assert!(p.score("missing").is_none());
    }
}
