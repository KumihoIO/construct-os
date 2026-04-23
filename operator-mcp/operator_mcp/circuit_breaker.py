"""Circuit breaker for sidecar communication.

Three states:
  CLOSED   — healthy, requests pass through
  OPEN     — broken, requests fail-fast (no network call)
  HALF_OPEN — one probe allowed; success → CLOSED, failure → OPEN

Prevents cascading timeouts when the sidecar is down. Instead of each
agent operation individually waiting 30s to discover the sidecar is dead,
the breaker trips after a few failures and all subsequent calls fail
instantly until a recovery probe succeeds.
"""
from __future__ import annotations

import asyncio
import time
from enum import Enum
from typing import Any

try:
    from ._log import _log
except ImportError:
    import sys
    _log = lambda msg: sys.stderr.write(f"[circuit_breaker] {msg}\n")


class CircuitState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitBreakerOpen(Exception):
    """Raised when a call is rejected because the circuit is open."""

    def __init__(self, breaker_name: str, open_since: float) -> None:
        self.breaker_name = breaker_name
        self.open_since = open_since
        age = time.monotonic() - open_since
        super().__init__(f"Circuit '{breaker_name}' is OPEN (tripped {age:.1f}s ago)")


class CircuitBreaker:
    """Async-safe circuit breaker for a single dependency.

    Usage:
        breaker = CircuitBreaker("sidecar")

        # Wrap calls
        if await breaker.allow_request():
            try:
                result = await sidecar.get_agent(id)
                await breaker.record_success()
            except Exception:
                await breaker.record_failure()
        else:
            # fail-fast path
            ...

        # Or use the context manager
        async with breaker.guard():
            result = await sidecar.get_agent(id)
    """

    def __init__(
        self,
        name: str = "sidecar",
        *,
        failure_threshold: int = 3,
        recovery_timeout: float = 10.0,
    ) -> None:
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout

        self._state = CircuitState.CLOSED
        self._consecutive_failures = 0
        self._last_failure_time = 0.0
        self._opened_at = 0.0
        self._half_open_probe_active = False  # Only one probe at a time
        self._lock = asyncio.Lock()

    @property
    def state(self) -> CircuitState:
        """Current state, transitioning OPEN → HALF_OPEN if recovery timeout elapsed."""
        if self._state == CircuitState.OPEN:
            if time.monotonic() - self._opened_at >= self.recovery_timeout:
                return CircuitState.HALF_OPEN
        return self._state

    @property
    def is_available(self) -> bool:
        """Whether requests can pass (CLOSED or HALF_OPEN)."""
        return self.state != CircuitState.OPEN

    async def allow_request(self) -> bool:
        """Check if a request should be allowed through.

        In HALF_OPEN state, only one probe request is allowed at a time.
        Subsequent callers are rejected until the probe completes.
        """
        async with self._lock:
            current = self.state
            if current == CircuitState.CLOSED:
                return True
            if current == CircuitState.OPEN:
                return False
            # HALF_OPEN: allow exactly one probe
            if self._half_open_probe_active:
                return False  # Another probe is in flight
            self._half_open_probe_active = True
            return True

    async def record_success(self) -> None:
        """Record a successful call. Resets the breaker to CLOSED."""
        async with self._lock:
            if self._state != CircuitState.CLOSED:
                _log(f"CircuitBreaker[{self.name}]: recovered → CLOSED")
            self._state = CircuitState.CLOSED
            self._consecutive_failures = 0
            self._half_open_probe_active = False

    async def record_failure(self) -> None:
        """Record a failed call. May trip the breaker to OPEN."""
        async with self._lock:
            self._consecutive_failures += 1
            self._last_failure_time = time.monotonic()
            self._half_open_probe_active = False

            if self._consecutive_failures >= self.failure_threshold:
                if self._state != CircuitState.OPEN:
                    _log(
                        f"CircuitBreaker[{self.name}]: tripped → OPEN "
                        f"after {self._consecutive_failures} consecutive failures"
                    )
                self._state = CircuitState.OPEN
                self._opened_at = time.monotonic()

    async def reset(self) -> None:
        """Force reset to CLOSED (e.g. after manual recovery)."""
        async with self._lock:
            self._state = CircuitState.CLOSED
            self._consecutive_failures = 0
            _log(f"CircuitBreaker[{self.name}]: force reset → CLOSED")

    def status(self) -> dict[str, Any]:
        """Return breaker status for diagnostics."""
        now = time.monotonic()
        result: dict[str, Any] = {
            "name": self.name,
            "state": self.state.value,
            "consecutive_failures": self._consecutive_failures,
            "failure_threshold": self.failure_threshold,
            "recovery_timeout_s": self.recovery_timeout,
        }
        if self._state == CircuitState.OPEN:
            result["open_for_s"] = round(now - self._opened_at, 1)
            result["recovery_in_s"] = round(
                max(0, self.recovery_timeout - (now - self._opened_at)), 1
            )
        return result
