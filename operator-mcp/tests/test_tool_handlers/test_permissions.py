"""Tests for operator.tool_handlers.permissions — permission tool handlers."""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from operator_mcp.tool_handlers.permissions import (
    tool_list_pending_permissions,
    tool_respond_to_permission,
)


@pytest.mark.asyncio
class TestListPendingPermissions:
    async def test_success(self, mock_sidecar):
        mock_sidecar.list_pending_permissions = AsyncMock(return_value=[
            {"id": "p1", "tool": "Bash", "status": "pending"},
        ])
        result = await tool_list_pending_permissions(mock_sidecar)
        assert result["count"] == 1
        assert result["pending"][0]["id"] == "p1"

    async def test_empty(self, mock_sidecar):
        result = await tool_list_pending_permissions(mock_sidecar)
        assert result["count"] == 0

    async def test_sidecar_unavailable(self, mock_sidecar):
        mock_sidecar.ensure_running = AsyncMock(return_value=False)
        result = await tool_list_pending_permissions(mock_sidecar)
        assert "error" in result


@pytest.mark.asyncio
class TestRespondToPermission:
    async def test_approve(self, mock_sidecar):
        result = await tool_respond_to_permission(
            {"request_id": "p1", "action": "approve"}, mock_sidecar,
        )
        assert result["ok"] is True

    async def test_deny(self, mock_sidecar):
        result = await tool_respond_to_permission(
            {"request_id": "p1", "action": "deny"}, mock_sidecar,
        )
        assert result["ok"] is True

    async def test_invalid_action(self, mock_sidecar):
        result = await tool_respond_to_permission(
            {"request_id": "p1", "action": "maybe"}, mock_sidecar,
        )
        assert "error" in result
        assert "Invalid action" in result["error"]

    async def test_custom_by(self, mock_sidecar):
        await tool_respond_to_permission(
            {"request_id": "p1", "action": "approve", "by": "user-neo"}, mock_sidecar,
        )
        call_args = mock_sidecar.respond_to_permission.call_args
        assert call_args[1]["by"] == "user-neo"
