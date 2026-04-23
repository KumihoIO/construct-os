"""Tests for operator.spawn_tracker — progress tracking, stage lifecycle, cleanup."""
from __future__ import annotations

import pytest

from operator_mcp.spawn_tracker import (
    SpawnTracker,
    StageInfo,
    get_or_create_tracker,
    get_tracker,
    list_trackers,
    cleanup_trackers,
    _TRACKERS,
)


@pytest.fixture(autouse=True)
def clean_trackers():
    """Clear tracker registry before/after each test."""
    _TRACKERS.clear()
    yield
    _TRACKERS.clear()


class TestStageInfo:
    def test_defaults(self):
        s = StageInfo(stage_idx=0)
        assert s.status == "pending"
        assert s.agents == []
        assert s.agent_statuses == {}
        assert s.started_at == 0.0
        assert s.completed_at == 0.0


class TestSpawnTrackerLifecycle:
    def test_initial_state(self):
        t = SpawnTracker(team_name="test-team")
        assert t.status == "initializing"
        assert t.current_stage == -1
        assert t.total_stages == 0
        assert t.stages == []

    def test_init_stages(self):
        t = SpawnTracker(team_name="test-team")
        t.init_stages(3)
        assert t.total_stages == 3
        assert t.status == "running"
        assert len(t.stages) == 3
        for i, s in enumerate(t.stages):
            assert s.stage_idx == i
            assert s.status == "pending"

    def test_stage_start(self):
        t = SpawnTracker(team_name="test-team")
        t.init_stages(2)
        t.record_stage_start(0, ["a-1", "a-2"])
        assert t.current_stage == 0
        assert t.stages[0].status == "running"
        assert t.stages[0].agents == ["a-1", "a-2"]
        assert t.stages[0].agent_statuses == {"a-1": "spawning", "a-2": "spawning"}
        assert t.stages[0].started_at > 0

    def test_agent_spawned(self):
        t = SpawnTracker(team_name="test-team")
        t.init_stages(1)
        t.record_stage_start(0, ["a-1"])
        t.record_agent_spawned(0, "a-1", title="coder-test")
        assert t.stages[0].agent_statuses["a-1"] == "running"

    def test_agent_failed(self):
        t = SpawnTracker(team_name="test-team")
        t.init_stages(1)
        t.record_stage_start(0, ["a-1"])
        t.record_agent_failed(0, "a-1", error="spawn error")
        assert t.stages[0].agent_statuses["a-1"] == "failed"

    def test_agent_complete_finds_correct_stage(self):
        t = SpawnTracker(team_name="test-team")
        t.init_stages(2)
        t.record_stage_start(0, ["a-1"])
        t.record_stage_start(1, ["a-2"])
        t.record_agent_complete("a-1", status="completed")
        assert t.stages[0].agent_statuses["a-1"] == "completed"
        # a-2 still in stage 1 unaffected
        assert t.stages[1].agent_statuses["a-2"] == "spawning"

    def test_stage_complete_success(self):
        t = SpawnTracker(team_name="test-team")
        t.init_stages(1)
        t.record_stage_start(0, ["a-1"])
        t.record_agent_spawned(0, "a-1")
        t.record_agent_complete("a-1", status="completed")
        t.record_stage_complete(0)
        assert t.stages[0].status == "completed"
        assert t.stages[0].completed_at > 0

    def test_stage_complete_with_failure(self):
        t = SpawnTracker(team_name="test-team")
        t.init_stages(1)
        t.record_stage_start(0, ["a-1", "a-2"])
        t.record_agent_complete("a-1", status="completed")
        t.record_agent_complete("a-2", status="failed")
        t.record_stage_complete(0)
        assert t.stages[0].status == "failed"

    def test_record_halt(self):
        t = SpawnTracker(team_name="test-team")
        t.init_stages(3)
        t.record_stage_start(0, ["a-1"])
        t.record_stage_complete(0)
        t.record_halt(1, "upstream failure")
        assert t.status == "halted"
        assert t.halt_reason == "upstream failure"
        assert t.stages[1].status == "halted"
        assert t.stages[2].status == "halted"
        # Stage 0 was already completed, should not change
        assert t.stages[0].status == "completed"

    def test_record_complete_all_success(self):
        t = SpawnTracker(team_name="test-team")
        t.init_stages(2)
        t.record_stage_start(0, ["a-1"])
        t.record_stage_complete(0)
        t.record_stage_start(1, ["a-2"])
        t.record_stage_complete(1)
        t.record_complete()
        assert t.status == "completed"
        assert t.completed_at > 0

    def test_record_complete_with_failed_stage(self):
        t = SpawnTracker(team_name="test-team")
        t.init_stages(1)
        t.record_stage_start(0, ["a-1"])
        t.record_agent_complete("a-1", status="failed")
        t.record_stage_complete(0)
        t.record_complete()
        assert t.status == "failed"

    def test_out_of_bounds_stage_idx_ignored(self):
        t = SpawnTracker(team_name="test-team")
        t.init_stages(1)
        # Should not raise
        t.record_stage_start(99, ["a-1"])
        t.record_agent_spawned(99, "a-1")
        t.record_agent_failed(99, "a-1")
        t.record_stage_complete(99)


class TestGetProgress:
    def test_basic_progress(self):
        t = SpawnTracker(team_name="test-team")
        t.init_stages(2)
        p = t.get_progress()
        assert p["team"] == "test-team"
        assert p["status"] == "running"
        assert p["total_stages"] == 2
        assert len(p["stages"]) == 2

    def test_progress_with_agents(self):
        t = SpawnTracker(team_name="test-team")
        t.init_stages(1)
        t.record_stage_start(0, ["a-1", "a-2"])
        p = t.get_progress()
        stage = p["stages"][0]
        assert stage["agent_count"] == 2
        assert "agents" in stage
        assert stage["agents"]["a-1"] == "spawning"

    def test_halt_reason_in_progress(self):
        t = SpawnTracker(team_name="test-team")
        t.init_stages(2)
        t.record_halt(0, "critical failure")
        p = t.get_progress()
        assert p["halt_reason"] == "critical failure"

    def test_elapsed_present(self):
        t = SpawnTracker(team_name="test-team")
        t.init_stages(1)
        t.record_stage_start(0, ["a-1"])
        p = t.get_progress()
        assert "elapsed_s" in p
        assert p["stages"][0].get("elapsed_s") is not None


class TestTrackerRegistry:
    def test_get_or_create(self):
        t = get_or_create_tracker("team-alpha")
        assert t.team_name == "team-alpha"
        # Same team returns same instance
        assert get_or_create_tracker("team-alpha") is t

    def test_get_tracker_not_found(self):
        assert get_tracker("nonexistent") is None

    def test_get_tracker_found(self):
        get_or_create_tracker("team-beta")
        t = get_tracker("team-beta")
        assert t is not None
        assert t.team_name == "team-beta"

    def test_list_trackers(self):
        get_or_create_tracker("team-1")
        get_or_create_tracker("team-2")
        result = list_trackers()
        assert len(result) == 2
        names = {r["team"] for r in result}
        assert names == {"team-1", "team-2"}


class TestCleanupTrackers:
    def test_no_cleanup_below_limit(self):
        for i in range(5):
            t = get_or_create_tracker(f"team-{i}")
            t.record_complete()
        removed = cleanup_trackers(max_completed=10)
        assert removed == 0

    def test_cleanup_evicts_oldest(self):
        for i in range(15):
            t = get_or_create_tracker(f"team-{i}")
            t.init_stages(1)
            t.record_stage_start(0, [f"a-{i}"])
            t.record_stage_complete(0)
            t.record_complete()
        removed = cleanup_trackers(max_completed=5)
        assert removed == 10
        assert len(_TRACKERS) == 5

    def test_running_trackers_not_evicted(self):
        # Create 10 completed + 5 running
        for i in range(10):
            t = get_or_create_tracker(f"done-{i}")
            t.record_complete()
        for i in range(5):
            t = get_or_create_tracker(f"running-{i}")
            t.init_stages(1)
            t.record_stage_start(0, [f"a-{i}"])
            # Don't complete these
        removed = cleanup_trackers(max_completed=3)
        assert removed == 7
        # Running ones should still be there
        for i in range(5):
            assert get_tracker(f"running-{i}") is not None
