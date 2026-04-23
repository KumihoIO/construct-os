"""Chat room tool handlers: create, post, read, list, wait, delete.

Inter-agent communication via persistent chat rooms hosted in the TS sidecar.
Agents use @mentions to actively notify other agents.
"""
from __future__ import annotations

from typing import Any

from .._log import _log
from ..session_manager_client import SessionManagerClient


async def tool_chat_create(args: dict[str, Any], sidecar: SessionManagerClient) -> dict[str, Any]:
    """Create a named chat room with a purpose description."""
    name = args["name"]
    purpose = args.get("purpose", "")

    if not await sidecar.ensure_running():
        return {"error": "Session manager sidecar not available"}

    result = await sidecar.chat_create_room(name, purpose)
    if "error" in result:
        return result

    return {
        "room_id": result.get("id"),
        "name": result.get("name"),
        "purpose": result.get("purpose"),
        "created": True,
    }


async def tool_chat_post(args: dict[str, Any], sidecar: SessionManagerClient) -> dict[str, Any]:
    """Post a message to a chat room, optionally mentioning agents."""
    room_id = args["room_id"]
    content = args["content"]
    sender_id = args.get("sender_id", "operator")
    sender_name = args.get("sender_name", "Operator")
    mentions = args.get("mentions", [])
    reply_to = args.get("reply_to")

    result = await sidecar.chat_post_message(
        room_id, sender_id, sender_name, content, mentions, reply_to,
    )
    if "error" in result:
        return result

    return {
        "message_id": result.get("id"),
        "posted": True,
        "mentions_count": len(mentions),
    }


async def tool_chat_read(args: dict[str, Any], sidecar: SessionManagerClient) -> dict[str, Any]:
    """Read messages from a chat room."""
    room_id = args["room_id"]
    limit = args.get("limit", 50)
    since = args.get("since")

    messages = await sidecar.chat_read_messages(room_id, limit, since)
    return {
        "messages": messages,
        "count": len(messages),
    }


async def tool_chat_list(sidecar: SessionManagerClient) -> dict[str, Any]:
    """List all active chat rooms."""
    if not await sidecar.ensure_running():
        return {"error": "Session manager sidecar not available", "rooms": []}

    rooms = await sidecar.chat_list_rooms()
    return {
        "rooms": rooms,
        "count": len(rooms),
    }


async def tool_chat_wait(args: dict[str, Any], sidecar: SessionManagerClient) -> dict[str, Any]:
    """Wait for a new message in a chat room (up to 30s)."""
    room_id = args["room_id"]
    timeout = min(args.get("timeout", 30000), 60000)

    message = await sidecar.chat_wait_message(room_id, timeout)
    if message is None:
        return {"room_id": room_id, "message": None, "timed_out": True}

    return {
        "room_id": room_id,
        "message": message,
        "timed_out": False,
    }


async def tool_chat_delete(args: dict[str, Any], sidecar: SessionManagerClient) -> dict[str, Any]:
    """Delete a chat room."""
    room_id = args["room_id"]
    result = await sidecar.chat_delete_room(room_id)
    return result
