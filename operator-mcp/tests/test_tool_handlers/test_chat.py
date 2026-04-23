"""Tests for operator.tool_handlers.chat — chat room tool handlers."""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from operator_mcp.tool_handlers.chat import (
    tool_chat_create,
    tool_chat_delete,
    tool_chat_list,
    tool_chat_post,
    tool_chat_read,
    tool_chat_wait,
)


@pytest.mark.asyncio
class TestChatCreate:
    async def test_success(self, mock_sidecar):
        result = await tool_chat_create({"name": "dev-room", "purpose": "Development"}, mock_sidecar)
        assert result["created"] is True
        assert result["room_id"] == "room-1"
        assert result["name"] == "test-room"

    async def test_sidecar_unavailable(self, mock_sidecar):
        mock_sidecar.ensure_running = AsyncMock(return_value=False)
        result = await tool_chat_create({"name": "x"}, mock_sidecar)
        assert "error" in result

    async def test_sidecar_error(self, mock_sidecar):
        mock_sidecar.chat_create_room = AsyncMock(return_value={"error": "room exists"})
        result = await tool_chat_create({"name": "dup"}, mock_sidecar)
        assert "error" in result


@pytest.mark.asyncio
class TestChatPost:
    async def test_success(self, mock_sidecar):
        result = await tool_chat_post({
            "room_id": "room-1",
            "content": "Hello team",
            "mentions": ["agent-1"],
        }, mock_sidecar)
        assert result["posted"] is True
        assert result["mentions_count"] == 1

    async def test_default_sender(self, mock_sidecar):
        await tool_chat_post({"room_id": "r1", "content": "hi"}, mock_sidecar)
        call_args = mock_sidecar.chat_post_message.call_args
        assert call_args[0][1] == "operator"  # sender_id
        assert call_args[0][2] == "Operator"  # sender_name

    async def test_error_propagated(self, mock_sidecar):
        mock_sidecar.chat_post_message = AsyncMock(return_value={"error": "room not found"})
        result = await tool_chat_post({"room_id": "bad", "content": "hi"}, mock_sidecar)
        assert "error" in result


@pytest.mark.asyncio
class TestChatRead:
    async def test_success(self, mock_sidecar):
        mock_sidecar.chat_read_messages = AsyncMock(return_value=[
            {"id": "m1", "content": "hello"},
            {"id": "m2", "content": "world"},
        ])
        result = await tool_chat_read({"room_id": "r1"}, mock_sidecar)
        assert result["count"] == 2

    async def test_with_limit(self, mock_sidecar):
        await tool_chat_read({"room_id": "r1", "limit": 10, "since": "2025-01-01"}, mock_sidecar)
        call_args = mock_sidecar.chat_read_messages.call_args
        assert call_args[0][1] == 10
        assert call_args[0][2] == "2025-01-01"


@pytest.mark.asyncio
class TestChatList:
    async def test_success(self, mock_sidecar):
        mock_sidecar.chat_list_rooms = AsyncMock(return_value=[{"id": "r1", "name": "room"}])
        result = await tool_chat_list(mock_sidecar)
        assert result["count"] == 1

    async def test_sidecar_unavailable(self, mock_sidecar):
        mock_sidecar.ensure_running = AsyncMock(return_value=False)
        result = await tool_chat_list(mock_sidecar)
        assert "error" in result


@pytest.mark.asyncio
class TestChatWait:
    async def test_timeout(self, mock_sidecar):
        result = await tool_chat_wait({"room_id": "r1"}, mock_sidecar)
        assert result["timed_out"] is True
        assert result["message"] is None

    async def test_message_received(self, mock_sidecar):
        mock_sidecar.chat_wait_message = AsyncMock(return_value={"id": "m1", "content": "ping"})
        result = await tool_chat_wait({"room_id": "r1"}, mock_sidecar)
        assert result["timed_out"] is False
        assert result["message"]["content"] == "ping"

    async def test_timeout_capped_at_60s(self, mock_sidecar):
        await tool_chat_wait({"room_id": "r1", "timeout": 120000}, mock_sidecar)
        call_args = mock_sidecar.chat_wait_message.call_args
        assert call_args[0][1] == 60000


@pytest.mark.asyncio
class TestChatDelete:
    async def test_success(self, mock_sidecar):
        result = await tool_chat_delete({"room_id": "r1"}, mock_sidecar)
        assert result["deleted"] is True
