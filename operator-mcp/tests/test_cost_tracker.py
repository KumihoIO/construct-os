"""Tests for operator.cost_tracker — local cost and token usage tracking."""
from __future__ import annotations

import json
import os
import tempfile

import pytest

from operator_mcp.cost_tracker import CostTracker, _UsageBucket


class TestUsageBucket:
    def test_empty(self):
        b = _UsageBucket()
        assert b.input_tokens == 0
        assert b.output_tokens == 0
        assert b.cost_usd == 0.0
        assert b.total_tokens == 0
        assert b.request_count == 0

    def test_add(self):
        b = _UsageBucket()
        b.add(100, 50, 0.005)
        assert b.input_tokens == 100
        assert b.output_tokens == 50
        assert b.total_tokens == 150
        assert b.cost_usd == 0.005
        assert b.request_count == 1

    def test_accumulates(self):
        b = _UsageBucket()
        b.add(100, 50, 0.005)
        b.add(200, 100, 0.010)
        assert b.input_tokens == 300
        assert b.output_tokens == 150
        assert b.total_tokens == 450
        assert abs(b.cost_usd - 0.015) < 1e-9
        assert b.request_count == 2

    def test_to_dict(self):
        b = _UsageBucket()
        b.add(100, 50, 0.005)
        d = b.to_dict()
        assert d["input_tokens"] == 100
        assert d["output_tokens"] == 50
        assert d["total_tokens"] == 150
        assert d["cost_usd"] == 0.005
        assert d["request_count"] == 1


class TestCostTracker:
    @pytest.fixture
    def tracker(self, tmp_path):
        path = str(tmp_path / "cost_ledger.jsonl")
        t = CostTracker(path)
        t.set_session_id("test-session")
        return t

    def test_record_and_summary(self, tracker):
        tracker.record("agent-1", input_tokens=1000, output_tokens=500, cost_usd=0.01, model="opus-4")
        summary = tracker.get_summary()
        assert summary["session_cost_usd"] == 0.01
        assert summary["session_tokens"]["input"] == 1000
        assert summary["session_tokens"]["output"] == 500
        assert summary["session_tokens"]["total"] == 1500
        assert summary["session_requests"] == 1
        assert "opus-4" in summary["by_model"]
        assert "agent-1" in summary["by_agent"]

    def test_multiple_agents(self, tracker):
        tracker.record("agent-1", input_tokens=1000, output_tokens=500, cost_usd=0.01)
        tracker.record("agent-2", input_tokens=2000, output_tokens=1000, cost_usd=0.02)
        summary = tracker.get_summary()
        assert summary["session_cost_usd"] == 0.03
        assert summary["total_tokens"] == 4500
        assert summary["request_count"] == 2
        assert len(summary["by_agent"]) == 2

    def test_by_model_accumulation(self, tracker):
        tracker.record("a1", input_tokens=100, output_tokens=50, cost_usd=0.001, model="opus-4")
        tracker.record("a2", input_tokens=200, output_tokens=100, cost_usd=0.002, model="opus-4")
        tracker.record("a3", input_tokens=50, output_tokens=25, cost_usd=0.0005, model="sonnet-4")
        summary = tracker.get_summary()
        assert summary["by_model"]["opus-4"]["request_count"] == 2
        assert summary["by_model"]["sonnet-4"]["request_count"] == 1

    def test_get_agent_usage(self, tracker):
        tracker.record("agent-1", input_tokens=1000, output_tokens=500, cost_usd=0.01)
        usage = tracker.get_agent_usage("agent-1")
        assert usage["input_tokens"] == 1000
        assert usage["cost_usd"] == 0.01

    def test_get_agent_usage_unknown(self, tracker):
        usage = tracker.get_agent_usage("nonexistent")
        assert usage["total_tokens"] == 0

    def test_record_from_usage_dict(self, tracker):
        tracker.record_from_usage_dict(
            "agent-1",
            {"inputTokens": 500, "outputTokens": 250, "totalCostUsd": 0.005},
            model="opus-4",
        )
        summary = tracker.get_summary()
        assert summary["session_tokens"]["input"] == 500
        assert summary["session_tokens"]["output"] == 250

    def test_record_from_usage_dict_none(self, tracker):
        tracker.record_from_usage_dict("agent-1", None)
        summary = tracker.get_summary()
        assert summary["session_requests"] == 0

    def test_record_from_usage_dict_snake_case(self, tracker):
        tracker.record_from_usage_dict(
            "agent-1",
            {"input_tokens": 100, "output_tokens": 50, "total_cost_usd": 0.001},
        )
        summary = tracker.get_summary()
        assert summary["session_tokens"]["input"] == 100

    def test_persistence(self, tmp_path):
        path = str(tmp_path / "ledger.jsonl")
        t1 = CostTracker(path)
        t1.set_session_id("s1")
        t1.record("a1", input_tokens=1000, output_tokens=500, cost_usd=0.01, model="opus-4")
        t1.record("a2", input_tokens=2000, output_tokens=1000, cost_usd=0.02, model="opus-4")

        # New tracker loads from same file
        t2 = CostTracker(path)
        t2.set_session_id("s2")  # new session
        summary = t2.get_summary()
        # Session is fresh (no entries for s2 yet)
        assert summary["session_requests"] == 0
        # But daily/monthly/by_model should have historical data
        assert summary["by_model"]["opus-4"]["request_count"] == 2
        assert summary["by_agent"]["a1"]["input_tokens"] == 1000

    def test_ledger_file_created(self, tracker):
        tracker.record("a1", input_tokens=100, output_tokens=50, cost_usd=0.001)
        assert os.path.exists(tracker._path)
        with open(tracker._path) as f:
            lines = f.readlines()
        assert len(lines) == 1
        entry = json.loads(lines[0])
        assert entry["agent_id"] == "a1"
        assert entry["input_tokens"] == 100

    def test_daily_tracking(self, tracker):
        tracker.record("a1", input_tokens=100, output_tokens=50, cost_usd=0.001)
        summary = tracker.get_summary()
        assert summary["daily_cost_usd"] == 0.001
        assert summary["daily_tokens"] == 150


class TestBudgetEnforcement:
    @pytest.fixture
    def tracker(self, tmp_path):
        t = CostTracker(str(tmp_path / "ledger.jsonl"))
        t.set_session_id("test")
        return t

    def test_within_budget(self, tracker):
        tracker.record("a1", cost_usd=0.50)
        result = tracker.check_budget(max_session_usd=1.0)
        assert result is None

    def test_session_budget_exceeded(self, tracker):
        tracker.record("a1", cost_usd=1.50)
        result = tracker.check_budget(max_session_usd=1.0)
        assert result is not None
        assert result["exceeded"] == "session"
        assert result["limit_usd"] == 1.0
        assert result["actual_usd"] == 1.5

    def test_daily_budget_exceeded(self, tracker):
        tracker.record("a1", cost_usd=5.0)
        result = tracker.check_budget(max_daily_usd=3.0)
        assert result is not None
        assert result["exceeded"] == "daily"

    def test_monthly_budget_exceeded(self, tracker):
        tracker.record("a1", cost_usd=100.0)
        result = tracker.check_budget(max_monthly_usd=50.0)
        assert result is not None
        assert result["exceeded"] == "monthly"

    def test_no_limits_set(self, tracker):
        tracker.record("a1", cost_usd=999.0)
        result = tracker.check_budget()
        assert result is None

    def test_session_checked_first(self, tracker):
        tracker.record("a1", cost_usd=5.0)
        result = tracker.check_budget(max_session_usd=1.0, max_daily_usd=1.0)
        assert result["exceeded"] == "session"
