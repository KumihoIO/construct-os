"""Tests for the consolidated `record_agent_outcome` flow.

Until v2026.5.4 there were two tools registered under this name:
  - the older trust-scoring tool (agent_id, outcome, task_summary)
  - the newer session-outcome tool (session_id, title, kind, content...)

Their dispatch entries clashed: MCP can't dedup tool names, so the LLM
client saw one schema while the operator's `if name == ...` chain fired
whichever branch came first. Result: every orchestration run silently
failed to record outcomes / update trust because the args never matched
the handler that actually ran.

The fix folds trust scoring INTO the outcomes handler. Callers pass
optional `template_name` + `status` to update the rolling trust score in
`/<harness>/AgentTrust/<template>` alongside the per-session outcome.
These tests pin both paths so the regression doesn't return.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from operator_mcp.tool_handlers import outcomes as outcomes_mod


pytestmark = pytest.mark.asyncio


@pytest.fixture
def mock_kumiho_store():
    """Patch the kumiho memory_store the outcome handler calls."""
    with patch.object(outcomes_mod, "_HAS_KUMIHO", True), \
         patch.object(
             outcomes_mod,
             "tool_memory_store",
             return_value={"revision_kref": "kref://test/Sessions/sess-1/Outcomes/title.outcome?r=1"},
         ) as mock:
        yield mock


@pytest.fixture
def mock_pool_client():
    """Mock pool_client with the surface update_agent_trust uses."""
    pc = AsyncMock()
    pc._available = True
    pc.ensure_space = AsyncMock(return_value=None)
    pc.list_items = AsyncMock(return_value=[])
    pc.create_item = AsyncMock(return_value={"kref": "kref://test/AgentTrust/template-x.trust_record"})
    pc.create_revision = AsyncMock(return_value=None)
    pc.get_latest_revision = AsyncMock(return_value=None)
    return pc


# ── Outcome-only path (no trust update) ──────────────────────────────


class TestOutcomeOnly:
    """When the caller doesn't pass trust fields, only the outcome is stored."""

    async def test_records_outcome_no_trust(self, mock_kumiho_store, mock_pool_client):
        result = await outcomes_mod.tool_record_agent_outcome_op(
            {
                "session_id": "sess-1",
                "title": "Discovered slow query on Apr 30",
                "content": "EXPLAIN shows seq scan on users.email",
                "kind": "discovery",
            },
            mock_pool_client,
        )

        assert "error" not in result
        assert result["session_id"] == "sess-1"
        assert result["kind"] == "discovery"
        assert result["kref"] == "kref://test/Sessions/sess-1/Outcomes/title.outcome?r=1"
        # No trust fields → no trust update fired → no trust key in response
        assert "trust" not in result
        # And pool_client was never touched
        mock_pool_client.list_items.assert_not_called()
        mock_pool_client.create_item.assert_not_called()

    async def test_missing_session_id_rejects(self, mock_kumiho_store, mock_pool_client):
        result = await outcomes_mod.tool_record_agent_outcome_op(
            {"title": "x"}, mock_pool_client
        )
        assert result == {"error": "session_id is required"}

    async def test_missing_title_rejects(self, mock_kumiho_store, mock_pool_client):
        result = await outcomes_mod.tool_record_agent_outcome_op(
            {"session_id": "sess-1"}, mock_pool_client
        )
        assert result == {"error": "title is required"}

    async def test_pool_client_omitted_still_works(self, mock_kumiho_store):
        # Backward compatibility: the handler signature defaulted pool_client
        # to None for callers that don't have one in scope (tests, batch
        # tools, etc.). Outcome storage must still succeed.
        result = await outcomes_mod.tool_record_agent_outcome_op(
            {"session_id": "sess-1", "title": "T"}
        )
        assert result["session_id"] == "sess-1"
        assert "trust" not in result

    async def test_partial_trust_fields_skip_update(
        self, mock_kumiho_store, mock_pool_client
    ):
        # template_name without status → don't update trust (status is the
        # signal that this is a run-outcome vs a generic discovery).
        result = await outcomes_mod.tool_record_agent_outcome_op(
            {
                "session_id": "sess-1",
                "title": "T",
                "template_name": "rust-coder",
                # status missing
            },
            mock_pool_client,
        )
        assert "trust" not in result
        mock_pool_client.list_items.assert_not_called()

    async def test_status_without_template_skips_update(
        self, mock_kumiho_store, mock_pool_client
    ):
        # status alone isn't enough — without a template_name we'd have
        # nothing to anchor the trust record on.
        result = await outcomes_mod.tool_record_agent_outcome_op(
            {
                "session_id": "sess-1",
                "title": "T",
                "status": "success",
            },
            mock_pool_client,
        )
        assert "trust" not in result
        mock_pool_client.list_items.assert_not_called()

    async def test_unknown_status_skips_update(
        self, mock_kumiho_store, mock_pool_client
    ):
        result = await outcomes_mod.tool_record_agent_outcome_op(
            {
                "session_id": "sess-1",
                "title": "T",
                "template_name": "rust-coder",
                "status": "kinda-good",  # not in the success/partial/failed enum
            },
            mock_pool_client,
        )
        assert "trust" not in result


# ── Outcome + trust update ───────────────────────────────────────────


class TestOutcomeWithTrust:
    """Caller passes template_name + status → trust score updates too."""

    async def test_creates_new_trust_record(
        self, mock_kumiho_store, mock_pool_client
    ):
        # No existing items → create_item path. After this run the agent's
        # trust_score should equal the success weight (1.0).
        result = await outcomes_mod.tool_record_agent_outcome_op(
            {
                "session_id": "sess-1",
                "title": "Closed bug #123",
                "template_name": "rust-coder",
                "status": "success",
                "agent_id": "agent-uuid-1",
            },
            mock_pool_client,
        )

        assert "trust" in result
        trust = result["trust"]
        assert trust["recorded"] is True
        assert trust["template_name"] == "rust-coder"
        assert trust["trust_score"] == 1.0
        assert trust["total_runs"] == 1

        mock_pool_client.ensure_space.assert_called_once()
        mock_pool_client.create_item.assert_called_once()
        mock_pool_client.create_revision.assert_called_once()

    async def test_updates_existing_trust_record(self, mock_kumiho_store):
        # Existing template with 4 successes (4.0/4 = 1.0). One partial
        # (0.5) lands → 4.5/5 = 0.9 trust score.
        pc = AsyncMock()
        pc._available = True
        pc.ensure_space = AsyncMock(return_value=None)
        pc.list_items = AsyncMock(
            return_value=[
                {"item_name": "rust-coder", "kref": "kref://test/AgentTrust/rust-coder.trust_record"},
            ]
        )
        pc.get_latest_revision = AsyncMock(
            return_value={
                "metadata": {
                    "total_runs": 4,
                    "total_score": 4.0,
                    "trust_score": 1.0,
                    "recent_outcomes": "success:t1:2026-04-29|success:t2:2026-04-29",
                }
            }
        )
        pc.create_revision = AsyncMock(return_value=None)

        result = await outcomes_mod.tool_record_agent_outcome_op(
            {
                "session_id": "sess-1",
                "title": "Half-fixed bug",
                "template_name": "rust-coder",
                "status": "partial",
            },
            pc,
        )

        trust = result["trust"]
        assert trust["total_runs"] == 5
        assert trust["trust_score"] == 0.9  # 4.5 / 5

        # Critical: didn't try to create a new item — used the existing kref.
        pc.create_item.assert_not_called()
        pc.create_revision.assert_called_once()

    async def test_trust_failure_does_not_block_outcome(
        self, mock_kumiho_store, mock_pool_client
    ):
        # Trust update raises an error → outcome record still succeeds and
        # the trust failure surfaces as a soft warning in response["trust"].
        # This is the load-bearing invariant: an unreachable AgentTrust
        # space (e.g. transient kumiho hiccup) must not lose the outcome.
        mock_pool_client.list_items = AsyncMock(side_effect=RuntimeError("kumiho down"))

        result = await outcomes_mod.tool_record_agent_outcome_op(
            {
                "session_id": "sess-1",
                "title": "T",
                "template_name": "rust-coder",
                "status": "success",
            },
            mock_pool_client,
        )

        # Outcome itself succeeded
        assert "error" not in result
        assert result["kref"] == "kref://test/Sessions/sess-1/Outcomes/title.outcome?r=1"
        # Trust failed soft
        assert "error" in result["trust"]

    async def test_status_appears_in_metadata_and_tags(
        self, mock_kumiho_store, mock_pool_client
    ):
        # Independent of trust: status + template should also be indexed
        # in the outcome's metadata/tags so engage-style searches can
        # filter by "show me all failed runs of rust-coder".
        await outcomes_mod.tool_record_agent_outcome_op(
            {
                "session_id": "sess-1",
                "title": "T",
                "template_name": "rust-coder",
                "status": "failed",
            },
            mock_pool_client,
        )

        kwargs = mock_kumiho_store.call_args.kwargs
        assert kwargs["metadata"]["template_name"] == "rust-coder"
        assert kwargs["metadata"]["status"] == "failed"
        assert "status:failed" in kwargs["tags"]
        assert "template:rust-coder" in kwargs["tags"]


# ── No-kumiho fallback ───────────────────────────────────────────────


class TestKumihoUnavailable:
    """If kumiho isn't installed at all, the tool returns a clear error."""

    async def test_returns_unavailable_error(self):
        with patch.object(outcomes_mod, "_HAS_KUMIHO", False):
            result = await outcomes_mod.tool_record_agent_outcome_op(
                {"session_id": "sess-1", "title": "T"}
            )
            assert "error" in result
            assert "kumiho" in result["error"].lower()
