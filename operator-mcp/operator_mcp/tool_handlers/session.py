"""Session continuity tool handlers: history, archive."""
from __future__ import annotations

import json as _json
from datetime import datetime, timezone
from typing import Any

try:
    import httpx
except ImportError:
    httpx = None  # type: ignore

from .._log import _log
from ..construct_config import harness_project
from ..journal import SessionJournal
from ..kumiho_clients import KumihoAgentPoolClient


async def tool_get_session_history(args: dict[str, Any], journal: SessionJournal) -> dict[str, Any]:
    if args.get("list_sessions"):
        sessions = journal.list_sessions(limit=args.get("limit", 20))
        return {
            "sessions": sessions,
            "count": len(sessions),
            "current_session": journal.session_id,
        }

    entries = journal.load_history(
        limit=args.get("limit", 30),
        session_id=args.get("session_id"),
        agent_id=args.get("agent_id"),
    )
    return {
        "entries": entries,
        "count": len(entries),
        "current_session": journal.session_id,
    }


async def tool_archive_session(args: dict[str, Any], journal: SessionJournal, pool_client: KumihoAgentPoolClient) -> dict[str, Any]:
    if not pool_client._available:
        return {"error": "Kumiho not available. Session not archived."}

    session_id = args.get("session_id", journal.session_id)
    title = args["title"]
    summary = args["summary"]
    outcome = args["outcome"]

    entries = journal.load_history(limit=200, session_id=session_id)

    agents_seen: dict[str, dict[str, Any]] = {}
    for entry in reversed(entries):
        aid = entry.get("agent_id", "")
        if aid not in agents_seen:
            agents_seen[aid] = {
                "agent_id": aid,
                "title": entry.get("title", ""),
                "agent_type": entry.get("agent_type", ""),
                "template": entry.get("template", ""),
                "final_status": entry.get("event", ""),
            }
        else:
            agents_seen[aid]["final_status"] = entry.get("event", agents_seen[aid]["final_status"])

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            headers = pool_client._headers()
            api = pool_client.api_url

            _project = harness_project()
            await client.post(f"{api}/api/v1/projects", json={"name": _project}, headers=headers)
            await client.post(f"{api}/api/v1/spaces", json={"parent_path": f"/{_project}", "name": "Sessions"}, headers=headers)

            now = datetime.now(timezone.utc).isoformat()
            metadata = {
                "session_id": session_id,
                "title": title,
                "summary": summary,
                "outcome": outcome,
                "agent_count": len(agents_seen),
                "agents": _json.dumps(list(agents_seen.values())),
                "event_count": len(entries),
                "archived_at": now,
            }

            item_name = f"session-{session_id}-{title[:30].replace(' ', '-').lower()}"
            resp = await client.post(
                f"{api}/api/v1/items",
                json={
                    "space_path": f"/{_project}/Sessions",
                    "item_name": item_name,
                    "kind": "session",
                    "metadata": metadata,
                },
                headers=headers,
            )
            resp.raise_for_status()
            item = resp.json()
            kref = item.get("kref", "")

            if kref:
                await client.post(
                    f"{api}/api/v1/revisions",
                    json={"kref": kref, "metadata": metadata},
                    headers=headers,
                )

            try:
                journal.record(session_id, "archived", summary=title)
            except Exception:
                pass  # Non-critical — archive already persisted

            _log(f"Archived session '{session_id}' as '{item_name}'")
            return {
                "archived": True,
                "session_id": session_id,
                "kref": kref,
                "title": title,
                "outcome": outcome,
                "agent_count": len(agents_seen),
            }
    except Exception as e:
        _log(f"Session archive failed: {e}")
        return {"error": f"Failed to archive session: {e}"}
