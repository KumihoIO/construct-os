"""Heartbeat monitor — periodic liveness checks for running agents.

Runs as a background asyncio task that polls running agents at a configurable
interval. Detects stuck agents (no activity for N seconds) and updates their
health status.

Usage:
    monitor = HeartbeatMonitor(interval=10.0, stale_threshold=120.0)
    await monitor.start()
    # ...
    monitor.get_health(agent_id)  # -> {"alive": True, "last_activity": ...}
    await monitor.stop()

Integrated into operator_mcp at boot via get_heartbeat_monitor().
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any

from ._log import _log
from .agent_state import AGENTS, ManagedAgent
from .run_log import get_log


# ---------------------------------------------------------------------------
# Health record per agent
# ---------------------------------------------------------------------------

@dataclass
class AgentHealth:
    """Liveness state for a single agent."""
    agent_id: str
    alive: bool = True
    last_check: float = 0.0
    last_activity: float = 0.0      # monotonic time of last observed activity
    last_event_count: int = 0       # event count at last check
    stale_since: float = 0.0        # monotonic time when we first noticed no activity
    consecutive_stale: int = 0      # how many checks in a row with no new activity
    status_at_last_check: str = ""


# ---------------------------------------------------------------------------
# Heartbeat monitor
# ---------------------------------------------------------------------------

class HeartbeatMonitor:
    """Background task that periodically checks running agent liveness."""

    def __init__(
        self,
        *,
        interval: float = 10.0,        # seconds between checks
        stale_threshold: float = 120.0, # seconds of no activity → "stale"
        dead_threshold: float = 300.0,  # seconds of no activity → "dead"
    ):
        self._interval = interval
        self._stale_threshold = stale_threshold
        self._dead_threshold = dead_threshold
        self._health: dict[str, AgentHealth] = {}
        self._task: asyncio.Task | None = None
        self._running = False
        self._sidecar_client = None  # Set by operator_mcp at boot

    def set_sidecar_client(self, client: Any) -> None:
        """Inject the sidecar client for richer health checks."""
        self._sidecar_client = client

    async def start(self) -> None:
        """Start the background heartbeat loop."""
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        _log(f"HeartbeatMonitor: started (interval={self._interval}s, stale={self._stale_threshold}s)")

    async def stop(self) -> None:
        """Stop the heartbeat loop."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        _log("HeartbeatMonitor: stopped")

    # -- Query API --

    def get_health(self, agent_id: str) -> dict[str, Any] | None:
        """Get health info for a specific agent."""
        h = self._health.get(agent_id)
        if h is None:
            return None
        return self._health_dict(h)

    def get_all_health(self) -> list[dict[str, Any]]:
        """Get health for all tracked agents."""
        return [self._health_dict(h) for h in self._health.values()]

    def get_stale_agents(self) -> list[dict[str, Any]]:
        """Get agents that appear stuck (stale or dead)."""
        now = time.monotonic()
        stale = []
        for h in self._health.values():
            if h.stale_since and (now - h.stale_since) >= self._stale_threshold:
                stale.append(self._health_dict(h))
        return stale

    # -- Internals --

    async def _loop(self) -> None:
        """Main heartbeat loop."""
        while self._running:
            try:
                await self._check_all()
            except Exception as exc:
                _log(f"HeartbeatMonitor: error in check loop: {exc}")
            await asyncio.sleep(self._interval)

    async def _check_all(self) -> None:
        """Check liveness of all running agents."""
        now = time.monotonic()

        for agent_id, agent in list(AGENTS.items()):
            if agent.status not in ("running",):
                # Mark completed agents with terminal status and clear stale indicators
                if agent_id in self._health:
                    h = self._health[agent_id]
                    h.alive = False
                    h.stale_since = 0.0
                    h.consecutive_stale = 0
                    h.status_at_last_check = agent.status
                continue

            h = self._health.get(agent_id)
            if h is None:
                h = AgentHealth(agent_id=agent_id, last_activity=now, last_check=now)
                self._health[agent_id] = h

            # Check for new activity via RunLog event count
            current_events = self._get_event_count(agent_id, agent)

            if current_events > h.last_event_count:
                # New activity detected
                h.last_activity = now
                h.last_event_count = current_events
                h.consecutive_stale = 0
                h.stale_since = 0.0
                h.alive = True
            else:
                # No new activity
                h.consecutive_stale += 1
                if not h.stale_since:
                    h.stale_since = now

                idle_time = now - h.last_activity
                if idle_time >= self._dead_threshold:
                    h.alive = False
                    _log(f"HeartbeatMonitor: agent {agent_id[:8]} DEAD (no activity for {idle_time:.0f}s)")
                elif idle_time >= self._stale_threshold:
                    _log(f"HeartbeatMonitor: agent {agent_id[:8]} STALE (no activity for {idle_time:.0f}s)")

            h.last_check = now
            h.status_at_last_check = agent.status

            # Optional: sidecar ping for richer status
            if self._sidecar_client and getattr(agent, "_sidecar_id", None):
                await self._sidecar_ping(agent, h)

    async def _sidecar_ping(self, agent: ManagedAgent, health: AgentHealth) -> None:
        """Ping sidecar for agent status (best-effort)."""
        try:
            info = await self._sidecar_client.get_agent(agent._sidecar_id)
            if info:
                sidecar_status = info.get("status", "")
                if sidecar_status in ("idle", "error", "closed"):
                    # Sidecar says agent is done but our state disagrees
                    if agent.status == "running":
                        _log(f"HeartbeatMonitor: sidecar says {agent.id[:8]} is {sidecar_status}, updating")
                        agent.status = "completed" if sidecar_status == "idle" else sidecar_status
                        health.alive = False
        except Exception:
            pass  # Best-effort — don't fail the heartbeat loop

    def _get_event_count(self, agent_id: str, agent: ManagedAgent) -> int:
        """Get current event count from RunLog."""
        run_log = get_log(agent_id)
        sidecar_id = getattr(agent, "_sidecar_id", None)
        if run_log is None and sidecar_id:
            run_log = get_log(sidecar_id)
        if run_log:
            summary = run_log.get_summary()
            return summary.get("total_events", 0)
        # Fallback: use stdout buffer length as proxy
        return len(agent.stdout_buffer)

    def _health_dict(self, h: AgentHealth) -> dict[str, Any]:
        """Convert health record to dict."""
        now = time.monotonic()
        idle_seconds = round(now - h.last_activity, 1) if h.last_activity else 0
        d: dict[str, Any] = {
            "agent_id": h.agent_id,
            "alive": h.alive,
            "idle_seconds": idle_seconds,
            "consecutive_stale_checks": h.consecutive_stale,
            "status": h.status_at_last_check,
        }
        # Terminal agents (completed/error/closed) are not stale — they're just done
        if h.status_at_last_check in ("completed", "error", "closed", "idle"):
            d["health"] = "completed"
        elif h.stale_since:
            stale_for = round(now - h.stale_since, 1)
            if stale_for >= self._stale_threshold:
                d["health"] = "dead" if stale_for >= self._dead_threshold else "stale"
                d["stale_seconds"] = stale_for
            else:
                d["health"] = "healthy"
        else:
            d["health"] = "healthy"
        return d


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_monitor: HeartbeatMonitor | None = None


def get_heartbeat_monitor() -> HeartbeatMonitor:
    """Get or create the global heartbeat monitor."""
    global _monitor
    if _monitor is None:
        _monitor = HeartbeatMonitor()
    return _monitor


# ---------------------------------------------------------------------------
# Tool handlers
# ---------------------------------------------------------------------------

async def tool_get_agent_health(args: dict[str, Any]) -> dict[str, Any]:
    """Get health/liveness info for agents."""
    monitor = get_heartbeat_monitor()
    agent_id = args.get("agent_id")

    if agent_id:
        health = monitor.get_health(agent_id)
        if health is None:
            return {"error": f"No health data for agent {agent_id}", "hint": "Agent may not have been tracked yet."}
        return health

    # Default: return all health + highlight stale
    all_health = monitor.get_all_health()
    stale = monitor.get_stale_agents()
    return {
        "agents": all_health,
        "total": len(all_health),
        "stale_count": len(stale),
        "stale_agents": stale if stale else None,
    }
