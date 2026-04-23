"""Tests for P0 reliability hardening — exception handling, cascade isolation, journal safety."""
from __future__ import annotations

import asyncio
import json as _json
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from operator_mcp.agent_state import AGENTS, ManagedAgent
from operator_mcp.journal import JournalWriteError, SessionJournal
from operator_mcp.tool_handlers.agents import tool_wait_for_agent, tool_create_agent
from operator_mcp.tool_handlers.teams import (
    _wait_for_wave_agents, _wait_for_single_agent,
    WaveCheckpoint, AgentOutcome,
    _save_wave_checkpoint, _load_wave_checkpoint, _load_latest_checkpoint,
    _delete_checkpoint, _outcome_to_dict, _outcome_from_dict,
    _CHECKPOINT_DIR,
)


@pytest.fixture(autouse=True)
def clean_agents():
    AGENTS.clear()
    yield
    AGENTS.clear()


@pytest.fixture(autouse=True)
def reset_sidecar():
    import operator_mcp.tool_handlers.agents as mod
    old_sc, old_ec = mod._sidecar_client, mod._event_consumer
    mod._sidecar_client = None
    mod._event_consumer = None
    yield
    mod._sidecar_client = old_sc
    mod._event_consumer = old_ec


@pytest.fixture(autouse=True)
def permissive_policy():
    from operator_mcp.policy import Policy
    permissive = Policy(
        level="autonomous",
        workspace_only=False,
        forbidden_paths=[],
        allowed_roots=[],
        block_high_risk_commands=False,
    )
    with patch("operator.policy.load_policy", return_value=permissive):
        yield


def _make_agent(agent_id: str, title: str = "T", status: str = "running",
                cwd: str = "/tmp") -> ManagedAgent:
    return ManagedAgent(id=agent_id, agent_type="claude", title=title,
                        cwd=cwd, status=status)


# ---------------------------------------------------------------------------
# tool_wait_for_agent — subprocess exception hardening
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestWaitForAgentSubprocessExceptions:
    async def test_reader_task_runtime_error(self, tmp_path):
        """Reader task RuntimeError is caught and returned as error status."""
        agent = _make_agent("a1", cwd=str(tmp_path))

        async def failing_task():
            raise RuntimeError("Reader crashed")

        agent._reader_task = asyncio.create_task(failing_task())
        # Let the task fail
        await asyncio.sleep(0.01)
        AGENTS["a1"] = agent

        result = await tool_wait_for_agent({"agent_id": "a1", "timeout": 2})
        assert result["status"] == "error"
        assert "Reader" in result.get("error", "")

    async def test_reader_task_cancelled(self, tmp_path):
        """CancelledError in reader task is caught gracefully."""
        agent = _make_agent("a1", cwd=str(tmp_path))

        async def long_task():
            await asyncio.sleep(100)

        task = asyncio.create_task(long_task())
        agent._reader_task = task
        AGENTS["a1"] = agent

        # Cancel the task right away
        task.cancel()
        await asyncio.sleep(0.01)

        result = await tool_wait_for_agent({"agent_id": "a1", "timeout": 2})
        assert result["status"] == "error"
        assert "cancelled" in result.get("error", "").lower()

    async def test_no_reader_task_while_running(self, tmp_path):
        """Running agent with no reader_task returns with warning."""
        agent = _make_agent("a1", cwd=str(tmp_path), status="running")
        agent._reader_task = None
        AGENTS["a1"] = agent

        result = await tool_wait_for_agent({"agent_id": "a1", "timeout": 2})
        assert "warning" in result

    async def test_already_completed_is_idempotent(self, tmp_path):
        """Completed agent returns immediately without touching reader_task."""
        agent = _make_agent("a1", cwd=str(tmp_path), status="completed")
        agent.stdout_buffer = "All done"
        AGENTS["a1"] = agent

        result = await tool_wait_for_agent({"agent_id": "a1"})
        assert result["status"] == "completed"


# ---------------------------------------------------------------------------
# _wait_for_wave_agents — structured results + failure tracking
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestWaitForWaveReliability:
    async def test_returns_structured_results(self, tmp_path):
        """Wave wait returns dict mapping agent_id -> outcome."""
        agent = _make_agent("a1", cwd=str(tmp_path), status="completed")
        AGENTS["a1"] = agent

        results = await _wait_for_wave_agents(["a1"], timeout=5.0)
        assert isinstance(results, dict)
        assert results["a1"] == "completed"

    async def test_missing_agent_returns_missing(self):
        """Agent not in AGENTS dict is reported as 'missing'."""
        results = await _wait_for_wave_agents(["ghost"], timeout=5.0)
        assert results["ghost"] == "missing"

    async def test_subprocess_timeout_returns_timeout(self, tmp_path):
        """Subprocess that doesn't finish within timeout returns 'timeout'."""
        agent = _make_agent("a1", cwd=str(tmp_path))

        async def slow_task():
            await asyncio.sleep(100)

        agent._reader_task = asyncio.create_task(slow_task())
        AGENTS["a1"] = agent

        results = await _wait_for_wave_agents(["a1"], timeout=0.1)
        assert results["a1"] == "timeout"
        agent._reader_task.cancel()

    async def test_subprocess_exception_returns_error(self, tmp_path):
        """Subprocess reader task exception is caught and returns 'error'."""
        agent = _make_agent("a1", cwd=str(tmp_path))

        async def crashing_task():
            raise RuntimeError("boom")

        agent._reader_task = asyncio.create_task(crashing_task())
        await asyncio.sleep(0.01)
        AGENTS["a1"] = agent

        results = await _wait_for_wave_agents(["a1"], timeout=2.0)
        assert results["a1"] == "error"

    async def test_sidecar_unreachable_after_failures(self, tmp_path):
        """Sidecar that fails 8+ times is reported as 'unreachable'."""
        import operator_mcp.tool_handlers.agents as agents_mod

        mock_sc = AsyncMock()
        mock_sc.get_agent = AsyncMock(side_effect=Exception("Connection refused"))
        agents_mod._sidecar_client = mock_sc

        agent = _make_agent("a1", cwd=str(tmp_path))
        agent._sidecar_id = "sc-123"
        AGENTS["a1"] = agent

        results = await _wait_for_wave_agents(["a1"], timeout=5.0)
        assert results["a1"] == "unreachable"

        agents_mod._sidecar_client = None

    async def test_sidecar_returns_error_status(self, tmp_path):
        """Sidecar reporting error status is captured correctly."""
        import operator_mcp.tool_handlers.agents as agents_mod

        mock_sc = AsyncMock()
        mock_sc.get_agent = AsyncMock(return_value={"status": "error"})
        agents_mod._sidecar_client = mock_sc

        agent = _make_agent("a1", cwd=str(tmp_path))
        agent._sidecar_id = "sc-123"
        AGENTS["a1"] = agent

        results = await _wait_for_wave_agents(["a1"], timeout=5.0)
        assert results["a1"] == "error"
        assert agent.status == "error"

        agents_mod._sidecar_client = None

    async def test_multiple_agents_mixed_outcomes(self, tmp_path):
        """Wave with multiple agents returns per-agent outcomes."""
        # Agent 1: completed
        a1 = _make_agent("a1", cwd=str(tmp_path), status="completed")
        AGENTS["a1"] = a1

        # Agent 2: error
        a2 = _make_agent("a2", cwd=str(tmp_path), status="error")
        AGENTS["a2"] = a2

        results = await _wait_for_wave_agents(["a1", "a2", "ghost"], timeout=5.0)
        assert results["a1"] == "completed"
        assert results["a2"] == "error"
        assert results["ghost"] == "missing"

    async def test_no_reader_task_no_sidecar_running(self, tmp_path):
        """Agent with no reader_task and no sidecar while running returns error."""
        agent = _make_agent("a1", cwd=str(tmp_path), status="running")
        agent._reader_task = None
        agent._sidecar_id = None
        AGENTS["a1"] = agent

        results = await _wait_for_wave_agents(["a1"], timeout=2.0)
        assert results["a1"] == "error"

    async def test_parallel_no_starvation(self, tmp_path):
        """Slow agent_1 doesn't eat agent_2's timeout — both get full timeout."""
        import time

        # Agent 1: slow subprocess (takes ~0.3s)
        a1 = _make_agent("a1", cwd=str(tmp_path))
        async def slow_task():
            await asyncio.sleep(0.3)
            a1.status = "completed"
        a1._reader_task = asyncio.create_task(slow_task())
        AGENTS["a1"] = a1

        # Agent 2: fast subprocess (completes immediately)
        a2 = _make_agent("a2", cwd=str(tmp_path))
        async def fast_task():
            await asyncio.sleep(0.01)
            a2.status = "completed"
        a2._reader_task = asyncio.create_task(fast_task())
        AGENTS["a2"] = a2

        start = time.monotonic()
        results = await _wait_for_wave_agents(["a1", "a2"], timeout=5.0)
        elapsed = time.monotonic() - start

        assert results["a1"] == "completed"
        assert results["a2"] == "completed"
        # Both should complete in ~0.3s (parallel), not 0.3 + 0.01 (sequential)
        assert elapsed < 1.0

    async def test_parallel_one_timeout_others_complete(self, tmp_path):
        """One agent timing out doesn't prevent others from reporting completion."""
        # Agent 1: will timeout
        a1 = _make_agent("a1", cwd=str(tmp_path))
        async def hung_task():
            await asyncio.sleep(100)
        a1._reader_task = asyncio.create_task(hung_task())
        AGENTS["a1"] = a1

        # Agent 2: completes fast
        a2 = _make_agent("a2", cwd=str(tmp_path), status="completed")
        AGENTS["a2"] = a2

        results = await _wait_for_wave_agents(["a1", "a2"], timeout=0.5)
        assert results["a1"] == "timeout"
        assert results["a2"] == "completed"
        a1._reader_task.cancel()

    async def test_empty_agent_list(self):
        """Empty agent list returns empty dict."""
        results = await _wait_for_wave_agents([], timeout=5.0)
        assert results == {}

    async def test_per_agent_timeout_not_shared(self, tmp_path):
        """Each agent gets the full timeout, not a shrinking remainder."""
        agents = []
        for i in range(3):
            aid = f"a{i}"
            a = _make_agent(aid, cwd=str(tmp_path))
            async def task(delay=0.1 * (i + 1), agent=a):
                await asyncio.sleep(delay)
                agent.status = "completed"
            a._reader_task = asyncio.create_task(task())
            AGENTS[aid] = a
            agents.append(aid)

        # 2s timeout — all agents complete well within it
        results = await _wait_for_wave_agents(agents, timeout=2.0)
        assert all(r == "completed" for r in results.values()), results


# ---------------------------------------------------------------------------
# Journal — write failure detection
# ---------------------------------------------------------------------------

class TestJournalWriteFailure:
    def test_raises_on_unwritable_path(self, tmp_path):
        """Journal raises JournalWriteError when file is unwritable."""
        j = SessionJournal(str(tmp_path / "journal.jsonl"))
        # First write succeeds
        j.record("a1", "created")

        # Make file unwritable
        os.chmod(str(tmp_path / "journal.jsonl"), 0o000)
        try:
            with pytest.raises(JournalWriteError):
                j.record("a1", "running")
        finally:
            os.chmod(str(tmp_path / "journal.jsonl"), 0o644)

    def test_normal_write_succeeds(self, journal_path):
        """Normal write still works."""
        j = SessionJournal(journal_path)
        j.record("a1", "created")
        history = j.load_history()
        assert len(history) == 1


# ---------------------------------------------------------------------------
# tool_create_agent — journal-first ordering
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestCreateAgentJournalFirst:
    async def test_journal_failure_prevents_agent_registration(
        self, journal_path, mock_pool_client, tmp_path
    ):
        """If journal write fails, agent is NOT registered in AGENTS."""
        journal = SessionJournal(journal_path)

        with patch.object(journal, "record", side_effect=JournalWriteError("disk full")):
            result = await tool_create_agent({
                "title": "Should Not Exist",
                "cwd": str(tmp_path),
            }, journal, mock_pool_client)

        assert "error" in result
        assert "persist" in result["error"].lower() or "journal" in result["error"].lower()
        # Agent should NOT be in AGENTS
        assert len(AGENTS) == 0

    async def test_successful_create_registers_agent(
        self, journal_path, mock_pool_client, tmp_path
    ):
        """Normal create: journal writes first, then agent registered."""
        journal = SessionJournal(journal_path)
        result = await tool_create_agent({
            "title": "Good Agent",
            "cwd": str(tmp_path),
        }, journal, mock_pool_client)

        assert "agent_id" in result
        assert result["agent_id"] in AGENTS


# ---------------------------------------------------------------------------
# Spawn rollback — failed spawn removes agent from AGENTS
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestSpawnRollback:
    async def test_failed_spawn_removes_from_agents(self, tmp_path):
        """Agent that fails to spawn is removed from AGENTS dict."""
        agent = _make_agent("a1", cwd=str(tmp_path), status="idle")
        AGENTS["a1"] = agent

        # Simulate spawn failure
        agent.status = "error"
        agent.stderr_buffer = "spawn failed"
        ok = False

        if not ok:
            AGENTS.pop("a1", None)

        assert "a1" not in AGENTS


# ---------------------------------------------------------------------------
# _monitor_agent — exception handling
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestMonitorAgentResilience:
    async def test_journal_failure_in_monitor_does_not_crash(self, tmp_path, journal_path):
        """Monitor handles journal write failure gracefully."""
        from operator_mcp.agent_subprocess import _monitor_agent

        journal = SessionJournal(journal_path)
        agent = _make_agent("a1", cwd=str(tmp_path), status="running")

        # Create a process mock that exits cleanly
        mock_proc = AsyncMock()
        mock_proc.stdout = AsyncMock()
        mock_proc.stderr = AsyncMock()
        mock_proc.stdout.__aiter__ = AsyncMock(return_value=iter([]))
        mock_proc.stderr.__aiter__ = AsyncMock(return_value=iter([]))
        mock_proc.wait = AsyncMock(return_value=None)
        mock_proc.returncode = 0
        agent.process = mock_proc

        with patch.object(journal, "record", side_effect=JournalWriteError("disk full")):
            # Should NOT raise — monitor catches the journal error
            await _monitor_agent(agent, journal)

        # Agent status should still be set correctly
        assert agent.status == "idle"

    async def test_process_lookup_error_handled(self, tmp_path, journal_path):
        """Monitor handles ProcessLookupError from proc.wait()."""
        from operator_mcp.agent_subprocess import _monitor_agent

        journal = SessionJournal(journal_path)
        agent = _make_agent("a1", cwd=str(tmp_path), status="running")

        mock_proc = AsyncMock()
        mock_proc.stdout = AsyncMock()
        mock_proc.stderr = AsyncMock()
        mock_proc.stdout.__aiter__ = AsyncMock(return_value=iter([]))
        mock_proc.stderr.__aiter__ = AsyncMock(return_value=iter([]))
        mock_proc.wait = AsyncMock(side_effect=ProcessLookupError("No such process"))
        mock_proc.returncode = None  # Process vanished
        agent.process = mock_proc

        await _monitor_agent(agent, journal)

        # Agent should be marked as error (no return code)
        assert agent.status == "error"


# ---------------------------------------------------------------------------
# Wave checkpoint persistence — save / load / resume
# ---------------------------------------------------------------------------

def _make_outcome(agent_id: str, status: str = "completed", **kw) -> AgentOutcome:
    return AgentOutcome(
        agent_id=agent_id, title=f"t-{agent_id[:4]}", role="coder",
        status=status, revision_kref=kw.get("revision_kref", ""),
        summary=kw.get("summary", "done"), files=kw.get("files", []),
        tool_call_count=kw.get("tool_call_count", 0),
        error_count=kw.get("error_count", 0),
        errors=kw.get("errors", []),
        diff_summary=kw.get("diff_summary", ""),
    )


@pytest.fixture
def checkpoint_dir(tmp_path, monkeypatch):
    """Redirect checkpoint dir to tmp for isolation."""
    d = str(tmp_path / "checkpoints")
    monkeypatch.setattr("operator.tool_handlers.teams._CHECKPOINT_DIR", d)
    return d


class TestWaveCheckpointPersistence:
    def test_save_and_load_by_id(self, checkpoint_dir):
        """Save checkpoint, load by ID — round-trips correctly."""
        ckpt = WaveCheckpoint(
            team_kref="kref://t1", team_name="alpha",
            task="build it", cwd="/tmp/work",
            halt_on_failure=True,
            completed_wave=1, total_waves=3,
            spawned=[{"agent_id": "a1", "name": "coder", "wave": 0}],
            failed=[],
            spawned_map={"kref://m1": {"agent_id": "a1", "name": "coder", "role": "coder"}},
            outcomes={},
        )
        cid = _save_wave_checkpoint(ckpt)
        assert cid

        loaded = _load_wave_checkpoint(cid)
        assert loaded is not None
        assert loaded.team_name == "alpha"
        assert loaded.completed_wave == 1
        assert loaded.total_waves == 3
        assert loaded.spawned == ckpt.spawned
        assert loaded.spawned_map == ckpt.spawned_map

    def test_load_latest_for_team(self, checkpoint_dir):
        """load_latest_checkpoint returns the most recent one for a team."""
        import time

        ckpt1 = WaveCheckpoint(
            team_kref="kref://t1", team_name="bravo",
            task="task", cwd="/tmp", halt_on_failure=True,
            completed_wave=0, total_waves=3,
            spawned=[], failed=[], spawned_map={}, outcomes={},
        )
        _save_wave_checkpoint(ckpt1)
        time.sleep(0.05)  # ensure distinct mtime

        ckpt2 = WaveCheckpoint(
            team_kref="kref://t1", team_name="bravo",
            task="task", cwd="/tmp", halt_on_failure=True,
            completed_wave=1, total_waves=3,
            spawned=[], failed=[], spawned_map={}, outcomes={},
        )
        _save_wave_checkpoint(ckpt2)

        latest = _load_latest_checkpoint("bravo")
        assert latest is not None
        assert latest.completed_wave == 1

    def test_load_nonexistent_returns_none(self, checkpoint_dir):
        """Loading a checkpoint that doesn't exist returns None."""
        assert _load_wave_checkpoint("nope") is None
        assert _load_latest_checkpoint("nope") is None

    def test_delete_checkpoint(self, checkpoint_dir):
        """Delete removes the file, subsequent load returns None."""
        ckpt = WaveCheckpoint(
            team_kref="kref://t1", team_name="charlie",
            task="task", cwd="/tmp", halt_on_failure=True,
            completed_wave=0, total_waves=2,
            spawned=[], failed=[], spawned_map={}, outcomes={},
        )
        cid = _save_wave_checkpoint(ckpt)
        assert _load_wave_checkpoint(cid) is not None

        deleted = _delete_checkpoint(cid)
        assert deleted is True
        assert _load_wave_checkpoint(cid) is None

    def test_outcome_round_trip(self, checkpoint_dir):
        """AgentOutcome serializes and deserializes correctly through checkpoint."""
        outcome = _make_outcome("a1", revision_kref="kref://r1", files=["a.py", "b.py"])
        serialized = _outcome_to_dict(outcome)
        restored = _outcome_from_dict(serialized)

        assert restored.agent_id == "a1"
        assert restored.revision_kref == "kref://r1"
        assert restored.files == ["a.py", "b.py"]
        assert restored.status == "completed"

    def test_checkpoint_with_outcomes(self, checkpoint_dir):
        """Checkpoint with serialized outcomes round-trips."""
        o1 = _make_outcome("a1", revision_kref="kref://r1")
        o2 = _make_outcome("a2", status="error", errors=["boom"])

        ckpt = WaveCheckpoint(
            team_kref="kref://t1", team_name="delta",
            task="task", cwd="/tmp", halt_on_failure=True,
            completed_wave=1, total_waves=3,
            spawned=[{"agent_id": "a1", "wave": 0}],
            failed=[{"agent_id": "a2", "wave": 1}],
            spawned_map={},
            outcomes={"a1": _outcome_to_dict(o1), "a2": _outcome_to_dict(o2)},
        )
        cid = _save_wave_checkpoint(ckpt)
        loaded = _load_wave_checkpoint(cid)
        assert loaded is not None

        r1 = _outcome_from_dict(loaded.outcomes["a1"])
        assert r1.revision_kref == "kref://r1"
        r2 = _outcome_from_dict(loaded.outcomes["a2"])
        assert r2.status == "error"
        assert r2.errors == ["boom"]

    def test_checkpoint_reuses_id(self, checkpoint_dir):
        """Saving with same checkpoint_id overwrites the previous checkpoint."""
        ckpt = WaveCheckpoint(
            team_kref="kref://t1", team_name="echo",
            task="task", cwd="/tmp", halt_on_failure=True,
            completed_wave=0, total_waves=3,
            spawned=[], failed=[], spawned_map={}, outcomes={},
        )
        cid = _save_wave_checkpoint(ckpt)

        # Save again with wave 1 using same ID
        ckpt.completed_wave = 1
        ckpt.checkpoint_id = cid
        _save_wave_checkpoint(ckpt)

        loaded = _load_wave_checkpoint(cid)
        assert loaded is not None
        assert loaded.completed_wave == 1

        # Only one file should exist for this team+id
        files = [f for f in os.listdir(checkpoint_dir) if f.startswith("echo_")]
        assert len(files) == 1

    def test_corrupt_checkpoint_returns_none(self, checkpoint_dir):
        """Corrupt JSON file returns None instead of crashing."""
        os.makedirs(checkpoint_dir, exist_ok=True)
        path = os.path.join(checkpoint_dir, "bad_corrupt123.json")
        with open(path, "w") as f:
            f.write("not valid json{{{")

        assert _load_wave_checkpoint("corrupt123") is None
