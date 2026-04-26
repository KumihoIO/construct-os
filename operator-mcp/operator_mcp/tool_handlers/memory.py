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
