//! Runtime handles the MCP server may optionally receive from the main daemon.
//!
//! The standalone MCP binary (now removed) had to boot blind: it only knew the
//! workspace dir and a best-effort `Config`. Tools that depend on live runtime
//! state — a delegate agent pool, the channel map, a workspace manager, a
//! session store, a concrete provider — were silently skipped.
//!
//! Now that the MCP server runs as an in-process tokio task inside the main
//! daemon, the gateway can hand those handles down via [`RuntimeHandles`] and
//! the registry can register the previously-skipped tools.
//!
//! ## Design rules
//!
//! - Every field is `Option<Arc<_>>` so missing handles **degrade gracefully**
//!   — the tool is listed in `skipped` with a reason, never a panic.
//! - We deliberately **do not** import `gateway::AppState` here. That would
//!   create a module-layer cycle (gateway → mcp_server → gateway). Callers
//!   clone the Arcs they need out of `AppState` and pass them individually.
//! - Types come from the modules that own them, not from some central bag.
//!   If a caller wants to wire up `discord_search`, they pass the `Arc<dyn
//!   Memory>` backing discord.db directly — same shape the gateway uses.

use crate::channels::session_backend::SessionBackend;
use crate::config::DelegateAgentConfig;
use crate::config::workspace::WorkspaceManager;
use crate::memory::Memory;
use crate::providers::ProviderRuntimeOptions;
use crate::tools::Tool;
use crate::tools::ask_user::ChannelMapHandle;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock as TokioRwLock;

/// Aggregates `Arc`-clones of everything the previously-skipped MCP tools need.
///
/// The gateway builds this after its `AppState` is fully constructed, then
/// hands it to [`build_tools_with_runtime`](super::registry::build_tools_with_runtime).
///
/// All fields are optional; the registry gracefully skips a tool whenever its
/// required handle is `None`.
#[derive(Default, Clone)]
pub struct RuntimeHandles {
    /// Workspace manager for the `workspace` tool.
    pub workspace_manager: Option<Arc<TokioRwLock<WorkspaceManager>>>,

    /// Shared channel map (platform name → `Arc<dyn Channel>`) used by the
    /// `poll`, `reaction`, `ask_user`, and `escalate` tools.
    ///
    /// The same `Arc<RwLock<_>>` is threaded into every tool that needs it;
    /// when the channel supervisor populates it, all tools see the update.
    pub channel_map: Option<ChannelMapHandle>,

    /// Dedicated channel map handle for the `reaction` tool (it keeps its own
    /// handle so the gateway-facing tool and the MCP-facing tool share it).
    pub reaction_channels: Option<ChannelMapHandle>,

    /// Dedicated channel map handle for the `ask_user` tool.
    pub ask_user_channels: Option<ChannelMapHandle>,

    /// Dedicated channel map handle for the `escalate` tool.
    pub escalate_channels: Option<ChannelMapHandle>,

    /// Memory backend for `discord_search` (historically a separate
    /// SQLite store; currently unwired — pending a Kumiho-backed
    /// reimplementation).
    pub discord_memory: Option<Arc<dyn Memory>>,

    /// Session backend used by the `sessions_list`, `sessions_history`, and
    /// `sessions_send` tools.
    pub session_store: Option<Arc<dyn SessionBackend>>,

    /// Agent configurations for `delegate` and `swarm`. Cloned out of
    /// `Config.agents`.
    pub agent_config: Option<Arc<HashMap<String, DelegateAgentConfig>>>,

    /// Provider runtime options — supplies the credentials/url/reasoning
    /// preferences delegate sub-agents need when invoking LLMs.
    pub provider_runtime_options: Option<Arc<ProviderRuntimeOptions>>,

    /// Fallback API key for delegate sub-agents when the per-agent config
    /// doesn't supply one (same value passed to `all_tools_with_runtime`).
    pub fallback_api_key: Option<Arc<str>>,

    /// Escape hatch: pre-built tools constructed by the caller (e.g. the
    /// gateway's `all_tools_with_runtime` list) that the MCP registry should
    /// merge in wholesale.
    ///
    /// When present, each entry is folded in after the baseline — if a name
    /// collides, the pre-built tool wins. This lets the gateway forward its
    /// full live tool registry to MCP clients without the registry having to
    /// re-invoke every tool's constructor.
    pub pre_built_tools: Option<Vec<Arc<dyn Tool>>>,
}

impl RuntimeHandles {
    /// Create an empty `RuntimeHandles` where every field is `None`.
    ///
    /// Used by tests and by the degraded boot path if AppState construction
    /// failed before the MCP task spawned.
    #[must_use]
    pub fn empty() -> Self {
        Self::default()
    }
}
