"""Tests for operator_mcp.tool_handlers.skill_outcomes — step 6f-C focus
on the kref resolver that makes per-revision outcome attribution work.

The resolver runs inside ``tool_record_skill_outcome_op`` so the tests
exercise both the helper directly and the integration path that wires
its output into the metadata + ``source_revision_krefs`` fields.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest

from operator_mcp.tool_handlers import skill_outcomes
from operator_mcp.tool_handlers.skill_outcomes import (
    _resolve_to_concrete_revision_kref,
    tool_record_skill_outcome_op,
)


# ── _resolve_to_concrete_revision_kref ───────────────────────────────


class TestResolveToConcreteRevisionKref:
    def test_empty_input_returns_unchanged(self):
        assert _resolve_to_concrete_revision_kref("") == ""

    def test_no_query_returns_unchanged(self):
        kref = "kref://CognitiveMemory/Skills/foo.skilldef"
        assert _resolve_to_concrete_revision_kref(kref) == kref

    def test_concrete_revision_kref_returns_unchanged(self):
        # ?r=N is already concrete — no Kumiho call needed.
        kref = "kref://CognitiveMemory/Skills/foo.skilldef?r=3"
        assert _resolve_to_concrete_revision_kref(kref) == kref

    def test_unrelated_query_returns_unchanged(self):
        kref = "kref://CognitiveMemory/Skills/foo.skilldef?as_of=2026-01-01"
        assert _resolve_to_concrete_revision_kref(kref) == kref

    def test_resolves_published_tag_to_concrete(self):
        # The happy path: a ?t=published pointer becomes the concrete
        # revision kref returned by Kumiho.
        with patch.object(
            skill_outcomes,
            "tool_get_revision_by_tag",
            return_value={
                "revision": {
                    "kref": "kref://CognitiveMemory/Skills/foo.skilldef?r=7",
                }
            },
        ) as mock:
            resolved = _resolve_to_concrete_revision_kref(
                "kref://CognitiveMemory/Skills/foo.skilldef?t=published"
            )
            assert resolved == "kref://CognitiveMemory/Skills/foo.skilldef?r=7"
            mock.assert_called_once_with(
                "kref://CognitiveMemory/Skills/foo.skilldef", "published"
            )

    def test_resolves_arbitrary_tag(self):
        # Future-proofing: ?t=stable resolves the same way as ?t=published.
        with patch.object(
            skill_outcomes,
            "tool_get_revision_by_tag",
            return_value={
                "revision": {"kref": "kref://m/Skills/bar.skilldef?r=2"}
            },
        ) as mock:
            resolved = _resolve_to_concrete_revision_kref(
                "kref://m/Skills/bar.skilldef?t=stable"
            )
            assert resolved == "kref://m/Skills/bar.skilldef?r=2"
            mock.assert_called_once_with("kref://m/Skills/bar.skilldef", "stable")

    def test_falls_back_to_input_on_kumiho_error_response(self):
        # Tag not found / Kumiho returned an error dict — resolver
        # should NOT raise; the outcome still gets recorded with the
        # original tag-pointer kref.
        with patch.object(
            skill_outcomes,
            "tool_get_revision_by_tag",
            return_value={"error": "tag not found"},
        ):
            kref = "kref://m/Skills/foo.skilldef?t=published"
            assert _resolve_to_concrete_revision_kref(kref) == kref

    def test_falls_back_to_input_on_kumiho_exception(self):
        with patch.object(
            skill_outcomes,
            "tool_get_revision_by_tag",
            side_effect=RuntimeError("network error"),
        ):
            kref = "kref://m/Skills/foo.skilldef?t=published"
            assert _resolve_to_concrete_revision_kref(kref) == kref

    def test_falls_back_when_response_missing_revision_kref(self):
        with patch.object(
            skill_outcomes,
            "tool_get_revision_by_tag",
            return_value={"revision": {"name": "foo"}},  # no kref
        ):
            kref = "kref://m/Skills/foo.skilldef?t=published"
            assert _resolve_to_concrete_revision_kref(kref) == kref


# ── tool_record_skill_outcome_op integration ─────────────────────────


@pytest.mark.asyncio
class TestRecordSkillOutcomeUsesResolvedKref:
    """The handler must store the RESOLVED kref in metadata + source
    edge so the daemon's per-revision bucketing works.
    """

    async def test_resolves_tag_pointer_before_storing(self):
        captured: dict = {}

        def fake_store(**kwargs):
            captured.update(kwargs)
            return {"revision_kref": "kref://outcome/r/1"}

        with (
            patch.object(skill_outcomes, "_HAS_KUMIHO", True),
            patch.object(
                skill_outcomes,
                "tool_get_revision_by_tag",
                return_value={
                    "revision": {
                        "kref": "kref://m/Skills/foo.skilldef?r=4",
                    }
                },
            ),
            patch.object(skill_outcomes, "tool_memory_store", side_effect=fake_store),
        ):
            result = await tool_record_skill_outcome_op(
                {
                    "skill_name": "foo",
                    "success": True,
                    "skill_kref": "kref://m/Skills/foo.skilldef?t=published",
                }
            )

        assert "error" not in result
        # Metadata stores the resolved concrete kref.
        assert (
            captured["metadata"]["skill_kref"]
            == "kref://m/Skills/foo.skilldef?r=4"
        )
        # Original tag-pointer is preserved for audit.
        assert (
            captured["metadata"]["skill_kref_input"]
            == "kref://m/Skills/foo.skilldef?t=published"
        )
        # The graph edge points at the resolved revision so
        # source_revision_krefs survives a future tag move.
        assert captured["source_revision_krefs"] == [
            "kref://m/Skills/foo.skilldef?r=4"
        ]

    async def test_concrete_kref_passes_through_unchanged(self):
        captured: dict = {}

        def fake_store(**kwargs):
            captured.update(kwargs)
            return {"revision_kref": "kref://outcome/r/1"}

        with (
            patch.object(skill_outcomes, "_HAS_KUMIHO", True),
            patch.object(skill_outcomes, "tool_get_revision_by_tag") as mock_resolve,
            patch.object(skill_outcomes, "tool_memory_store", side_effect=fake_store),
        ):
            result = await tool_record_skill_outcome_op(
                {
                    "skill_name": "foo",
                    "success": False,
                    "skill_kref": "kref://m/Skills/foo.skilldef?r=2",
                }
            )

        assert "error" not in result
        # No Kumiho resolver call when the kref is already concrete.
        mock_resolve.assert_not_called()
        assert (
            captured["metadata"]["skill_kref"]
            == "kref://m/Skills/foo.skilldef?r=2"
        )
        # No skill_kref_input because the input matched the resolved.
        assert "skill_kref_input" not in captured["metadata"]

    async def test_resolver_failure_still_records_outcome(self):
        captured: dict = {}

        def fake_store(**kwargs):
            captured.update(kwargs)
            return {"revision_kref": "kref://outcome/r/1"}

        with (
            patch.object(skill_outcomes, "_HAS_KUMIHO", True),
            patch.object(
                skill_outcomes,
                "tool_get_revision_by_tag",
                side_effect=RuntimeError("kumiho down"),
            ),
            patch.object(skill_outcomes, "tool_memory_store", side_effect=fake_store),
        ):
            result = await tool_record_skill_outcome_op(
                {
                    "skill_name": "foo",
                    "success": True,
                    "skill_kref": "kref://m/Skills/foo.skilldef?t=published",
                }
            )

        # Outcome was still recorded — resolver failures are not fatal.
        assert "error" not in result
        # Tag-pointer falls through unchanged into metadata.
        assert (
            captured["metadata"]["skill_kref"]
            == "kref://m/Skills/foo.skilldef?t=published"
        )
        # No skill_kref_input written when resolver was a no-op.
        assert "skill_kref_input" not in captured["metadata"]
