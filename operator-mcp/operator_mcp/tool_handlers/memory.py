"""Operator memory tools — expose Kumiho memory operations as first-class MCP tools.

The kumiho-memory MCP server is injected into agent sessions, but the Operator
itself only used Kumiho indirectly via KUMIHO_SDK for team/pool management.
That meant the orchestrator could not query or write the shared memory graph
directly — and ``list_tools`` reported an incomplete view of what's available.

This module re-exposes the most useful kumiho.mcp_server tool functions under
operator-namespaced names (``memory_*``) so the orchestrator can engage memory
the same way agents do.
"""
from __future__ import annotations

import asyncio
from typing import Any

from .._log import _log

try:
    from kumiho.mcp_server import (
        tool_memory_store,
        tool_memory_retrieve,
        tool_get_item,
        tool_search_items,
        tool_fulltext_search,
        tool_resolve_kref,
        tool_get_revision_by_tag,
    )

    _HAS_KUMIHO = True
except ImportError:
    _HAS_KUMIHO = False


def _unavailable() -> dict[str, Any]:
    return {
        "error": "kumiho package not available — install via `construct sidecars install`",
    }


# ---------------------------------------------------------------------------
# Memory retrieval (read-side)
# ---------------------------------------------------------------------------


async def tool_memory_retrieve_op(args: dict[str, Any]) -> dict[str, Any]:
    """Fuzzy memory retrieval — Google-like semantic search across memory items.

    Returns a list of matching items with revision metadata. Best for natural
    language queries like "what did we decide about gRPC vs REST".
    """
    if not _HAS_KUMIHO:
        return _unavailable()
    return await asyncio.to_thread(
        tool_memory_retrieve,
        project=args.get("project", "CognitiveMemory"),
        query=args.get("query", ""),
        keywords=args.get("keywords"),
        topics=args.get("topics"),
        space_paths=args.get("space_paths"),
        memory_item_kind=args.get("memory_item_kind", "conversation"),
        limit=args.get("limit", 5),
        mode=args.get("mode", "search"),
        memory_types=args.get("memory_types"),
    )


async def tool_memory_search_op(args: dict[str, Any]) -> dict[str, Any]:
    """Structured search by name/kind/context. Use for exact-match lookups."""
    if not _HAS_KUMIHO:
        return _unavailable()
    return await asyncio.to_thread(
        tool_search_items,
        context_filter=args.get("context_filter", ""),
        name_filter=args.get("name_filter", ""),
        kind_filter=args.get("kind_filter", ""),
        include_metadata=args.get("include_metadata", False),
    )


async def tool_memory_fulltext_op(args: dict[str, Any]) -> dict[str, Any]:
    """Full-text fuzzy search across items (Google-like)."""
    if not _HAS_KUMIHO:
        return _unavailable()
    query = args.get("query")
    if not query:
        return {"error": "query is required"}
    return await asyncio.to_thread(
        tool_fulltext_search,
        query=query,
        context=args.get("context", ""),
        kind=args.get("kind", ""),
        include_deprecated=args.get("include_deprecated", False),
        include_revision_metadata=args.get("include_revision_metadata", False),
        limit=args.get("limit", 20),
    )


async def tool_memory_get_item_op(args: dict[str, Any]) -> dict[str, Any]:
    """Get an item by its kref URI."""
    if not _HAS_KUMIHO:
        return _unavailable()
    kref = args.get("kref")
    if not kref:
        return {"error": "kref is required"}
    return await asyncio.to_thread(tool_get_item, kref=kref)


async def tool_memory_resolve_kref_op(args: dict[str, Any]) -> dict[str, Any]:
    """Resolve a kref URI into its concrete item / revision identifiers."""
    if not _HAS_KUMIHO:
        return _unavailable()
    kref = args.get("kref")
    if not kref:
        return {"error": "kref is required"}
    return await asyncio.to_thread(tool_resolve_kref, kref=kref)


async def tool_memory_get_revision_by_tag_op(args: dict[str, Any]) -> dict[str, Any]:
    """Get a specific revision by its tag (e.g. 'published', 'stable')."""
    if not _HAS_KUMIHO:
        return _unavailable()
    item_kref = args.get("item_kref")
    tag = args.get("tag", "published")
    if not item_kref:
        return {"error": "item_kref is required"}
    return await asyncio.to_thread(tool_get_revision_by_tag, item_kref=item_kref, tag=tag)


# ---------------------------------------------------------------------------
# Memory writes
# ---------------------------------------------------------------------------


async def tool_memory_store_op(args: dict[str, Any]) -> dict[str, Any]:
    """Store a memory bundle (decision, fact, preference, summary, etc.).

    Auto-stacks revisions on similar items by default to avoid duplicates.
    """
    if not _HAS_KUMIHO:
        return _unavailable()
    return await asyncio.to_thread(
        tool_memory_store,
        project=args.get("project", "CognitiveMemory"),
        space_path=args.get("space_path", ""),
        space_hint=args.get("space_hint", ""),
        memory_item_kind=args.get("memory_item_kind", "conversation"),
        bundle_name=args.get("bundle_name", ""),
        memory_type=args.get("memory_type", "summary"),
        title=args.get("title", ""),
        summary=args.get("summary", ""),
        user_text=args.get("user_text", ""),
        assistant_text=args.get("assistant_text", ""),
        tags=args.get("tags"),
        source_revision_krefs=args.get("source_revision_krefs"),
        metadata=args.get("metadata"),
        edge_type=args.get("edge_type", "DERIVED_FROM"),
        stack_revisions=args.get("stack_revisions", True),
    )


# ---------------------------------------------------------------------------
# Composite skill-behaviors (engage / reflect)
#
# These mirror the agent-side kumiho_memory_engage / kumiho_memory_reflect
# tools so the Operator gets the same ergonomic two-reflex API. They are
# composed from the underlying kumiho.mcp_server primitives: engage =
# retrieve + summarize, reflect = store-with-provenance for each capture.
# ---------------------------------------------------------------------------


def _summarize_for_context(items: list[dict[str, Any]]) -> str:
    """Format retrieve results into a compact context string for the caller."""
    if not items:
        return "(no relevant memories)"
    lines: list[str] = []
    for it in items:
        title = it.get("title") or it.get("name") or it.get("item_name") or "(untitled)"
        memory_type = it.get("memory_type") or it.get("kind") or ""
        summary = (it.get("summary") or it.get("preview") or "").strip()
        created = it.get("created_at") or ""
        prefix = f"- [{memory_type}] " if memory_type else "- "
        suffix = f" ({created})" if created else ""
        body = f" — {summary}" if summary else ""
        lines.append(f"{prefix}{title}{suffix}{body}")
    return "\n".join(lines)


def _extract_kref(item: dict[str, Any]) -> str | None:
    """Pull the most-specific kref available from a retrieve result."""
    for key in ("revision_kref", "kref", "item_kref"):
        v = item.get(key)
        if isinstance(v, str) and v:
            return v
    return None


async def tool_memory_engage_op(args: dict[str, Any]) -> dict[str, Any]:
    """Recall + context-build in one call. Operator-side equivalent of
    ``kumiho_memory_engage``.

    Returns ``{context, results, source_krefs, count}`` — pass ``source_krefs``
    to ``memory_reflect`` to create DERIVED_FROM edges from new captures back
    to the recalled items (provenance graph).
    """
    if not _HAS_KUMIHO:
        return _unavailable()
    query = args.get("query")
    if not query:
        return {"error": "query is required"}

    raw = await asyncio.to_thread(
        tool_memory_retrieve,
        project=args.get("project", "CognitiveMemory"),
        query=query,
        keywords=args.get("keywords"),
        topics=args.get("topics"),
        space_paths=args.get("space_paths"),
        memory_item_kind=args.get("memory_item_kind", "conversation"),
        limit=args.get("limit", 5),
        mode=args.get("mode", "search"),
        memory_types=args.get("memory_types"),
        include_revision_metadata=True,
    )

    if isinstance(raw, dict) and "error" in raw:
        return raw

    # tool_memory_retrieve may key results under "items" or "results"
    items = []
    if isinstance(raw, dict):
        items = raw.get("items") or raw.get("results") or []
    elif isinstance(raw, list):
        items = raw

    source_krefs: list[str] = []
    seen: set[str] = set()
    for it in items:
        kref = _extract_kref(it) if isinstance(it, dict) else None
        if kref and kref not in seen:
            seen.add(kref)
            source_krefs.append(kref)

    return {
        "context": _summarize_for_context(items if isinstance(items, list) else []),
        "results": items,
        "source_krefs": source_krefs,
        "count": len(items) if isinstance(items, list) else 0,
    }


async def tool_memory_reflect_op(args: dict[str, Any]) -> dict[str, Any]:
    """Store captures with provenance edges to the krefs from a prior engage.
    Operator-side equivalent of ``kumiho_memory_reflect``.

    Each capture is ``{type, title, content, tags?, space_hint?}``. For each
    capture we call ``tool_memory_store`` with ``source_revision_krefs`` set
    to the engage source_krefs (creates DERIVED_FROM edges) and stack
    revisions on similar items by default.
    """
    if not _HAS_KUMIHO:
        return _unavailable()

    session_id = args.get("session_id", "")
    response = args.get("response", "")
    captures = args.get("captures") or []
    source_krefs = args.get("source_krefs") or []
    space_path = args.get("space_path", "")
    project = args.get("project", "CognitiveMemory")

    if not isinstance(captures, list):
        return {"error": "captures must be a list of {type, title, content, ...}"}

    stored_krefs: list[str] = []
    failed: list[dict[str, Any]] = []

    for cap in captures:
        if not isinstance(cap, dict):
            failed.append({"capture": str(cap), "error": "capture must be an object"})
            continue
        title = cap.get("title", "")
        content = cap.get("content", "")
        if not title:
            failed.append({"capture": cap, "error": "title is required"})
            continue
        try:
            r = await asyncio.to_thread(
                tool_memory_store,
                project=project,
                space_path=cap.get("space_hint") or space_path,
                memory_type=cap.get("type", "summary"),
                title=title,
                summary=content,
                tags=cap.get("tags") or [],
                source_revision_krefs=list(source_krefs),
                metadata={"session_id": session_id} if session_id else None,
                edge_type="DERIVED_FROM",
                stack_revisions=True,
            )
            kref = (
                r.get("revision_kref")
                or r.get("item_kref")
                or r.get("kref")
                if isinstance(r, dict)
                else None
            )
            if kref:
                stored_krefs.append(kref)
            elif isinstance(r, dict) and "error" in r:
                failed.append({"title": title, "error": r["error"]})
        except Exception as e:  # noqa: BLE001
            _log(f"memory_reflect: store failed for {title!r}: {e}")
            failed.append({"title": title, "error": str(e)})

    return {
        "buffered": bool(response),
        "captures_stored": len(stored_krefs),
        "stored_krefs": stored_krefs,
        "failed": failed,
        "session_id": session_id,
    }
