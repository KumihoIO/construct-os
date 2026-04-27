"""Skill outcome tracking — closes the loop on agent self-improvement.

Step 3 of the self-improving agent plan. Whenever an agent uses a skill,
``record_skill_outcome`` should fire afterwards with ``success=True/False``
and an optional summary / error. Outcomes accumulate at::

    <memory_project>/Skills/<skill_slug>/Outcomes/

(``<memory_project>`` is the user-cognitive namespace, default
``CognitiveMemory``.)

``get_skill_effectiveness`` then computes a recency-weighted success rate
from the most recent outcomes, exposing it for the prompt builder
(``SkillsSection`` on the Rust side) to rerank skills before injection.
That is the substrate Hermes Agent calls "skill self-improvement during
use" — Construct gets the same loop without the SQLite + DSPy stack
because the outcomes already live in the Kumiho graph with edges back
to the skill they exercised.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from .._log import _log
from ..construct_config import memory_project

try:
    from kumiho.mcp_server import (
        tool_memory_store,
        tool_search_items,
    )

    _HAS_KUMIHO = True
except ImportError:
    _HAS_KUMIHO = False


def _unavailable() -> dict[str, Any]:
    return {
        "error": "kumiho package not available — install via `construct sidecars install`",
    }


def _resolve_skill_name(skill_name: str | None, skill_kref: str | None) -> str | None:
    """Pull the slug out of a kref if no explicit name is given.

    krefs look like::

        kref://CognitiveMemory/Skills/operator-orchestrator.skilldef?r=3

    We want ``operator-orchestrator``.
    """
    if skill_name and skill_name.strip():
        return skill_name.strip()
    if not skill_kref:
        return None
    s = skill_kref.split("?", 1)[0]  # drop revision query
    s = s.rstrip("/")
    last = s.rsplit("/", 1)[-1]
    # last looks like "operator-orchestrator.skilldef"
    return last.split(".", 1)[0] if "." in last else last


def _outcomes_space(skill_name: str) -> str:
    """Resolve the storage space for a skill's outcomes.

    Uses the configured ``memory_project`` so deployments that rebrand
    keep all skill outcomes under the right namespace.
    """
    safe = (skill_name or "unknown").replace("/", "-")
    return f"/{memory_project()}/Skills/{safe}/Outcomes"


# ---------------------------------------------------------------------------
# record_skill_outcome
# ---------------------------------------------------------------------------


async def tool_record_skill_outcome_op(args: dict[str, Any]) -> dict[str, Any]:
    """Record a single skill use outcome.

    Required: either ``skill_name`` or ``skill_kref``, plus ``success`` (bool).

    Stores under ``<memory_project>/Skills/<skill>/Outcomes/`` with the
    skill's kref recorded as ``source_revision_krefs`` so the graph traces
    each outcome back to the exact skill revision that produced it.
    """
    if not _HAS_KUMIHO:
        return _unavailable()

    skill_name = _resolve_skill_name(args.get("skill_name"), args.get("skill_kref"))
    if not skill_name:
        return {"error": "skill_name or skill_kref is required"}

    success = bool(args.get("success", False))
    summary = (args.get("summary") or "").strip()
    error = (args.get("error") or "").strip()
    agent_id = args.get("agent_id", "")
    session_id = args.get("session_id", "")
    duration_ms = args.get("duration_ms")
    skill_kref = args.get("skill_kref", "")

    kind = "success" if success else "failure"
    when = datetime.now(timezone.utc).strftime("%b %d %H:%M UTC")
    # The title's leading marker survives slugification as the FIRST token of
    # the resulting item_name (`ok-…` or `fail-…`). _outcome_is_success uses
    # that prefix as a reliable classifier, since neither tool_search_items
    # nor tool_fulltext_search currently surface our custom revision tags.
    marker = "[OK]" if success else "[FAIL]"
    title = f"{marker} {skill_name} on {when}"
    # Prefer summary, fall back to error message, then to a marker so the
    # underlying tool_memory_store call (which requires user_text or
    # assistant_text) does not reject the request.
    body = summary or error or kind

    tags = ["skill-outcome", kind, f"skill:{skill_name}"]
    if agent_id:
        tags.append(f"agent:{agent_id}")
    if session_id:
        tags.append(f"session:{session_id}")

    metadata: dict[str, Any] = {
        "skill_name": skill_name,
        "success": "true" if success else "false",
        "kind": kind,
    }
    if agent_id:
        metadata["agent_id"] = agent_id
    if session_id:
        metadata["session_id"] = session_id
    if duration_ms is not None:
        metadata["duration_ms"] = str(duration_ms)
    if error:
        metadata["error"] = error
    if skill_kref:
        metadata["skill_kref"] = skill_kref

    space_path = _outcomes_space(skill_name)

    try:
        result = await asyncio.to_thread(
            tool_memory_store,
            project=memory_project(),
            space_path=space_path,
            memory_type=kind,  # 'success' or 'failure'
            memory_item_kind="skill_outcome",
            title=title,
            summary=body,
            assistant_text=body,
            tags=tags,
            source_revision_krefs=[skill_kref] if skill_kref else [],
            metadata=metadata,
            edge_type="DERIVED_FROM",
            stack_revisions=False,  # outcomes are append-only
        )
    except Exception as e:  # noqa: BLE001
        _log(f"record_skill_outcome failed: {e}")
        return {"error": f"store failed: {e}"}

    if isinstance(result, dict) and "error" in result:
        return result

    kref = (
        result.get("revision_kref")
        or result.get("item_kref")
        or result.get("kref")
        if isinstance(result, dict)
        else None
    )

    return {
        "kref": kref,
        "skill_name": skill_name,
        "kind": kind,
        "success": success,
        "space_path": space_path,
    }


# ---------------------------------------------------------------------------
# get_skill_effectiveness
# ---------------------------------------------------------------------------


def _outcome_is_success(item: dict[str, Any]) -> bool | None:
    """Return True/False for a skill_outcome item, or None if undeterminable.

    Detection priority:
    1. ``item_name`` slug prefix — ``ok-…`` (success) or ``fail-…`` (failure).
       Set deterministically by record_skill_outcome via the ``[OK]`` /
       ``[FAIL]`` title marker. This is the primary classifier because
       Kumiho's item-level search response doesn't currently expose
       revision-level tags / memory_type.
    2. Revision metadata fallbacks for items that DO carry them (e.g.
       fetched via tool_get_revision rather than tool_search_items).
    """
    item_name = (item.get("item_name") or item.get("name") or "").lower()
    if item_name.startswith("ok-"):
        return True
    if item_name.startswith("fail-"):
        return False

    tags = item.get("tags") or []
    if "success" in tags:
        return True
    if "failure" in tags:
        return False
    mt = (item.get("memory_type") or "").lower()
    if mt == "success":
        return True
    if mt == "failure":
        return False
    meta = item.get("metadata") or {}
    s = str(meta.get("success", "")).lower()
    if s == "true":
        return True
    if s == "false":
        return False
    return None


async def tool_get_skill_effectiveness_op(args: dict[str, Any]) -> dict[str, Any]:
    """Compute rolling success rate for a skill from its recent outcomes.

    Required: ``skill_name`` or ``skill_kref``.
    Optional: ``limit`` (default 50, max 500), ``window_days`` (only count
    outcomes newer than this; default unlimited).

    Returns::

        {
          skill_name, total, successes, failures,
          rate,                 # successes / total, or None if total == 0
          recent: [...],        # newest-first, capped at 10
          space_path
        }
    """
    if not _HAS_KUMIHO:
        return _unavailable()

    skill_name = _resolve_skill_name(args.get("skill_name"), args.get("skill_kref"))
    if not skill_name:
        return {"error": "skill_name or skill_kref is required"}

    raw_limit = args.get("limit", 50)
    try:
        limit = max(1, min(int(raw_limit), 500))
    except (TypeError, ValueError):
        limit = 50

    space_path = _outcomes_space(skill_name)
    context = space_path.lstrip("/")

    try:
        raw = await asyncio.to_thread(
            tool_search_items,
            context_filter=context,
            kind_filter="skill_outcome",
            include_metadata=True,
        )
    except Exception as e:  # noqa: BLE001
        _log(f"get_skill_effectiveness failed: {e}")
        return {"error": f"search failed: {e}"}

    items = []
    if isinstance(raw, dict):
        items = raw.get("items") or []

    # Sort newest first by created_at when present.
    try:
        items.sort(key=lambda it: it.get("created_at") or "", reverse=True)
    except Exception:  # noqa: BLE001
        pass
    items = items[:limit]

    successes = 0
    failures = 0
    undetermined = 0
    for it in items:
        match _outcome_is_success(it):
            case True:
                successes += 1
            case False:
                failures += 1
            case _:
                undetermined += 1

    total = successes + failures
    rate = (successes / total) if total > 0 else None

    return {
        "skill_name": skill_name,
        "total": total,
        "successes": successes,
        "failures": failures,
        "undetermined": undetermined,
        "rate": rate,
        "recent": items[:10],
        "space_path": space_path,
    }
