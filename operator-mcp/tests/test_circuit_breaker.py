"""Tests for operator.circuit_breaker — state transitions, HALF_OPEN gating."""
from __future__ import annotations

import time
from unittest.mock import patch

import pytest

from operator_mcp.circuit_breaker import CircuitBreaker, CircuitBreakerOpen, CircuitState


class TestInitialState:
    @pytest.mark.asyncio
    async def test_starts_closed(self):
        cb = CircuitBreaker("test")
        assert cb.state == CircuitState.CLOSED
        assert cb.is_available is True

    @pytest.mark.asyncio
    async def test_allow_request_when_closed(self):
        cb = CircuitBreaker("test")
        assert await cb.allow_request() is True

    def test_default_thresholds(self):
        cb = CircuitBreaker("test")
        assert cb.failure_threshold == 3
        assert cb.recovery_timeout == 10.0

    def test_custom_thresholds(self):
        cb = CircuitBreaker("test", failure_threshold=5, recovery_timeout=30.0)
        assert cb.failure_threshold == 5
        assert cb.recovery_timeout == 30.0


class TestClosedToOpen:
    @pytest.mark.asyncio
    async def test_single_failure_stays_closed(self):
        cb = CircuitBreaker("test", failure_threshold=3)
        await cb.record_failure()
        assert cb.state == CircuitState.CLOSED
        assert await cb.allow_request() is True

    @pytest.mark.asyncio
    async def test_trips_at_threshold(self):
        cb = CircuitBreaker("test", failure_threshold=3)
        await cb.record_failure()
        await cb.record_failure()
        await cb.record_failure()
        assert cb.state == CircuitState.OPEN
        assert await cb.allow_request() is False

    @pytest.mark.asyncio
    async def test_success_resets_failure_count(self):
        cb = CircuitBreaker("test", failure_threshold=3)
        await cb.record_failure()
        await cb.record_failure()
        await cb.record_success()
        await cb.record_failure()
        # Only 1 consecutive failure after reset, not 3
        assert cb.state == CircuitState.CLOSED


class TestOpenState:
    @pytest.mark.asyncio
    async def test_rejects_requests_when_open(self):
        cb = CircuitBreaker("test", failure_threshold=1)
        await cb.record_failure()
        assert cb.state == CircuitState.OPEN
        assert await cb.allow_request() is False
        assert cb.is_available is False

    @pytest.mark.asyncio
    async def test_status_shows_open_info(self):
        cb = CircuitBreaker("test", failure_threshold=1, recovery_timeout=10.0)
        await cb.record_failure()
        status = cb.status()
        assert status["state"] == "open"
        assert "open_for_s" in status
        assert "recovery_in_s" in status


class TestHalfOpenState:
    @pytest.mark.asyncio
    async def test_transitions_to_half_open_after_timeout(self):
        cb = CircuitBreaker("test", failure_threshold=1, recovery_timeout=0.01)
        await cb.record_failure()
        assert cb.state == CircuitState.OPEN
        time.sleep(0.02)
        assert cb.state == CircuitState.HALF_OPEN

    @pytest.mark.asyncio
    async def test_single_probe_allowed_in_half_open(self):
        cb = CircuitBreaker("test", failure_threshold=1, recovery_timeout=0.01)
        await cb.record_failure()
        time.sleep(0.02)
        # First request allowed (probe)
        assert await cb.allow_request() is True
        # Second request rejected (probe already in flight)
        assert await cb.allow_request() is False

    @pytest.mark.asyncio
    async def test_probe_success_closes_breaker(self):
        cb = CircuitBreaker("test", failure_threshold=1, recovery_timeout=0.01)
        await cb.record_failure()
        time.sleep(0.02)
        await cb.allow_request()  # Start probe
        await cb.record_success()
        assert cb.state == CircuitState.CLOSED
        assert await cb.allow_request() is True
        assert await cb.allow_request() is True  # No more gating

    @pytest.mark.asyncio
    async def test_probe_failure_reopens_breaker(self):
        cb = CircuitBreaker("test", failure_threshold=1, recovery_timeout=0.01)
        await cb.record_failure()
        time.sleep(0.02)
        await cb.allow_request()  # Start probe
        await cb.record_failure()
        assert cb.state == CircuitState.OPEN
        assert await cb.allow_request() is False

    @pytest.mark.asyncio
    async def test_probe_clears_after_success(self):
        cb = CircuitBreaker("test", failure_threshold=1, recovery_timeout=0.01)
        await cb.record_failure()
        time.sleep(0.02)
        await cb.allow_request()
        await cb.record_success()
        # After success, probe flag cleared — next HALF_OPEN cycle works
        await cb.record_failure()
        time.sleep(0.02)
        assert await cb.allow_request() is True

    @pytest.mark.asyncio
    async def test_probe_clears_after_failure(self):
        cb = CircuitBreaker("test", failure_threshold=1, recovery_timeout=0.01)
        await cb.record_failure()
        time.sleep(0.02)
        await cb.allow_request()
        await cb.record_failure()
        # Probe flag cleared on failure too — next recovery attempt works
        time.sleep(0.02)
        assert await cb.allow_request() is True


class TestReset:
    @pytest.mark.asyncio
    async def test_force_reset(self):
        cb = CircuitBreaker("test", failure_threshold=1)
        await cb.record_failure()
        assert cb.state == CircuitState.OPEN
        await cb.reset()
        assert cb.state == CircuitState.CLOSED
        assert await cb.allow_request() is True

    @pytest.mark.asyncio
    async def test_status_after_reset(self):
        cb = CircuitBreaker("test", failure_threshold=1)
        await cb.record_failure()
        await cb.reset()
        status = cb.status()
        assert status["state"] == "closed"
        assert status["consecutive_failures"] == 0


class TestCircuitBreakerOpenException:
    def test_exception_message(self):
        exc = CircuitBreakerOpen("sidecar", time.monotonic() - 5.0)
        assert "sidecar" in str(exc)
        assert "OPEN" in str(exc)
        assert exc.breaker_name == "sidecar"
