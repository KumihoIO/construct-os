"""Memory Graph aggregation — Obsidian-style force-graph endpoint.

Uses kumiho SDK directly (gRPC) for maximum performance:
- `traverse_edges` for single-call edge fetching (server-side Neo4j walk)
- `batch_get_revisions` for single-call metadata
- In-memory TTL cache to make repeat loads instant
"""
from __future__ import annotations

import asyncio
import os
import time
from collections import defaultdict
from typing import Any

_MEMORY_PROJECT = os.environ.get("KUMIHO_MEMORY_PROJECT", "CognitiveMemory")

from .._log import _log

try:
    from kumiho.mcp_server import (
        _ensure_configured,
        tool_get_spaces,
        tool_search_items,
        tool_fulltext_search,
    )
    import kumiho
    _HAS_KUMIHO = True

    try:
        from kumiho.mcp_server import tool_batch_get_revisions
    except ImportError:
        tool_batch_get_revisions = None  # type: ignore[assignment]
except ImportError:
    _HAS_KUMIHO = False


# ---------------------------------------------------------------------------
# Cache — 30-second TTL, keyed by (project, limit, kinds, space, sort, search)
# ---------------------------------------------------------------------------

_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_CACHE_TTL = 30.0  # seconds


def _cache_key(args: dict[str, Any]) -> str:
    return "|".join(
        str(args.get(k, ""))
        for k in ("project", "limit", "kinds", "space", "sort", "search")
    )


def _cache_get(key: str) -> dict[str, Any] | None:
    entry = _cache.get(key)
    if entry and (time.monotonic() - entry[0]) < _CACHE_TTL:
        return entry[1]
    return None


def _cache_set(key: str, value: dict[str, Any]) -> None:
    # Evict stale entries (simple sweep)
    now = time.monotonic()
    stale = [k for k, (t, _) in _cache.items() if now - t > _CACHE_TTL * 2]
    for k in stale:
        del _cache[k]
    _cache[key] = (now, value)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _strip_kref(kref: str) -> str:
    """Strip kref:// prefix if present."""
    return kref.removeprefix("kref://")


def _revision_kref_to_item_id(rev_kref: str) -> str:
    """kref://CognitiveMemory/foo.decision?rev=3 → CognitiveMemory/foo.decision"""
    stripped = _strip_kref(rev_kref)
    return stripped.split("?")[0]


def _item_kref_to_space(kref: str) -> str:
    """kref://CognitiveMemory/personal/foo.decision → CognitiveMemory/personal"""
    stripped = _strip_kref(kref)
    pos = stripped.rfind("/")
    return stripped[:pos] if pos >= 0 else ""


# ---------------------------------------------------------------------------
# Edge fetching — use traverse_edges (single gRPC call) with per-item fallback
# ---------------------------------------------------------------------------


def _traverse_one(client: Any, rk: str) -> list[dict[str, Any]]:
    """Fetch edges for a single revision kref."""
    try:
        result = client.traverse_edges(
            origin_kref=kumiho.Kref(rk),
            direction=2,  # BOTH
            max_depth=1,
            limit=200,
        )
        edges = []
        for edge in result.edges:
            entry: dict[str, Any] = {
                "source_kref": str(edge.source_kref),
                "target_kref": str(edge.target_kref),
                "edge_type": edge.edge_type,
            }
            if edge.metadata:
                entry["metadata"] = dict(edge.metadata)
            edges.append(entry)
        return edges
    except Exception as e:
        _log(f"traverse_edges failed for {rk}: {e}")
        return []


def _traverse_edges_bulk(rev_krefs: list[str]) -> list[dict[str, Any]]:
    """Fetch edges for many revisions using concurrent ThreadPool.

    Uses ThreadPoolExecutor to parallelize gRPC calls (max 20 concurrent).
    Deduplicates edges by (source, target, edge_type).
    """
    from concurrent.futures import ThreadPoolExecutor

    if not rev_krefs:
        return []

    _ensure_configured()
    client = kumiho.get_client()
    all_edges: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()

    with ThreadPoolExecutor(max_workers=min(20, len(rev_krefs))) as pool:
        futures = [pool.submit(_traverse_one, client, rk) for rk in rev_krefs]
        for future in futures:
            for entry in future.result():
                key = (entry["source_kref"], entry["target_kref"], entry["edge_type"])
                if key not in seen:
                    seen.add(key)
                    all_edges.append(entry)

    return all_edges


# ---------------------------------------------------------------------------
# Main handler
# ---------------------------------------------------------------------------


async def tool_memory_graph(
    args: dict[str, Any],
    sdk: Any,
) -> dict[str, Any]:
    """Aggregate memory items, revisions, and edges into a single graph payload."""

    if not _HAS_KUMIHO:
        return {"error": "Kumiho SDK not available"}

    t0 = time.monotonic()

    # Check cache first
    ck = _cache_key(args)
    cached = _cache_get(ck)
    if cached is not None:
        _log(f"memory_graph: cache hit ({time.monotonic() - t0:.3f}s)")
        return cached

    project = args.get("project", _MEMORY_PROJECT)
    limit = min(args.get("limit", 100), 500)
    kind_filter_raw = args.get("kinds", "")
    kind_filter = [k.strip() for k in kind_filter_raw.split(",") if k.strip()] if kind_filter_raw else []
    space_filter = args.get("space", "")
    sort_mode = args.get("sort", "recent")
    search_query = args.get("search", "")

    # 1+2. Fetch spaces and items concurrently (two gRPC calls in parallel)
    def _get_spaces():
        r = tool_get_spaces(project, recursive=True)
        if "error" in r:
            return []
        return r.get("spaces", [])

    def _get_items():
        if search_query:
            r = tool_fulltext_search(query=search_query, context=project, limit=limit * 2)
            results = r.get("results", [])
            return [res.get("item", res) for res in results]
        else:
            context = space_filter.lstrip("/") if space_filter else project
            r = tool_search_items(context_filter=context)
            if "error" in r:
                _log(f"memory_graph: list_all error: {r['error']}")
                return []
            items = r.get("items", [])
            return [i for i in items if not i.get("deprecated")]

    spaces_result, all_items = await asyncio.gather(
        asyncio.to_thread(_get_spaces),
        asyncio.to_thread(_get_items),
    )

    space_paths = [f"/{project}"] + [s.get("path", "") for s in spaces_result]
    if space_filter:
        space_paths = [s for s in space_paths if s.startswith(space_filter) or s == space_filter]

    t1 = time.monotonic()
    _log(f"memory_graph: spaces+items fetched in {t1 - t0:.2f}s ({len(spaces_result)} spaces, {len(all_items)} items)")

    # 3. Apply kind filter
    if kind_filter:
        all_items = [item for item in all_items if item.get("kind", "") in kind_filter]

    # 4. Sort
    if sort_mode == "name":
        all_items.sort(key=lambda x: x.get("item_name", x.get("name", "")))
    else:
        all_items.sort(key=lambda x: x.get("created_at", "") or "", reverse=True)

    # Build kind counts before truncating
    kind_counts: dict[str, int] = defaultdict(int)
    for item in all_items:
        kind_counts[item.get("kind", "unknown")] += 1
    total_items_count = len(all_items)

    # 5. Truncate to limit
    all_items = all_items[:limit]

    # 6. Batch-fetch latest revisions for metadata (single gRPC call)
    item_krefs = [item.get("kref", "") for item in all_items if item.get("kref")]
    rev_map = await sdk.batch_get_revisions(item_krefs, tag="latest") if item_krefs else {}

    t2 = time.monotonic()
    _log(f"memory_graph: revisions fetched in {t2 - t1:.2f}s ({len(rev_map)} revisions)")

    # 7. Build nodes
    nodes = []
    item_id_set: set[str] = set()
    rev_krefs: list[str] = []

    for item in all_items:
        kref = item.get("kref", "")
        item_id = _strip_kref(kref)
        space = _item_kref_to_space(kref)

        rev = rev_map.get(kref)
        meta = rev.get("metadata", {}) if rev else {}
        rev_kref = rev.get("kref") if rev else None

        nodes.append({
            "id": item_id,
            "name": item.get("item_name", item.get("name", "")),
            "kind": item.get("kind", ""),
            "space": space,
            "created_at": item.get("created_at"),
            "title": meta.get("title"),
            "summary": meta.get("summary"),
            "revision_kref": rev_kref,
        })
        item_id_set.add(item_id)

        if rev_kref:
            rev_krefs.append(rev_kref)

    # 8. Build structural edges: item→space and space→parent_space
    #    This is instant (in-memory) and gives the graph its hierarchy.
    edges: list[dict[str, Any]] = []

    # Add space nodes (only spaces that contain items in the result set)
    spaces_with_items: set[str] = set()
    for node in nodes:
        sp = node.get("space", "")
        if sp:
            spaces_with_items.add(sp)
            # Also add ancestor spaces up to the project root
            parts = sp.split("/")
            for i in range(1, len(parts)):
                spaces_with_items.add("/".join(parts[:i]))

    space_node_ids: set[str] = set()
    for sp in sorted(spaces_with_items):
        sp_id = sp  # e.g. "CognitiveMemory/arxiv-paper/visibility"
        if sp_id not in item_id_set:
            nodes.append({
                "id": sp_id,
                "name": sp.split("/")[-1],
                "kind": "space",
                "space": "/".join(sp.split("/")[:-1]) if "/" in sp else "",
                "created_at": None,
                "title": None,
                "summary": None,
                "revision_kref": None,
            })
            space_node_ids.add(sp_id)

    all_node_ids = item_id_set | space_node_ids

    # Item → parent space edges
    for node in nodes:
        if node["kind"] == "space":
            continue
        sp = node.get("space", "")
        if sp and sp in all_node_ids:
            edges.append({
                "source": node["id"],
                "target": sp,
                "edge_type": "BELONGS_TO",
            })

    # Space → parent space edges
    for sp_id in space_node_ids:
        if "/" in sp_id:
            parent = "/".join(sp_id.split("/")[:-1])
            if parent in all_node_ids:
                edges.append({
                    "source": sp_id,
                    "target": parent,
                    "edge_type": "CHILD_OF",
                })

    # 9. Also fetch real graph edges (DERIVED_FROM, etc.) if items have them.
    #    Run in parallel, but don't block on it — skip if too slow.
    if rev_krefs:
        try:
            raw_edges = await asyncio.wait_for(
                asyncio.to_thread(_traverse_edges_bulk, rev_krefs),
                timeout=5.0,  # Cap at 5s — structural edges are the priority
            )
            seen_edges: set[tuple[str, str, str]] = set()
            for edge in raw_edges:
                source_id = _revision_kref_to_item_id(edge.get("source_kref", ""))
                target_id = _revision_kref_to_item_id(edge.get("target_kref", ""))
                if source_id == target_id:
                    continue
                if source_id not in all_node_ids or target_id not in all_node_ids:
                    continue
                key = (source_id, target_id, edge.get("edge_type", ""))
                if key not in seen_edges:
                    seen_edges.add(key)
                    edges.append({
                        "source": source_id,
                        "target": target_id,
                        "edge_type": edge.get("edge_type", ""),
                    })
        except asyncio.TimeoutError:
            _log("memory_graph: traverse_edges timed out (5s), using structural edges only")

    t3 = time.monotonic()
    _log(f"memory_graph: edges built in {t3 - t2:.2f}s ({len(edges)} edges, {len(space_node_ids)} space nodes)")

    # Update kind counts with space nodes
    kind_counts["space"] = len(space_node_ids)

    result = {
        "nodes": nodes,
        "edges": edges,
        "spaces": [s.lstrip("/") for s in space_paths],
        "stats": {
            "total_items": total_items_count,
            "total_edges": len(edges),
            "kinds": dict(kind_counts),
        },
    }

    elapsed = time.monotonic() - t0
    _log(f"memory_graph: done in {elapsed:.2f}s — {len(nodes)} nodes, {len(edges)} edges")

    # Cache the result
    _cache_set(ck, result)

    return result
