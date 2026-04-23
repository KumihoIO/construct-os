"""Shared fixtures for operator MCP tests."""
from __future__ import annotations

import json
import os
from unittest.mock import AsyncMock, MagicMock

import pytest


# ---------------------------------------------------------------------------
# tmp_path-based fixtures for file I/O tests
# ---------------------------------------------------------------------------

@pytest.fixture
def journal_path(tmp_path):
    """Temporary path for a session journal JSONL file."""
    return str(tmp_path / "test_journal.jsonl")


@pytest.fixture
def pool_path(tmp_path):
    """Temporary path for an agent pool JSON file."""
    return str(tmp_path / "agent_pool.json")


@pytest.fixture
def skills_dir(tmp_path):
    """Temporary skills directory with sample skill files."""
    d = tmp_path / "skills"
    d.mkdir()
    (d / "operator-orchestrator.md").write_text("# Orchestrator Skill\nTeam coordination.")
    (d / "operator-loop.md").write_text("# Loop Skill\nIterative cycles.")
    (d / "operator-committee.md").write_text("# Committee Skill\nDual analysis.")
    (d / "operator-handoff.md").write_text("# Handoff Skill\nTask transfer.")
    (d / "operator-chat.md").write_text("# Chat Skill\nAsync coordination.")
    return str(d)


# ---------------------------------------------------------------------------
# Mock sidecar client
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_sidecar():
    """Mock SessionManagerClient with all async methods stubbed."""
    sidecar = AsyncMock()
    sidecar.ensure_running = AsyncMock(return_value=True)
    sidecar.is_running = True
    sidecar.socket_path = "/tmp/test-operator.sock"
    sidecar.create_agent = AsyncMock(return_value={"id": "sc-123", "status": "running"})
    sidecar.get_agent = AsyncMock(return_value={"id": "sc-123", "status": "idle"})
    sidecar.send_query = AsyncMock(return_value={"status": "ok"})
    sidecar.chat_create_room = AsyncMock(return_value={"id": "room-1", "name": "test-room", "purpose": "testing"})
    sidecar.chat_list_rooms = AsyncMock(return_value=[])
    sidecar.chat_post_message = AsyncMock(return_value={"id": "msg-1"})
    sidecar.chat_read_messages = AsyncMock(return_value=[])
    sidecar.chat_wait_message = AsyncMock(return_value=None)
    sidecar.chat_delete_room = AsyncMock(return_value={"deleted": True})
    sidecar.list_pending_permissions = AsyncMock(return_value=[])
    sidecar.respond_to_permission = AsyncMock(return_value={"ok": True})
    return sidecar


# ---------------------------------------------------------------------------
# Mock gateway client
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_gateway():
    """Mock ConstructGatewayClient."""
    gw = AsyncMock()
    gw._available = True
    gw.push_channel_event = AsyncMock(return_value=True)
    gw.get_cost_summary = AsyncMock(return_value={"total": 0.0})
    gw.get_status = AsyncMock(return_value={"status": "ok"})
    return gw


# ---------------------------------------------------------------------------
# Mock Kumiho pool client
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_pool_client():
    """Mock KumihoAgentPoolClient."""
    pc = AsyncMock()
    pc._available = False
    pc.search_agents = AsyncMock(return_value=[])
    pc.list_agents = AsyncMock(return_value=[])
    pc.save_agent = AsyncMock(return_value=False)
    pc.item_to_template_dict = MagicMock(side_effect=lambda item: {
        "name": item.get("item_name", "unknown"),
        "agent_type": "claude",
        "role": "coder",
        "capabilities": [],
        "description": "",
        "use_count": 0,
    })
    return pc
