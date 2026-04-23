"""Tracks team spawn progress across stages/waves.

When spawn_team kicks off background stages, this tracker records progress
so the operator can query "how far along is team X?" without waiting for
the full spawn to complete.

Usage:
    tracker = get_or_create_tracker(team_name)
    tracker.record_stage_start(0, ["agent-a", "agent-b"])
    tracker.record_agent_complete("agent-a", status="completed")
    tracker.record_stage_complete(0)

    # Query
    tracker.get_progress()  # -> {"team": ..., "current_stage": ..., "stages": [...]}
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any

try:
    from ._log import _log
except ImportError:
    import sys
    _log = lambda msg: sys.stderr.write(f"[spawn_tracker] {msg}\n")


@dataclass
class StageInfo:
    """Progress info for a single spawn stage."""
    stage_idx: int
    agents: list[str] = field(default_factory=list)
    status: str = "pending"  # pending, running, completed, failed, halted
    started_at: float = 0.0
    completed_at: float = 0.0
    agent_statuses: dict[str, str] = field(default_factory=dict)  # agent_id -> status


@dataclass
class SpawnTracker:
    """Tracks spawn progress for a single team deployment."""
    team_name: str
    total_stages: int = 0
    current_stage: int = -1
    status: str = "initializing"  # initializing, running, completed, failed, halted
    stages: list[StageInfo] = field(default_factory=list)
    started_at: float = field(default_factory=time.monotonic)
    completed_at: float = 0.0
    halt_reason: str = ""

    def init_stages(self, total: int) -> None:
        """Initialize stage slots."""
        self.total_stages = total
        self.stages = [StageInfo(stage_idx=i) for i in range(total)]
        self.status = "running"

    def record_stage_start(self, stage_idx: int, agent_ids: list[str]) -> None:
        """Record that a stage has started spawning."""
        if stage_idx < len(self.stages):
            stage = self.stages[stage_idx]
            stage.agents = agent_ids
            stage.status = "running"
            stage.started_at = time.monotonic()
            stage.agent_statuses = {aid: "spawning" for aid in agent_ids}
            self.current_stage = stage_idx
            _log(f"SpawnTracker[{self.team_name}]: stage {stage_idx} started ({len(agent_ids)} agents)")

    def record_agent_spawned(self, stage_idx: int, agent_id: str, *, title: str = "") -> None:
        """Record that an agent was successfully spawned."""
        if stage_idx < len(self.stages):
            self.stages[stage_idx].agent_statuses[agent_id] = "running"

    def record_agent_failed(self, stage_idx: int, agent_id: str, *, error: str = "") -> None:
        """Record that an agent failed to spawn."""
        if stage_idx < len(self.stages):
            self.stages[stage_idx].agent_statuses[agent_id] = "failed"

    def record_agent_complete(self, agent_id: str, *, status: str = "completed") -> None:
        """Record that an agent finished (any stage)."""
        for stage in self.stages:
            if agent_id in stage.agent_statuses:
                stage.agent_statuses[agent_id] = status
                break

    def record_stage_complete(self, stage_idx: int) -> None:
        """Record that all agents in a stage have finished."""
        if stage_idx < len(self.stages):
            stage = self.stages[stage_idx]
            stage.completed_at = time.monotonic()
            failed = [
                aid for aid, st in stage.agent_statuses.items()
                if st in ("failed", "error")
            ]
            stage.status = "failed" if failed else "completed"
            _log(f"SpawnTracker[{self.team_name}]: stage {stage_idx} {stage.status}")

    def record_halt(self, stage_idx: int, reason: str) -> None:
        """Record that spawning was halted due to upstream failure."""
        self.status = "halted"
        self.halt_reason = reason
        self.completed_at = time.monotonic()
        # Mark remaining stages as halted
        for i in range(stage_idx, len(self.stages)):
            if self.stages[i].status == "pending":
                self.stages[i].status = "halted"
        _log(f"SpawnTracker[{self.team_name}]: HALTED at stage {stage_idx}: {reason}")

    def record_complete(self) -> None:
        """Record that all stages finished (success or partial)."""
        self.completed_at = time.monotonic()
        any_failed = any(s.status == "failed" for s in self.stages)
        self.status = "failed" if any_failed else "completed"
        _log(f"SpawnTracker[{self.team_name}]: {self.status}")

    def get_progress(self) -> dict[str, Any]:
        """Return structured progress report."""
        now = time.monotonic()
        stages_info = []
        for s in self.stages:
            info: dict[str, Any] = {
                "stage": s.stage_idx,
                "status": s.status,
                "agent_count": len(s.agents),
            }
            if s.agent_statuses:
                info["agents"] = dict(s.agent_statuses)
            if s.started_at:
                info["elapsed_s"] = round(
                    (s.completed_at or now) - s.started_at, 1
                )
            stages_info.append(info)

        result: dict[str, Any] = {
            "team": self.team_name,
            "status": self.status,
            "current_stage": self.current_stage,
            "total_stages": self.total_stages,
            "stages": stages_info,
            "elapsed_s": round((self.completed_at or now) - self.started_at, 1),
        }
        if self.halt_reason:
            result["halt_reason"] = self.halt_reason
        return result


# -- Registry ------------------------------------------------------------------

_TRACKERS: dict[str, SpawnTracker] = {}
_TRACKERS_LOCK = asyncio.Lock()


def get_or_create_tracker(team_name: str) -> SpawnTracker:
    """Get existing tracker or create a new one."""
    if team_name not in _TRACKERS:
        _TRACKERS[team_name] = SpawnTracker(team_name=team_name)
    return _TRACKERS[team_name]


def get_tracker(team_name: str) -> SpawnTracker | None:
    """Get tracker by team name, or None."""
    return _TRACKERS.get(team_name)


def list_trackers() -> list[dict[str, Any]]:
    """List all spawn trackers with summary info."""
    return [t.get_progress() for t in _TRACKERS.values()]


def cleanup_trackers(*, max_completed: int = 50) -> int:
    """Remove oldest completed/halted trackers if over limit. Returns count removed."""
    completed = [
        (name, t) for name, t in _TRACKERS.items()
        if t.status in ("completed", "failed", "halted")
    ]
    if len(completed) <= max_completed:
        return 0
    # Sort by completion time, remove oldest
    completed.sort(key=lambda x: x[1].completed_at)
    to_remove = len(completed) - max_completed
    for name, _ in completed[:to_remove]:
        del _TRACKERS[name]
    return to_remove
