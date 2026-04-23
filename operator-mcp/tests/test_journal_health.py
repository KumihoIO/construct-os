"""Tests for journal health monitor."""
from __future__ import annotations

import os
import pytest
from unittest.mock import MagicMock

from operator_mcp.journal import SessionJournal
from operator_mcp.journal_health import (
    JournalHealthMonitor, JournalHealthStatus,
    get_journal_health_monitor, tool_get_journal_health,
)


@pytest.fixture
def journal(tmp_path):
    return SessionJournal(str(tmp_path / "test_journal.jsonl"))


@pytest.fixture
def monitor(journal):
    m = JournalHealthMonitor(interval=1.0, warn_size_kb=5, rotate_size_kb=10)
    m.set_journal(journal)
    return m


# ---------------------------------------------------------------------------
# Health check basics
# ---------------------------------------------------------------------------

class TestHealthCheck:
    def test_healthy_on_normal_file(self, monitor, journal):
        journal.record("a1", "created")
        monitor._check()
        h = monitor.get_health()
        assert h["status"] == "healthy"
        assert h["file_exists"] is True
        assert h["file_size_kb"] > 0
        assert h["last_write_ok"] is True

    def test_degraded_when_file_missing(self, monitor, journal):
        # Write then remove the journal file
        journal.record("a1", "created")
        os.remove(journal.path)
        monitor._check()
        h = monitor.get_health()
        assert h["status"] == "degraded"
        assert h["file_exists"] is False

    def test_unhealthy_after_consecutive_write_failures(self, monitor, journal, tmp_path):
        journal.record("a1", "created")
        # Make journal unwritable
        os.chmod(journal.path, 0o444)
        try:
            for _ in range(3):
                monitor._check()
            h = monitor.get_health()
            assert h["status"] == "unhealthy"
            assert h["consecutive_write_failures"] >= 3
        finally:
            os.chmod(journal.path, 0o644)

    def test_no_journal_set(self):
        m = JournalHealthMonitor()
        m._check()
        h = m.get_health()
        assert h["status"] == "unhealthy"

    def test_checks_increment(self, monitor, journal):
        journal.record("a1", "created")
        monitor._check()
        monitor._check()
        h = monitor.get_health()
        assert h["checks_performed"] == 2


# ---------------------------------------------------------------------------
# Write probe
# ---------------------------------------------------------------------------

class TestWriteProbe:
    def test_successful_write_returns_positive_latency(self, monitor, journal):
        journal.record("a1", "created")
        latency = monitor._write_probe(journal.path)
        assert latency >= 0

    def test_failed_write_returns_negative(self, monitor, journal, tmp_path):
        journal.record("a1", "created")
        os.chmod(journal.path, 0o444)
        try:
            latency = monitor._write_probe(journal.path)
            assert latency == -1.0
        finally:
            os.chmod(journal.path, 0o644)

    def test_nonexistent_path_returns_negative(self, monitor):
        latency = monitor._write_probe("/nonexistent/path/journal.jsonl")
        assert latency == -1.0


# ---------------------------------------------------------------------------
# Rotation
# ---------------------------------------------------------------------------

class TestRotation:
    def test_rotate_moves_file(self, monitor, journal):
        # Write enough data to exist
        journal.record("a1", "created")
        original_path = journal.path

        monitor._rotate(original_path)
        assert os.path.exists(f"{original_path}.1")
        assert not os.path.exists(original_path)
        assert monitor._health.rotations_performed == 1

    def test_rotate_shifts_existing_backups(self, monitor, journal):
        path = journal.path

        # Create fake existing backups
        for i in range(1, 4):
            with open(f"{path}.{i}", "w") as f:
                f.write(f"backup-{i}")

        journal.record("a1", "created")
        monitor._rotate(path)

        # Current -> .1 (new content)
        assert os.path.exists(f"{path}.1")
        # Old .1 -> .2
        assert os.path.exists(f"{path}.2")
        # Old .2 -> .3
        assert os.path.exists(f"{path}.3")
        # Old .3 deleted (max_backups=3)

    def test_auto_rotate_on_size_threshold(self, monitor, journal):
        # Set very low threshold
        monitor._rotate_size_kb = 0.001  # ~1 byte

        journal.record("a1", "created")
        monitor._check()

        assert monitor._health.rotations_performed == 1

    def test_no_rotation_under_threshold(self, monitor, journal):
        journal.record("a1", "created")
        monitor._check()
        assert monitor._health.rotations_performed == 0

    def test_rotation_failure_doesnt_crash(self, monitor):
        # Try to rotate a nonexistent file
        monitor._rotate("/nonexistent/path/journal.jsonl")
        # Should not raise — just logs


# ---------------------------------------------------------------------------
# Recovery from degraded state
# ---------------------------------------------------------------------------

class TestRecovery:
    def test_recovers_after_write_failure_fixed(self, monitor, journal):
        journal.record("a1", "created")

        # Simulate failure
        os.chmod(journal.path, 0o444)
        try:
            monitor._check()
            assert monitor._health.consecutive_write_failures > 0
        finally:
            os.chmod(journal.path, 0o644)

        # Now check again — should recover
        monitor._check()
        h = monitor.get_health()
        assert h["consecutive_write_failures"] == 0
        assert h["last_write_ok"] is True


# ---------------------------------------------------------------------------
# Tool handler
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestToolHandler:
    async def test_returns_health_dict(self):
        result = await tool_get_journal_health({})
        assert "status" in result
        assert "file_exists" in result


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestLifecycle:
    async def test_start_and_stop(self, monitor):
        await monitor.start()
        assert monitor._running is True
        await monitor.stop()
        assert monitor._running is False

    async def test_double_start_is_safe(self, monitor):
        await monitor.start()
        await monitor.start()  # should not create second task
        assert monitor._running is True
        await monitor.stop()
