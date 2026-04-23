use crate::config::schema::ModelPricing;
use crate::cost::CostTracker;
use crate::cost::types::{BudgetCheck, TokenUsage as CostTokenUsage};
use std::sync::Arc;

// ── Cost tracking via task-local ──

/// Context for cost tracking within the tool call loop.
/// Scoped via `tokio::task_local!` at call sites (channels, gateway).
#[derive(Clone)]
pub(crate) struct ToolLoopCostTrackingContext {
    pub tracker: Arc<CostTracker>,
    pub prices: Arc<std::collections::HashMap<String, ModelPricing>>,
}

impl ToolLoopCostTrackingContext {
    pub(crate) fn new(
        tracker: Arc<CostTracker>,
        prices: Arc<std::collections::HashMap<String, ModelPricing>>,
    ) -> Self {
        Self { tracker, prices }
    }
}

tokio::task_local! {
    pub(crate) static TOOL_LOOP_COST_TRACKING_CONTEXT: Option<ToolLoopCostTrackingContext>;
}

/// Record token usage from an LLM response via the task-local cost tracker.
/// Returns `(total_tokens, cost_usd)` on success, `None` when not scoped or no usage.
pub(crate) fn record_tool_loop_cost_usage(
    provider_name: &str,
    model: &str,
    usage: &crate::providers::traits::TokenUsage,
) -> Option<(u64, f64)> {
    let input_tokens = usage.input_tokens.unwrap_or(0);
    let output_tokens = usage.output_tokens.unwrap_or(0);
    let total_tokens = input_tokens.saturating_add(output_tokens);

    let ctx = TOOL_LOOP_COST_TRACKING_CONTEXT
        .try_with(Clone::clone)
        .ok()
        .flatten()?;

    if total_tokens == 0 {
        tracing::warn!(
            provider = provider_name,
            model,
            "Cost tracking received zero-token usage; recording request with zero tokens (provider may not be reporting usage)"
        );
    }
    // Multi-tier model pricing lookup:
    //   1. Direct name          → "claude-sonnet-4-6"
    //   2. Provider/model       → "anthropic/claude-sonnet-4-6"
    //   3. Suffix after `/`     → strip provider prefix from model string
    //   4. Fuzzy: find a pricing key whose model portion starts with our model's
    //      base name (e.g. "claude-sonnet-4" matches "anthropic/claude-sonnet-4-20250514").
    //      This handles short aliases (claude-sonnet-4-6) vs full versioned names.
    let pricing = ctx
        .prices
        .get(model)
        .or_else(|| ctx.prices.get(&format!("{provider_name}/{model}")))
        .or_else(|| {
            model
                .rsplit_once('/')
                .and_then(|(_, suffix)| ctx.prices.get(suffix))
        })
        .or_else(|| {
            // Derive a base name by stripping the last `-<digits>` segment for fuzzy matching.
            // "claude-sonnet-4-6" → base "claude-sonnet-4"
            // "claude-opus-4-20250514" → base "claude-opus-4"
            let base = model
                .rsplit_once('-')
                .filter(|(_, tail)| tail.chars().all(|c| c.is_ascii_digit()))
                .map_or(model, |(prefix, _)| prefix);
            ctx.prices.iter().find_map(|(key, entry)| {
                // Extract model portion after provider prefix: "anthropic/claude-sonnet-4-..." → "claude-sonnet-4-..."
                let model_part = key.rsplit_once('/').map_or(key.as_str(), |(_, m)| m);
                if model_part.starts_with(base) {
                    Some(entry)
                } else {
                    None
                }
            })
        });
    let cost_usage = CostTokenUsage::new(
        model,
        input_tokens,
        output_tokens,
        pricing.map_or(0.0, |entry| entry.input),
        pricing.map_or(0.0, |entry| entry.output),
    );

    if pricing.is_none() {
        tracing::debug!(
            provider = provider_name,
            model,
            "Cost tracking recorded token usage with zero pricing (no pricing entry found)"
        );
    }

    if let Err(error) = ctx.tracker.record_usage(cost_usage.clone()) {
        tracing::warn!(
            provider = provider_name,
            model,
            "Failed to record cost tracking usage: {error}"
        );
    }

    Some((cost_usage.total_tokens, cost_usage.cost_usd))
}

/// Check budget before an LLM call. Returns `None` when no cost tracking
/// context is scoped (tests, delegate, CLI without cost config).
pub(crate) fn check_tool_loop_budget() -> Option<BudgetCheck> {
    TOOL_LOOP_COST_TRACKING_CONTEXT
        .try_with(Clone::clone)
        .ok()
        .flatten()
        .map(|ctx| {
            ctx.tracker
                .check_budget(0.0)
                .unwrap_or(BudgetCheck::Allowed)
        })
}
