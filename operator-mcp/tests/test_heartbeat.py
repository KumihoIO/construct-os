"""Tests for operator.heartbeat — health tracking, stale detection, tool handler."""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from unittest.mock import patch, MagicMock, AsyncMock

import pytest

from operator_mcp.heartbeat import (
    AgentHealth,
    HeartbeatMonitor,
    get_heartbeat_monitor,
    tool_get_agent_health,
    _monitor,
)


# -- Fake agent for AGENTS dict -----------------------------------------------

@dataclass
class FakeAgent:
    id: str
    status: str = "running"
    stdout_buffer: list = field(default_factory=list)
    _sidecar_id: str | None = None
    _reader_task: object = None


# -- Fixtures ------------------------------------------------------------------

@pytest.fixture
def monitor():
    return HeartbeatMonitor(interval=1.0, stale_threshold=5.0, dead_threshold=15.0)


@pytest.fixture
def agents_dict():
    """Provide a clean AGENTS dict for each test."""
    d: dict[str, FakeAgent] = {}
    with patch("operator_mcp.heartbeat.AGENTS", d):
        yield d


# -- AgentHealth ---------------------------------------------------------------

class TestAgentHealth:
    def test_defaults(self):
        h = AgentHealth(agent_id="test-1")
        assert h.alive is True
        assert h.consecutive_stale == 0
        assert h.stale_since == 0.0


# -- HeartbeatMonitor basics ---------------------------------------------------

class TestHeartbeatMonitorBasics:
    @pytest.mark.asyncio
    async def test_start_stop(self, monitor):
        await monitor.start()
        assert monitor._running is True
        assert monitor._task is not None
        await monitor.stop()
        assert monitor._running is False
        assert monitor._task is None

    @pytest.mark.asyncio
    async def test_double_start_is_noop(self, monitor):
        await monitor.start()
        first_task = monitor._task
        await monitor.start()  # Should not create second task
        assert monitor._task is first_task
        await monitor.stop()

    def test_set_sidecar_client(self, monitor):
        mock_client = MagicMock()
        monitor.set_sidecar_client(mock_client)
        assert monitor._sidecar_client is mock_client


# -- Health checks -------------------------------------------------------------

class TestHealthChecks:
    @pytest.mark.asyncio
    async def test_new_agent_gets_healthy_record(self, monitor, agents_dict):
        agents_dict["a-1"] = FakeAgent(id="a-1", status="running")
        with patch.object(monitor, "_get_event_count", return_value=0):
            await monitor._check_all()
        h = monitor.get_health("a-1")
        assert h is not None
        assert h["alive"] is True
        assert h["health"] == "healthy"

    @pytest.mark.asyncio
    async def test_activity_resets_stale(self, monitor, agents_dict):
        agents_dict["a-1"] = FakeAgent(id="a-1", status="running")
        event_count = 0

        def mock_event_count(aid, agent):
            return event_count

        with patch.object(monitor, "_get_event_count", side_effect=mock_event_count):
            # First check — creates record, but 0 == 0 so stale increments
            await monitor._check_all()
            # Second check — still 0, stale increments again
            await monitor._check_all()
            h = monitor._health["a-1"]
            assert h.consecutive_stale == 2

            # Third check — new activity, should reset
            event_count = 5
            await monitor._check_all()
            h = monitor._health["a-1"]
            assert h.consecutive_stale == 0
            assert h.stale_since == 0.0

    @pytest.mark.asyncio
    async def test_stale_detection(self, monitor, agents_dict):
        """Agent with no activity beyond stale_threshold is marked stale."""
        agents_dict["a-1"] = FakeAgent(id="a-1", status="running")
        with patch.object(monitor, "_get_event_count", return_value=0):
            await monitor._check_all()  # Creates record
            # Manually set last_activity far in the past
            h = monitor._health["a-1"]
            h.last_activity = time.monotonic() - 10.0  # 10s ago, threshold is 5s
            h.stale_since = time.monotonic() - 10.0
            await monitor._check_all()

        health = monitor.get_health("a-1")
        assert health["health"] == "stale"

    @pytest.mark.asyncio
    async def test_dead_detection(self, monitor, agents_dict):
        """Agent with no activity beyond dead_threshold is marked dead."""
        agents_dict["a-1"] = FakeAgent(id="a-1", status="running")
        with patch.object(monitor, "_get_event_count", return_value=0):
            await monitor._check_all()
            h = monitor._health["a-1"]
            h.last_activity = time.monotonic() - 20.0  # 20s ago, dead threshold is 15s
            h.stale_since = time.monotonic() - 20.0
            await monitor._check_all()

        health = monitor.get_health("a-1")
        assert health["alive"] is False
        assert health["health"] == "dead"

    @pytest.mark.asyncio
    async def test_completed_agent_marked_not_alive(self, monitor, agents_dict):
        """When agent transitions to completed, health record should reflect."""
        agents_dict["a-1"] = FakeAgent(id="a-1", status="running")
        with patch.object(monitor, "_get_event_count", return_value=0):
            await monitor._check_all()
        # Agent completes
        agents_dict["a-1"].status = "completed"
        with patch.object(monitor, "_get_event_count", return_value=0):
            await monitor._check_all()
        h = monitor._health.get("a-1")
        assert h is not None
        assert h.alive is False


# -- Query APIs ----------------------------------------------------------------

class TestQueryAPIs:
    @pytest.mark.asyncio
    async def test_get_health_unknown_agent(self, monitor):
        assert monitor.get_health("nonexistent") is None

    @pytest.mark.asyncio
    async def test_get_all_health(self, monitor, agents_dict):
        agents_dict["a-1"] = FakeAgent(id="a-1", status="running")
        agents_dict["a-2"] = FakeAgent(id="a-2", status="running")
        with patch.object(monitor, "_get_event_count", return_value=0):
            await monitor._check_all()
        result = monitor.get_all_health()
        assert len(result) == 2

    @pytest.mark.asyncio
    async def test_get_stale_agents_empty(self, monitor, agents_dict):
        agents_dict["a-1"] = FakeAgent(id="a-1", status="running")
        with patch.object(monitor, "_get_event_count", return_value=5):
            await monitor._check_all()
        assert monitor.get_stale_agents() == []

    @pytest.mark.asyncio
    async def test_get_stale_agents_returns_stale(self, monitor, agents_dict):
        agents_dict["a-1"] = FakeAgent(id="a-1", status="running")
        with patch.object(monitor, "_get_event_count", return_value=0):
            await monitor._check_all()
            h = monitor._health["a-1"]
            h.last_activity = time.monotonic() - 10.0
            h.stale_since = time.monotonic() - 10.0
        stale = monitor.get_stale_agents()
        assert len(stale) == 1
        assert stale[0]["agent_id"] == "a-1"


# -- Event count ---------------------------------------------------------------

class TestGetEventCount:
    @pytest.mark.asyncio
    async def test_uses_run_log(self, monitor, agents_dict):
        agent = FakeAgent(id="a-1", status="running")
        agents_dict["a-1"] = agent
        mock_log = MagicMock()
        mock_log.get_summary.return_value = {"total_events": 42}
        with patch("operator_mcp.heartbeat.get_log", return_value=mock_log):
            count = monitor._get_event_count("a-1", agent)
        assert count == 42

    @pytest.mark.asyncio
    async def test_falls_back_to_stdout_buffer(self, monitor, agents_dict):
        agent = FakeAgent(id="a-1", status="running", stdout_buffer=["a", "b", "c"])
        agents_dict["a-1"] = agent
        with patch("operator_mcp.heartbeat.get_log", return_value=None):
            count = monitor._get_event_count("a-1", agent)
        assert count == 3

    @pytest.mark.asyncio
    async def test_tries_sidecar_id_fallback(self, monitor, agents_dict):
        agent = FakeAgent(id="a-1", status="running", _sidecar_id="sid-1")
        agents_dict["a-1"] = agent
        mock_log = MagicMock()
        mock_log.get_summary.return_value = {"total_events": 10}

        def fake_get_log(aid):
            if aid == "sid-1":
                return mock_log
            return None

        with patch("operator_mcp.heartbeat.get_log", side_effect=fake_get_log):
            count = monitor._get_event_count("a-1", agent)
        assert count == 10


# -- Sidecar ping --------------------------------------------------------------

class TestSidecarPing:
    @pytest.mark.asyncio
    async def test_sidecar_updates_agent_status(self, monitor, agents_dict):
        agent = FakeAgent(id="a-1", status="running", _sidecar_id="sid-1")
        agents_dict["a-1"] = agent
        health = AgentHealth(agent_id="a-1")

        mock_client = AsyncMock()
        mock_client.get_agent.return_value = {"status": "idle"}
        monitor.set_sidecar_client(mock_client)

        await monitor._sidecar_ping(agent, health)
        assert agent.status == "completed"
        assert health.alive is False

    @pytest.mark.asyncio
    async def test_sidecar_error_status(self, monitor, agents_dict):
        agent = FakeAgent(id="a-1", status="running", _sidecar_id="sid-1")
        health = AgentHealth(agent_id="a-1")

        mock_client = AsyncMock()
        mock_client.get_agent.return_value = {"status": "error"}
        monitor.set_sidecar_client(mock_client)

        await monitor._sidecar_ping(agent, health)
        assert agent.status == "error"

    @pytest.mark.asyncio
    async def test_sidecar_exception_ignored(self, monitor):
        agent = FakeAgent(id="a-1", status="running", _sidecar_id="sid-1")
        health = AgentHealth(agent_id="a-1")

        mock_client = AsyncMock()
        mock_client.get_agent.side_effect = Exception("connection refused")
        monitor.set_sidecar_client(mock_client)

        # Should not raise
        await monitor._sidecar_ping(agent, health)
        assert agent.status == "running"  # Unchanged


# -- Singleton -----------------------------------------------------------------

class TestSingleton:
    def test_get_heartbeat_monitor(self):
        with patch("operator_mcp.heartbeat._monitor", None):
            m = get_heartbeat_monitor()
            assert isinstance(m, HeartbeatMonitor)


# -- Tool handler --------------------------------------------------------------

class TestToolGetAgentHealth:
    @pytest.mark.asyncio
    async def test_specific_agent_not_found(self):
        with patch("operator_mcp.heartbeat.get_heartbeat_monitor") as mock_get:
            mock_monitor = MagicMock()
            mock_monitor.get_health.return_value = None
            mock_get.return_value = mock_monitor
            result = await tool_get_agent_health({"agent_id": "nonexistent"})
        assert "error" in result

    @pytest.mark.asyncio
    async def test_all_agents(self):
        with patch("operator_mcp.heartbeat.get_heartbeat_monitor") as mock_get:
            mock_monitor = MagicMock()
            mock_monitor.get_all_health.return_value = [
                {"agent_id": "a-1", "alive": True},
            ]
            mock_monitor.get_stale_agents.return_value = []
            mock_get.return_value = mock_monitor
            result = await tool_get_agent_health({})
        assert result["total"] == 1
        assert result["stale_count"] == 0
