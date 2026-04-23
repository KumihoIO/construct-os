"""Artifact diffing — compare agent outputs across runs.

Compares two agents' work by examining:
  - Files touched: added, removed, common
  - Output text: last_message similarity
  - Tool call patterns: what tools each agent used
  - Error divergence: different failure patterns

Usage (via MCP tool):
    diff_agent_artifacts(agent_a="...", agent_b="...")
"""
from __future__ import annotations

import hashlib
from difflib import SequenceMatcher
from typing import Any

from .agent_state import AGENTS
from .run_log import get_log


# ---------------------------------------------------------------------------
# Core diff logic
# ---------------------------------------------------------------------------

def _get_agent_artifacts(agent_id: str) -> dict[str, Any] | None:
    """Extract artifacts from an agent's run log."""
    agent = AGENTS.get(agent_id)
    if agent is None:
        return None

    run_log = get_log(agent_id)
    sidecar_id = getattr(agent, "_sidecar_id", None)
    if run_log is None and sidecar_id:
        run_log = get_log(sidecar_id)

    if run_log is None:
        # Minimal fallback
        return {
            "agent_id": agent_id,
            "title": agent.title,
            "status": agent.status,
            "files_touched": [],
            "last_message": agent.stdout_buffer[-4000:] if agent.stdout_buffer else "",
            "tool_calls": [],
            "errors": [],
            "tool_call_count": 0,
            "error_count": 0,
        }

    summary = run_log.get_summary()
    return {
        "agent_id": agent_id,
        "title": agent.title if agent else "",
        "status": summary.get("status", agent.status if agent else ""),
        "files_touched": summary.get("files_touched", []),
        "last_message": summary.get("last_message", ""),
        "tool_calls": run_log.get_tool_calls(limit=100),
        "errors": run_log.get_errors(),
        "tool_call_count": summary.get("tool_call_count", 0),
        "error_count": summary.get("error_count", 0),
    }


def _file_hash(path: str) -> str | None:
    """SHA256 hash of a file, or None if not readable. Reads in chunks."""
    try:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            while True:
                chunk = f.read(65536)
                if not chunk:
                    break
                h.update(chunk)
        return h.hexdigest()[:16]
    except (OSError, IOError):
        return None


def diff_artifacts(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    """Compute structured diff between two agents' artifacts."""
    files_a = set(a.get("files_touched", []))
    files_b = set(b.get("files_touched", []))

    # File sets
    common_files = sorted(files_a & files_b)
    only_a = sorted(files_a - files_b)
    only_b = sorted(files_b - files_a)

    # File content hashes for common files (detect same-file divergence)
    file_diffs: list[dict[str, Any]] = []
    for f in common_files:
        h = _file_hash(f)
        file_diffs.append({
            "file": f,
            "current_hash": h,
        })

    # Output text similarity
    msg_a = a.get("last_message", "")
    msg_b = b.get("last_message", "")
    text_similarity = 0.0
    if msg_a and msg_b:
        text_similarity = round(SequenceMatcher(None, msg_a[:2000], msg_b[:2000]).ratio(), 3)

    # Tool call patterns
    tools_a = _tool_call_summary(a.get("tool_calls", []))
    tools_b = _tool_call_summary(b.get("tool_calls", []))

    all_tools = sorted(set(tools_a.keys()) | set(tools_b.keys()))
    tool_comparison = []
    for tool in all_tools:
        count_a = tools_a.get(tool, 0)
        count_b = tools_b.get(tool, 0)
        if count_a != count_b:
            tool_comparison.append({
                "tool": tool,
                "agent_a": count_a,
                "agent_b": count_b,
                "delta": count_b - count_a,
            })

    # Error divergence
    errors_a = a.get("errors", [])
    errors_b = b.get("errors", [])

    return {
        "agent_a": {
            "id": a["agent_id"],
            "title": a.get("title", ""),
            "status": a.get("status", ""),
            "file_count": len(files_a),
            "tool_call_count": a.get("tool_call_count", 0),
            "error_count": a.get("error_count", 0),
        },
        "agent_b": {
            "id": b["agent_id"],
            "title": b.get("title", ""),
            "status": b.get("status", ""),
            "file_count": len(files_b),
            "tool_call_count": b.get("tool_call_count", 0),
            "error_count": b.get("error_count", 0),
        },
        "files": {
            "common": common_files,
            "only_in_a": only_a,
            "only_in_b": only_b,
            "common_count": len(common_files),
            "divergence": len(only_a) + len(only_b),
        },
        "output_similarity": text_similarity,
        "tool_divergence": tool_comparison if tool_comparison else None,
        "error_comparison": {
            "a_errors": len(errors_a),
            "b_errors": len(errors_b),
            "a_error_types": _error_type_summary(errors_a),
            "b_error_types": _error_type_summary(errors_b),
        },
    }


def _tool_call_summary(tool_calls: list[dict[str, Any]]) -> dict[str, int]:
    """Count tool calls by name."""
    counts: dict[str, int] = {}
    for tc in tool_calls:
        name = tc.get("tool", tc.get("name", "unknown"))
        counts[name] = counts.get(name, 0) + 1
    return counts


def _error_type_summary(errors: list[dict[str, Any]]) -> list[str]:
    """Extract unique error types/codes."""
    types = set()
    for e in errors:
        t = e.get("type", e.get("code", e.get("tool", "")))
        if t:
            types.add(t)
    return sorted(types)


# ---------------------------------------------------------------------------
# Tool handler
# ---------------------------------------------------------------------------

async def tool_diff_agent_artifacts(args: dict[str, Any]) -> dict[str, Any]:
    """Compare outputs and artifacts of two agents.

    Args:
        agent_a: First agent ID.
        agent_b: Second agent ID.
    """
    agent_a_id = args.get("agent_a", "")
    agent_b_id = args.get("agent_b", "")

    if not agent_a_id or not agent_b_id:
        return {"error": "Both agent_a and agent_b are required"}

    artifacts_a = _get_agent_artifacts(agent_a_id)
    if artifacts_a is None:
        return {"error": f"Agent {agent_a_id} not found"}

    artifacts_b = _get_agent_artifacts(agent_b_id)
    if artifacts_b is None:
        return {"error": f"Agent {agent_b_id} not found"}

    return diff_artifacts(artifacts_a, artifacts_b)
