"""Permission tool handlers: list pending, respond to requests."""
from __future__ import annotations

from typing import Any

from .._log import _log
from ..session_manager_client import SessionManagerClient


async def tool_list_pending_permissions(sidecar: SessionManagerClient) -> dict[str, Any]:
    """List all pending permission requests across agents."""
    if not await sidecar.ensure_running():
        return {"error": "Session manager sidecar not available", "pending": []}

    pending = await sidecar.list_pending_permissions()
    return {
        "pending": pending,
        "count": len(pending),
    }


async def tool_respond_to_permission(args: dict[str, Any], sidecar: SessionManagerClient) -> dict[str, Any]:
    """Approve or deny a pending permission request."""
    request_id = args["request_id"]
    action = args["action"]

    if action not in ("approve", "deny"):
        return {"error": f"Invalid action: {action}. Must be 'approve' or 'deny'."}

    result = await sidecar.respond_to_permission(
        request_id, action, by=args.get("by", "operator"),
    )
    return result
