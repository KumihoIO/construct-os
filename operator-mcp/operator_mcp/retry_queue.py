"""Async retry queue for transient operator failures.

When a tool call fails with a retryable error (backend_transport, etc.),
the operation can be enqueued here for automatic retry with exponential
backoff instead of being dropped.

Usage:
    queue = RetryQueue()
    await queue.start()

    # Enqueue a retryable operation
    queue.enqueue(
        op_id="wait-abc123",
        coro_factory=lambda: tool_wait_for_agent({"agent_id": "abc123"}),
        max_retries=3,
        on_success=lambda result: log("recovered", result),
        on_exhausted=lambda op_id, last_err: log("gave up", op_id),
    )

    # Later
    await queue.stop()
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Coroutine

try:
    from ._log import _log
except ImportError:
    import sys
    _log = lambda msg: sys.stderr.write(f"[retry_queue] {msg}\n")


@dataclass
class RetryOp:
    """A single retryable operation."""
    op_id: str
    coro_factory: Callable[[], Coroutine[Any, Any, dict[str, Any]]]
    max_retries: int = 3
    attempt: int = 0
    backoff: float = 2.0  # seconds, doubles each retry
    max_backoff: float = 30.0
    next_retry_at: float = 0.0
    last_error: str = ""
    on_success: Callable[[dict[str, Any]], Any] | None = None
    on_exhausted: Callable[[str, str], Any] | None = None
    created_at: float = field(default_factory=time.monotonic)


class RetryQueue:
    """Background retry queue with exponential backoff.

    Processes enqueued operations in order, respecting per-op retry
    schedules. Thread-safe via asyncio (single event loop).
    """

    def __init__(self, *, poll_interval: float = 1.0) -> None:
        self._queue: dict[str, RetryOp] = {}
        self._poll_interval = poll_interval
        self._task: asyncio.Task[None] | None = None
        self._running = False

        # Stats
        self.total_enqueued = 0
        self.total_succeeded = 0
        self.total_exhausted = 0

    @property
    def pending_count(self) -> int:
        return len(self._queue)

    def enqueue(
        self,
        op_id: str,
        coro_factory: Callable[[], Coroutine[Any, Any, dict[str, Any]]],
        *,
        max_retries: int = 3,
        initial_backoff: float = 2.0,
        on_success: Callable[[dict[str, Any]], Any] | None = None,
        on_exhausted: Callable[[str, str], Any] | None = None,
    ) -> None:
        """Enqueue an operation for retry.

        Args:
            op_id: Unique ID for deduplication. Replaces existing op with same ID.
            coro_factory: Callable that returns a fresh coroutine each time.
            max_retries: Max retry attempts before giving up.
            initial_backoff: First retry delay in seconds.
            on_success: Called with result dict when retry succeeds.
            on_exhausted: Called with (op_id, last_error) when all retries fail.
        """
        if op_id in self._queue:
            _log(f"RetryQueue: replacing existing op {op_id}")

        self._queue[op_id] = RetryOp(
            op_id=op_id,
            coro_factory=coro_factory,
            max_retries=max_retries,
            backoff=initial_backoff,
            next_retry_at=time.monotonic() + initial_backoff,
            on_success=on_success,
            on_exhausted=on_exhausted,
        )
        self.total_enqueued += 1
        _log(f"RetryQueue: enqueued {op_id} (max_retries={max_retries}, backoff={initial_backoff}s)")

    def cancel(self, op_id: str) -> bool:
        """Cancel a pending retry operation."""
        if op_id in self._queue:
            del self._queue[op_id]
            _log(f"RetryQueue: cancelled {op_id}")
            return True
        return False

    async def start(self) -> None:
        """Start the background retry processor."""
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._process_loop())
        _log("RetryQueue: started")

    async def stop(self) -> None:
        """Stop the retry processor. Pending ops are preserved (not retried)."""
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        _log(f"RetryQueue: stopped ({self.pending_count} ops remaining)")

    def status(self) -> dict[str, Any]:
        """Return queue status for diagnostics."""
        now = time.monotonic()
        ops = []
        for op in self._queue.values():
            ops.append({
                "op_id": op.op_id,
                "attempt": op.attempt,
                "max_retries": op.max_retries,
                "next_retry_in_s": round(max(0, op.next_retry_at - now), 1),
                "last_error": op.last_error[:200] if op.last_error else "",
            })
        return {
            "running": self._running,
            "pending_count": self.pending_count,
            "total_enqueued": self.total_enqueued,
            "total_succeeded": self.total_succeeded,
            "total_exhausted": self.total_exhausted,
            "operations": ops,
        }

    async def _process_loop(self) -> None:
        """Main loop: check each op, retry if due."""
        try:
            while self._running:
                now = time.monotonic()
                ready = [
                    op for op in self._queue.values()
                    if op.next_retry_at <= now
                ]

                for op in ready:
                    await self._try_op(op)

                await asyncio.sleep(self._poll_interval)
        except asyncio.CancelledError:
            pass

    async def _try_op(self, op: RetryOp) -> None:
        """Execute one retry attempt for an operation."""
        op.attempt += 1
        _log(f"RetryQueue: retrying {op.op_id} (attempt {op.attempt}/{op.max_retries})")

        try:
            result = await op.coro_factory()
        except Exception as e:
            result = {"error": str(e), "error_category": "internal_error"}

        # Check if the retry succeeded
        if "error" not in result:
            # Success
            _log(f"RetryQueue: {op.op_id} succeeded on attempt {op.attempt}")
            self.total_succeeded += 1
            del self._queue[op.op_id]
            if op.on_success:
                try:
                    cb_result = op.on_success(result)
                    if asyncio.iscoroutine(cb_result):
                        await cb_result
                except Exception as e:
                    _log(f"RetryQueue: on_success callback error for {op.op_id}: {e}")
            return

        # Still failing
        is_retryable = result.get("retryable", False)
        op.last_error = result.get("error", "unknown")

        if not is_retryable or op.attempt >= op.max_retries:
            # Exhausted or non-retryable
            reason = "non-retryable" if not is_retryable else "max retries exceeded"
            _log(f"RetryQueue: {op.op_id} exhausted ({reason}) after {op.attempt} attempt(s): {op.last_error[:100]}")
            self.total_exhausted += 1
            del self._queue[op.op_id]
            if op.on_exhausted:
                try:
                    cb_result = op.on_exhausted(op.op_id, op.last_error)
                    if asyncio.iscoroutine(cb_result):
                        await cb_result
                except Exception as e:
                    _log(f"RetryQueue: on_exhausted callback error for {op.op_id}: {e}")
            return

        # Schedule next retry with exponential backoff
        op.backoff = min(op.backoff * 2, op.max_backoff)
        op.next_retry_at = time.monotonic() + op.backoff
        _log(f"RetryQueue: {op.op_id} failed, next retry in {op.backoff:.1f}s")


# -- Singleton instance (created by operator_mcp at startup) ------------------

_QUEUE: RetryQueue | None = None


def get_retry_queue() -> RetryQueue:
    """Get or create the global retry queue."""
    global _QUEUE
    if _QUEUE is None:
        _QUEUE = RetryQueue()
    return _QUEUE
