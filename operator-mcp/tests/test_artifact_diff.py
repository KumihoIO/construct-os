"""Tests for operator.artifact_diff — file hashing, diff logic."""
from __future__ import annotations

import os

import pytest

from operator_mcp.artifact_diff import (
    _file_hash,
    _tool_call_summary,
    _error_type_summary,
    diff_artifacts,
)


class TestFileHash:
    def test_hash_small_file(self, tmp_path):
        f = tmp_path / "test.txt"
        f.write_text("hello world")
        h = _file_hash(str(f))
        assert h is not None
        assert len(h) == 16  # truncated hex

    def test_hash_large_file(self, tmp_path):
        """Verify chunked reading works for files > 64KB."""
        f = tmp_path / "large.bin"
        f.write_bytes(b"x" * 200_000)
        h = _file_hash(str(f))
        assert h is not None
        assert len(h) == 16

    def test_hash_empty_file(self, tmp_path):
        f = tmp_path / "empty.txt"
        f.write_text("")
        h = _file_hash(str(f))
        assert h is not None

    def test_hash_nonexistent_file(self):
        h = _file_hash("/nonexistent/path/file.txt")
        assert h is None

    def test_deterministic(self, tmp_path):
        f = tmp_path / "test.txt"
        f.write_text("deterministic content")
        h1 = _file_hash(str(f))
        h2 = _file_hash(str(f))
        assert h1 == h2

    def test_different_content_different_hash(self, tmp_path):
        f1 = tmp_path / "a.txt"
        f2 = tmp_path / "b.txt"
        f1.write_text("content a")
        f2.write_text("content b")
        assert _file_hash(str(f1)) != _file_hash(str(f2))


class TestToolCallSummary:
    def test_empty(self):
        assert _tool_call_summary([]) == {}

    def test_counts_by_name(self):
        calls = [
            {"tool": "Edit"},
            {"tool": "Edit"},
            {"tool": "Read"},
        ]
        summary = _tool_call_summary(calls)
        assert summary["Edit"] == 2
        assert summary["Read"] == 1

    def test_name_key_fallback(self):
        calls = [{"name": "Bash"}]
        assert _tool_call_summary(calls)["Bash"] == 1


class TestErrorTypeSummary:
    def test_empty(self):
        assert _error_type_summary([]) == []

    def test_unique_types(self):
        errors = [
            {"type": "timeout"},
            {"type": "permission"},
            {"type": "timeout"},
        ]
        result = _error_type_summary(errors)
        assert sorted(result) == ["permission", "timeout"]

    def test_code_fallback(self):
        errors = [{"code": "ENOENT"}]
        assert _error_type_summary(errors) == ["ENOENT"]


class TestDiffArtifacts:
    def _make_artifact(self, agent_id, **kwargs):
        base = {
            "agent_id": agent_id,
            "title": f"agent-{agent_id}",
            "status": "completed",
            "files_touched": [],
            "last_message": "",
            "tool_calls": [],
            "errors": [],
            "tool_call_count": 0,
            "error_count": 0,
        }
        base.update(kwargs)
        return base

    def test_identical_agents(self):
        a = self._make_artifact("a", files_touched=["f1.py"], tool_call_count=5)
        b = self._make_artifact("b", files_touched=["f1.py"], tool_call_count=5)
        diff = diff_artifacts(a, b)
        assert diff["files"]["common"] == ["f1.py"]
        assert diff["files"]["only_in_a"] == []
        assert diff["files"]["only_in_b"] == []
        assert diff["files"]["divergence"] == 0

    def test_different_files(self):
        a = self._make_artifact("a", files_touched=["f1.py", "f2.py"])
        b = self._make_artifact("b", files_touched=["f2.py", "f3.py"])
        diff = diff_artifacts(a, b)
        assert diff["files"]["common"] == ["f2.py"]
        assert diff["files"]["only_in_a"] == ["f1.py"]
        assert diff["files"]["only_in_b"] == ["f3.py"]
        assert diff["files"]["divergence"] == 2

    def test_text_similarity(self):
        a = self._make_artifact("a", last_message="The quick brown fox")
        b = self._make_artifact("b", last_message="The quick brown fox")
        diff = diff_artifacts(a, b)
        assert diff["output_similarity"] == 1.0

    def test_text_dissimilarity(self):
        a = self._make_artifact("a", last_message="hello world")
        b = self._make_artifact("b", last_message="completely different text")
        diff = diff_artifacts(a, b)
        assert diff["output_similarity"] < 0.5

    def test_tool_divergence(self):
        a = self._make_artifact("a", tool_calls=[
            {"tool": "Edit"}, {"tool": "Edit"}, {"tool": "Read"},
        ])
        b = self._make_artifact("b", tool_calls=[
            {"tool": "Edit"}, {"tool": "Bash"},
        ])
        diff = diff_artifacts(a, b)
        assert diff["tool_divergence"] is not None
        tools = {t["tool"] for t in diff["tool_divergence"]}
        assert "Edit" in tools or "Bash" in tools or "Read" in tools

    def test_error_comparison(self):
        a = self._make_artifact("a", errors=[{"type": "timeout"}], error_count=1)
        b = self._make_artifact("b", errors=[], error_count=0)
        diff = diff_artifacts(a, b)
        assert diff["error_comparison"]["a_errors"] == 1
        assert diff["error_comparison"]["b_errors"] == 0
