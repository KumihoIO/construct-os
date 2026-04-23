"""Local cost and token usage tracker — accumulates usage from all agents.

Works independently of the external gateway. Provides per-agent, per-session,
and rolling daily/monthly aggregates.  Persists to a JSONL file so usage
survives daemon restarts.
"""
from __future__ import annotations

import json as _json
import os
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from ._log import _log


class CostTracker:
    """In-process cost accumulator with disk persistence."""

    def __init__(self, path: str | None = None) -> None:
        self._path = path or os.path.expanduser(
            "~/.construct/operator_mcp/cost_ledger.jsonl"
        )
        os.makedirs(os.path.dirname(self._path), exist_ok=True)
        self._session_id: str = ""

        # In-memory accumulators (rebuilt from ledger on load)
        self._session: _UsageBucket = _UsageBucket()
        self._by_agent: dict[str, _UsageBucket] = defaultdict(_UsageBucket)
        self._by_model: dict[str, _UsageBucket] = defaultdict(_UsageBucket)
        self._daily: dict[str, _UsageBucket] = defaultdict(_UsageBucket)   # key: YYYY-MM-DD
        self._monthly: dict[str, _UsageBucket] = defaultdict(_UsageBucket)  # key: YYYY-MM

        # Dedup: track (agent_id, token_count) of last entry to prevent
        # duplicate writes from multiple operator processes seeing the
        # same sidecar event.
        self._last_entry: tuple[str, int, int] = ("", 0, 0)  # (agent_id, in_tok, out_tok)

        self._load_ledger()
        _log(f"CostTracker: ledger at {self._path}")

    def set_session_id(self, session_id: str) -> None:
        """Called at startup to tag this session's entries."""
        self._session_id = session_id
        self._session = _UsageBucket()  # reset session accumulator

    # -- Recording usage -------------------------------------------------------

    def record(
        self,
        agent_id: str,
        input_tokens: int = 0,
        output_tokens: int = 0,
        cost_usd: float = 0.0,
        model: str = "",
        agent_title: str = "",
    ) -> None:
        """Record a usage entry from an agent turn completion."""
        # Dedup: if this exact (agent, in_tokens, out_tokens) was just
        # recorded, skip.  Multiple operator processes see the same
        # sidecar event and all try to write — this catches the duplicate.
        entry_key = (agent_id, input_tokens, output_tokens)
        if entry_key == self._last_entry:
            return
        self._last_entry = entry_key

        now = datetime.now(timezone.utc)
        day_key = now.strftime("%Y-%m-%d")
        month_key = now.strftime("%Y-%m")

        entry = {
            "ts": now.isoformat(),
            "session": self._session_id,
            "agent_id": agent_id,
            "agent_title": agent_title,
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost_usd": cost_usd,
        }

        # Persist to ledger
        try:
            with open(self._path, "a") as f:
                f.write(_json.dumps(entry, default=str) + "\n")
        except Exception as e:
            _log(f"CostTracker: write error: {e}")

        # Update in-memory accumulators
        self._session.add(input_tokens, output_tokens, cost_usd)
        self._by_agent[agent_id].add(input_tokens, output_tokens, cost_usd)
        if model:
            self._by_model[model].add(input_tokens, output_tokens, cost_usd)
        self._daily[day_key].add(input_tokens, output_tokens, cost_usd)
        self._monthly[month_key].add(input_tokens, output_tokens, cost_usd)

    def record_from_usage_dict(
        self,
        agent_id: str,
        usage: dict[str, Any] | None,
        model: str = "",
        agent_title: str = "",
    ) -> None:
        """Record usage from a sidecar usage dict (inputTokens, outputTokens, totalCostUsd)."""
        if not usage:
            return
        self.record(
            agent_id=agent_id,
            input_tokens=usage.get("inputTokens", usage.get("input_tokens", 0)) or 0,
            output_tokens=usage.get("outputTokens", usage.get("output_tokens", 0)) or 0,
            cost_usd=usage.get("totalCostUsd", usage.get("total_cost_usd", 0.0)) or 0.0,
            model=model,
            agent_title=agent_title,
        )

    # -- Querying usage --------------------------------------------------------

    def get_summary(self) -> dict[str, Any]:
        """Get full cost summary — session, daily, monthly, by-model, by-agent."""
        now = datetime.now(timezone.utc)
        day_key = now.strftime("%Y-%m-%d")
        month_key = now.strftime("%Y-%m")

        today = self._daily.get(day_key, _UsageBucket())
        this_month = self._monthly.get(month_key, _UsageBucket())

        return {
            "session_cost_usd": round(self._session.cost_usd, 6),
            "session_tokens": {
                "input": self._session.input_tokens,
                "output": self._session.output_tokens,
                "total": self._session.total_tokens,
            },
            "session_requests": self._session.request_count,
            "daily_cost_usd": round(today.cost_usd, 6),
            "daily_tokens": today.total_tokens,
            "monthly_cost_usd": round(this_month.cost_usd, 6),
            "monthly_tokens": this_month.total_tokens,
            "total_tokens": self._session.total_tokens,
            "request_count": self._session.request_count,
            "by_model": {
                model: bucket.to_dict()
                for model, bucket in self._by_model.items()
                if bucket.request_count > 0
            },
            "by_agent": {
                aid: bucket.to_dict()
                for aid, bucket in self._by_agent.items()
                if bucket.request_count > 0
            },
        }

    def get_agent_usage(self, agent_id: str) -> dict[str, Any]:
        """Get usage for a specific agent."""
        bucket = self._by_agent.get(agent_id, _UsageBucket())
        return bucket.to_dict()

    # -- Budget enforcement ----------------------------------------------------

    def check_budget(
        self,
        max_session_usd: float | None = None,
        max_daily_usd: float | None = None,
        max_monthly_usd: float | None = None,
    ) -> dict[str, Any] | None:
        """Check if any budget limit is exceeded. Returns None if within budget."""
        now = datetime.now(timezone.utc)
        day_key = now.strftime("%Y-%m-%d")
        month_key = now.strftime("%Y-%m")

        if max_session_usd and self._session.cost_usd >= max_session_usd:
            return {
                "exceeded": "session",
                "limit_usd": max_session_usd,
                "actual_usd": round(self._session.cost_usd, 6),
            }
        if max_daily_usd:
            today = self._daily.get(day_key, _UsageBucket())
            if today.cost_usd >= max_daily_usd:
                return {
                    "exceeded": "daily",
                    "limit_usd": max_daily_usd,
                    "actual_usd": round(today.cost_usd, 6),
                }
        if max_monthly_usd:
            this_month = self._monthly.get(month_key, _UsageBucket())
            if this_month.cost_usd >= max_monthly_usd:
                return {
                    "exceeded": "monthly",
                    "limit_usd": max_monthly_usd,
                    "actual_usd": round(this_month.cost_usd, 6),
                }
        return None

    # -- Ledger reload ---------------------------------------------------------

    def _load_ledger(self) -> None:
        """Rebuild in-memory accumulators from the ledger file."""
        if not os.path.exists(self._path):
            return
        count = 0
        try:
            with open(self._path, "r") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = _json.loads(line)
                    except _json.JSONDecodeError:
                        continue

                    input_t = entry.get("input_tokens", 0) or 0
                    output_t = entry.get("output_tokens", 0) or 0
                    cost = entry.get("cost_usd", 0.0) or 0.0
                    agent_id = entry.get("agent_id", "")
                    model = entry.get("model", "")
                    ts = entry.get("ts", "")

                    self._by_agent[agent_id].add(input_t, output_t, cost)
                    if model:
                        self._by_model[model].add(input_t, output_t, cost)

                    # Parse date for daily/monthly
                    if ts and len(ts) >= 10:
                        day_key = ts[:10]
                        month_key = ts[:7]
                        self._daily[day_key].add(input_t, output_t, cost)
                        self._monthly[month_key].add(input_t, output_t, cost)

                    count += 1
        except Exception as e:
            _log(f"CostTracker: ledger load error: {e}")

        if count:
            _log(f"CostTracker: loaded {count} entries from ledger")


class _UsageBucket:
    """Simple accumulator for tokens and cost."""

    __slots__ = ("input_tokens", "output_tokens", "cost_usd", "request_count")

    def __init__(self) -> None:
        self.input_tokens: int = 0
        self.output_tokens: int = 0
        self.cost_usd: float = 0.0
        self.request_count: int = 0

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens

    def add(self, input_tokens: int, output_tokens: int, cost_usd: float) -> None:
        self.input_tokens += input_tokens
        self.output_tokens += output_tokens
        self.cost_usd += cost_usd
        self.request_count += 1

    def to_dict(self) -> dict[str, Any]:
        return {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.total_tokens,
            "cost_usd": round(self.cost_usd, 6),
            "request_count": self.request_count,
        }
