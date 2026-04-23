"""Skill tool handlers: capture, list, load."""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

_MEMORY_PROJECT = os.environ.get("KUMIHO_MEMORY_PROJECT", "CognitiveMemory")

try:
    import httpx
except ImportError:
    httpx = None  # type: ignore

from .._log import _log
from ..kumiho_clients import KumihoAgentPoolClient
from ..skill_loader import list_skills, load_skill


async def tool_capture_skill(args: dict[str, Any], pool_client: KumihoAgentPoolClient) -> dict[str, Any]:
    if not pool_client._available:
        return {"error": "Kumiho not available. Skill not captured."}

    name = args["name"]
    domain = args["domain"]
    description = args["description"]
    procedure = args["procedure"]
    learned_from = args.get("learned_from", "")

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            headers = pool_client._headers()
            api = pool_client.api_url

            await client.post(f"{api}/api/v1/projects", json={"name": _MEMORY_PROJECT}, headers=headers)
            await client.post(f"{api}/api/v1/spaces", json={"parent_path": f"/{_MEMORY_PROJECT}", "name": "Skills"}, headers=headers)

            metadata = {
                "description": description,
                "domain": domain,
                "procedure": procedure,
                "learned_from": learned_from,
                "source": "operator-auto-capture",
                "created_at": datetime.now(timezone.utc).isoformat(),
            }

            resp = await client.get(
                f"{api}/api/v1/items/fulltext-search",
                params={"query": name, "context": _MEMORY_PROJECT, "space_path": f"/{_MEMORY_PROJECT}/Skills"},
                headers=headers,
            )
            existing_kref = None
            if resp.status_code == 200:
                results = resp.json() if isinstance(resp.json(), list) else []
                for item in results:
                    if item.get("item_name") == name:
                        existing_kref = item.get("kref")
                        break

            if existing_kref:
                await client.post(
                    f"{api}/api/v1/revisions",
                    json={"kref": existing_kref, "metadata": metadata},
                    headers=headers,
                )
                _log(f"Updated skill '{name}' (new revision)")
                return {"captured": True, "name": name, "kref": existing_kref, "action": "updated"}
            else:
                resp = await client.post(
                    f"{api}/api/v1/items",
                    json={
                        "space_path": f"/{_MEMORY_PROJECT}/Skills",
                        "item_name": name,
                        "kind": "skill",
                        "metadata": metadata,
                    },
                    headers=headers,
                )
                resp.raise_for_status()
                kref = resp.json().get("kref", "")
                if kref:
                    await client.post(
                        f"{api}/api/v1/revisions",
                        json={"kref": kref, "metadata": metadata},
                        headers=headers,
                    )
                _log(f"Captured new skill '{name}' [{domain}]")
                return {"captured": True, "name": name, "kref": kref, "action": "created"}
    except Exception as e:
        _log(f"Skill capture failed: {e}")
        return {"error": f"Failed to capture skill: {e}"}


async def tool_list_skills() -> dict[str, Any]:
    """List all available orchestration skills."""
    skills = list_skills()
    return {"skills": skills, "count": len(skills)}


async def tool_load_skill(args: dict[str, Any]) -> dict[str, Any]:
    """Load a specific skill's content."""
    name = args["name"]
    content = load_skill(name)
    if content is None:
        return {"error": f"Skill not found: {name}"}
    return {"name": name, "content": content}
