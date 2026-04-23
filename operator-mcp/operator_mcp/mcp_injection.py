"""MCP injection — builds MCP server configs for agent sessions.

Provides two MCP servers for injection into agent sessions:
  1. kumiho-memory — full Kumiho memory graph access
  2. operator-tools — subset of operator tools for hierarchical spawning

Also handles system prompt layering:
  - Top-level agents: operator prompt + memory bootstrap + user task
  - Sub-agents: memory bootstrap + role identity + parent task
"""
from __future__ import annotations

import os
from typing import Any

from ._log import _log

# -- Paths -------------------------------------------------------------------

_HOME = os.path.expanduser("~")
_KUMIHO_PLUGIN_ROOT = os.path.join(_HOME, ".construct/workspace/kumiho-plugins/claude")
_KUMIHO_MCP_SCRIPT = os.path.join(_KUMIHO_PLUGIN_ROOT, "scripts/run_kumiho_mcp.py")
_OPERATOR_DIR = os.path.dirname(os.path.abspath(__file__))
_OPERATOR_SUBAGENT_MCP = os.path.join(_OPERATOR_DIR, "subagent_mcp.py")


# -- MCP server configs ------------------------------------------------------

def kumiho_memory_config() -> dict[str, Any] | None:
    """Build kumiho-memory MCP stdio config for agent injection.

    Returns None if the kumiho MCP script doesn't exist.
    """
    if not os.path.exists(_KUMIHO_MCP_SCRIPT):
        _log(f"Kumiho MCP script not found: {_KUMIHO_MCP_SCRIPT}")
        return None

    # Use the system python or kumiho venv python
    python = os.path.join(_HOME, ".kumiho/venv/bin/python3")
    if not os.path.exists(python):
        python = "python3"

    # Pass through auth token and control plane URL from environment
    env: dict[str, str] = {
        "CLAUDE_PLUGIN_ROOT": _KUMIHO_PLUGIN_ROOT,
        "KUMIHO_AUTO_CONFIGURE": "1",
    }
    for key in (
        "KUMIHO_AUTH_TOKEN",
        "KUMIHO_CONTROL_PLANE_URL",
        "KUMIHO_MCP_LOG_LEVEL",
        "KUMIHO_AUTO_ASSESS",
    ):
        val = os.environ.get(key)
        if val:
            env[key] = val

    return {
        "type": "stdio",
        "command": python,
        "args": [_KUMIHO_MCP_SCRIPT],
        "env": env,
    }


def operator_tools_config(socket_path: str | None = None) -> dict[str, Any]:
    """Build operator-tools MCP stdio config for sub-agent injection.

    Exposes a subset of operator tools so sub-agents can spawn children,
    check siblings, and (Phase 4) post to chat rooms.
    """
    python = os.path.join(_HOME, ".construct/operator_mcp/venv/bin/python3")
    if not os.path.exists(python):
        python = "python3"

    env: dict[str, str] = {}
    if socket_path:
        env["CONSTRUCT_SIDECAR_SOCKET"] = socket_path

    return {
        "type": "stdio",
        "command": python,
        "args": [_OPERATOR_SUBAGENT_MCP],
        "env": env,
    }


def build_mcp_servers(
    include_memory: bool = True,
    include_operator: bool = True,
    socket_path: str | None = None,
) -> dict[str, Any]:
    """Build the full MCP servers dict for agent session injection."""
    servers: dict[str, Any] = {}

    if include_memory:
        mem = kumiho_memory_config()
        if mem:
            servers["kumiho-memory"] = mem

    if include_operator:
        servers["operator-tools"] = operator_tools_config(socket_path)

    return servers


# -- System prompt layering ---------------------------------------------------

_OPERATOR_PROMPT = """\
You are a sub-agent managed by the Construct Operator. You have access to \
operator-tools MCP which lets you spawn child agents, check their status, \
and coordinate work.

Guidelines:
- Focus on your assigned task. Be thorough but efficient.
- Use create_agent to delegate subtasks when the work is too large or spans \
different domains.
- Use get_agent_activity and wait_for_agent to monitor children.
- Report results clearly — your parent agent reads your output.
- If context grows large, call compact_conversation to trigger structured \
compaction. The summary is stored in Kumiho for cross-session recall."""

_MEMORY_BOOTSTRAP = """\
You have access to kumiho-memory MCP for persistent memory. Use \
kumiho_memory_engage before responding to topics that might have history. \
Use kumiho_memory_reflect after substantive responses to capture decisions, \
preferences, and facts."""

_SUB_AGENT_PREAMBLE = """\
You are a worker agent spawned by a parent operator agent. Focus entirely \
on the task you've been given. Be thorough, verify your work, and report \
results clearly."""


def build_system_prompt(
    *,
    is_top_level: bool = False,
    role_identity: str = "",
    template_hint: str = "",
    include_memory: bool = True,
    include_operator: bool = True,
    skill_pattern: str = "",
) -> str:
    """Build a layered system prompt for an agent session.

    Top-level agents get the operator prompt + memory bootstrap + skills.
    Sub-agents get a simpler preamble + role identity.

    skill_pattern: orchestration pattern name (team, loop, committee, handoff, chat)
                   to inject relevant skill instructions.
    """
    from .skill_loader import load_skills_for_pattern

    parts: list[str] = []

    # Lean mode: no MCP tools → minimal preamble, no tool instructions
    no_tools = not include_memory and not include_operator

    if is_top_level:
        if include_operator:
            parts.append(_OPERATOR_PROMPT)
        if include_memory:
            parts.append(_MEMORY_BOOTSTRAP)
    elif no_tools:
        # Single-turn worker: skip tool instructions entirely
        parts.append(
            "You are a specialist worker agent. Focus entirely on the task. "
            "Produce your output directly — do not search, do not use tools, "
            "do not ask clarifying questions. Write your complete response."
        )
    else:
        parts.append(_SUB_AGENT_PREAMBLE)
        if include_memory:
            parts.append(_MEMORY_BOOTSTRAP)

    if role_identity:
        parts.append(f"\n## Your Role\n{role_identity}")

    if template_hint:
        parts.append(f"\n## Context\n{template_hint}")

    # Inject orchestration skills if pattern specified
    if skill_pattern:
        skill_content = load_skills_for_pattern(skill_pattern)
        if skill_content:
            parts.append(f"\n## Orchestration Skills\n{skill_content}")

    return "\n\n".join(parts)
