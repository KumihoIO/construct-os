"""Journal health monitor — background task that watches journal file integrity.

Monitors:
  - File size (warns at threshold, rotates at limit)
  - Write latency (detects slow disk / NFS issues)
  - Write failures (tracks consecutive failures)
  - File existence (detects accidental deletion)

Also provides journal rotation: when the file exceeds the size limit, the current
file is renamed to .1 (shifting existing backups) and a fresh file is started.

Usage:
    monitor = get_journal_health_monitor()
    monitor.set_journal(journal)
    await monitor.start()
    # ...
    monitor.get_health()  # -> {"status": "healthy", "file_size_kb": 42, ...}
"""
from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass, field
from typing import Any

from ._log import _log


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

_CHECK_INTERVAL = 30.0       # seconds between health checks
_WARN_SIZE_KB = 5_000        # 5 MB — log a warning
_ROTATE_SIZE_KB = 20_000     # 20 MB — trigger rotation
_MAX_BACKUPS = 3             # keep .1, .2, .3


# ---------------------------------------------------------------------------
# Health record
# ---------------------------------------------------------------------------

@dataclass
class JournalHealthStatus:
    """Snapshot of journal health."""
    status: str = "unknown"          # healthy, degraded, unhealthy
    file_exists: bool = False
    file_size_kb: float = 0.0
    last_check: float = 0.0          # monotonic
    last_write_ok: bool = True
    consecutive_write_failures: int = 0
    last_write_latency_ms: float = 0.0
    rotations_performed: int = 0
    checks_performed: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "file_exists": self.file_exists,
            "file_size_kb": round(self.file_size_kb, 1),
            "last_write_ok": self.last_write_ok,
            "consecutive_write_failures": self.consecutive_write_failures,
            "last_write_latency_ms": round(self.last_write_latency_ms, 2),
            "rotations_performed": self.rotations_performed,
            "checks_performed": self.checks_performed,
        }


# ---------------------------------------------------------------------------
# Monitor
# ---------------------------------------------------------------------------

class JournalHealthMonitor:
    """Background task that monitors journal file health."""

    def __init__(
        self,
        *,
        interval: float = _CHECK_INTERVAL,
        warn_size_kb: float = _WARN_SIZE_KB,
        rotate_size_kb: float = _ROTATE_SIZE_KB,
        max_backups: int = _MAX_BACKUPS,
    ):
        self._interval = interval
        self._warn_size_kb = warn_size_kb
        self._rotate_size_kb = rotate_size_kb
        self._max_backups = max_backups
        self._journal: Any = None
        self._health = JournalHealthStatus()
        self._task: asyncio.Task | None = None
        self._running = False

    def set_journal(self, journal: Any) -> None:
        self._journal = journal

    @property
    def journal_path(self) -> str | None:
        if self._journal is None:
            return None
        return getattr(self._journal, "path", None)

    # -- Lifecycle --

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        _log(f"JournalHealthMonitor: started (interval={self._interval}s)")

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    # -- Query API --

    def get_health(self) -> dict[str, Any]:
        return self._health.to_dict()

    # -- Internals --

    async def _loop(self) -> None:
        while self._running:
            try:
                self._check()
            except Exception as e:
                _log(f"JournalHealthMonitor: error in check: {e}")
            await asyncio.sleep(self._interval)

    def _check(self) -> None:
        h = self._health
        h.checks_performed += 1
        h.last_check = time.monotonic()

        path = self.journal_path
        if path is None:
            h.status = "unhealthy"
            h.file_exists = False
            return

        # File existence
        h.file_exists = os.path.exists(path)
        if not h.file_exists:
            h.status = "degraded"
            h.file_size_kb = 0
            return

        # File size
        try:
            size_bytes = os.path.getsize(path)
            h.file_size_kb = size_bytes / 1024.0
        except OSError:
            h.status = "degraded"
            return

        # Rotation check
        if h.file_size_kb >= self._rotate_size_kb:
            self._rotate(path)
        elif h.file_size_kb >= self._warn_size_kb:
            _log(f"JournalHealthMonitor: journal is {h.file_size_kb:.0f} KB (warn threshold)")

        # Write probe — append a no-op marker and measure latency
        latency = self._write_probe(path)
        h.last_write_latency_ms = latency
        if latency < 0:
            h.last_write_ok = False
            h.consecutive_write_failures += 1
        else:
            h.last_write_ok = True
            h.consecutive_write_failures = 0

        # Determine overall status
        if h.consecutive_write_failures >= 3:
            h.status = "unhealthy"
        elif h.consecutive_write_failures > 0 or h.file_size_kb >= self._warn_size_kb:
            h.status = "degraded"
        else:
            h.status = "healthy"

    def _write_probe(self, path: str) -> float:
        """Attempt a minimal write to measure latency. Returns ms or -1 on failure."""
        try:
            start = time.monotonic()
            with open(path, "a") as f:
                # Write an empty line that JSON parsers will skip
                f.write("")
                f.flush()
                os.fsync(f.fileno())
            elapsed = (time.monotonic() - start) * 1000.0
            return elapsed
        except Exception as e:
            _log(f"JournalHealthMonitor: write probe failed: {e}")
            return -1.0

    def _rotate(self, path: str) -> None:
        """Rotate journal: current -> .1, .1 -> .2, etc."""
        _log(f"JournalHealthMonitor: rotating journal ({self._health.file_size_kb:.0f} KB)")
        try:
            # Shift existing backups
            for i in range(self._max_backups, 0, -1):
                src = f"{path}.{i}" if i > 1 else f"{path}.1"
                if i == self._max_backups:
                    # Delete the oldest backup
                    old = f"{path}.{i}"
                    if os.path.exists(old):
                        os.remove(old)
                    continue
                dst = f"{path}.{i + 1}"
                if os.path.exists(src):
                    os.rename(src, dst)

            # Move current -> .1
            os.rename(path, f"{path}.1")
            self._health.rotations_performed += 1
            self._health.file_size_kb = 0
            _log("JournalHealthMonitor: rotation complete")
        except Exception as e:
            _log(f"JournalHealthMonitor: rotation failed: {e}")


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_monitor: JournalHealthMonitor | None = None


def get_journal_health_monitor() -> JournalHealthMonitor:
    global _monitor
    if _monitor is None:
        _monitor = JournalHealthMonitor()
    return _monitor


# ---------------------------------------------------------------------------
# Tool handler
# ---------------------------------------------------------------------------

async def tool_get_journal_health(args: dict[str, Any]) -> dict[str, Any]:
    """Get journal health status."""
    monitor = get_journal_health_monitor()
    return monitor.get_health()
