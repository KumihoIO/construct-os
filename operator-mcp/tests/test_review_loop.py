"""Tests for operator.review_loop — verdict parsing, prompt building."""
from __future__ import annotations

import pytest

from operator_mcp.review_loop import parse_verdict


class TestParseVerdict:
    def test_explicit_approved(self):
        assert parse_verdict("Everything looks good.\nVERDICT: APPROVED") == "approved"

    def test_explicit_needs_changes(self):
        assert parse_verdict("Several issues found.\nVERDICT: NEEDS_CHANGES") == "needs_changes"

    def test_explicit_needs_changes_space(self):
        assert parse_verdict("VERDICT: NEEDS CHANGES") == "needs_changes"

    def test_explicit_blocked(self):
        assert parse_verdict("Critical security flaw.\nVERDICT: BLOCKED") == "blocked"

    def test_case_insensitive(self):
        assert parse_verdict("verdict: approved") == "approved"
        assert parse_verdict("Verdict: Needs_Changes") == "needs_changes"

    def test_lgtm_heuristic(self):
        assert parse_verdict("Code looks clean. LGTM!") == "approved"

    def test_approve_heuristic(self):
        assert parse_verdict("I approve this change.") == "approved"

    def test_needs_changes_heuristic(self):
        assert parse_verdict("This needs changes before merging.") == "needs_changes"

    def test_requesting_changes_heuristic(self):
        assert parse_verdict("I'm requesting changes on lines 42-50.") == "needs_changes"

    def test_empty_text(self):
        assert parse_verdict("") == "unclear"

    def test_no_verdict(self):
        assert parse_verdict("Here is my review of the code.") == "unclear"

    def test_explicit_takes_priority(self):
        """Explicit VERDICT: line should override heuristic matches."""
        text = "Code LGTM but needs minor fix.\nVERDICT: NEEDS_CHANGES"
        assert parse_verdict(text) == "needs_changes"

    def test_approved_explicit_over_needs_changes_heuristic(self):
        text = "The requested changes have been addressed.\nVERDICT: APPROVED"
        assert parse_verdict(text) == "approved"

    def test_multiline_review(self):
        text = """
## Code Review

### Issues Found
1. Missing null check on line 42
2. Unused import on line 5
3. Test coverage insufficient

### Summary
The code has several issues that need to be addressed.

VERDICT: NEEDS_CHANGES
"""
        assert parse_verdict(text) == "needs_changes"
