"""Tests for operator.workflow_presets — presets, wave computation, cycle detection."""
from __future__ import annotations

import json
import os
from unittest.mock import patch

import pytest

from operator_mcp.workflow_presets import (
    WorkflowStep,
    WorkflowPreset,
    _compute_wave,
    get_all_presets,
    get_preset,
    tool_list_workflow_presets,
    tool_save_workflow_preset,
    tool_get_workflow_plan,
    _BUILTIN_PRESETS,
)


class TestWorkflowStep:
    def test_defaults(self):
        s = WorkflowStep(role="coder")
        assert s.agent_type == "codex"
        assert s.depends_on == []
        assert s.review_loop is False
        assert s.max_review_rounds == 2

    def test_to_dict(self):
        s = WorkflowStep(role="reviewer", depends_on=[0], review_loop=True)
        d = s.to_dict()
        assert d["role"] == "reviewer"
        assert d["depends_on"] == [0]
        assert d["review_loop"] is True


class TestWorkflowPreset:
    def test_to_dict(self):
        p = WorkflowPreset(
            name="test",
            description="A test preset",
            steps=[WorkflowStep(role="coder")],
            tags=["test"],
        )
        d = p.to_dict()
        assert d["name"] == "test"
        assert d["step_count"] == 1
        assert len(d["steps"]) == 1


class TestComputeWave:
    def test_no_dependencies(self):
        steps = [WorkflowStep(role="coder")]
        assert _compute_wave(0, [], steps) == 0

    def test_linear_chain(self):
        steps = [
            WorkflowStep(role="coder"),
            WorkflowStep(role="reviewer", depends_on=[0]),
        ]
        assert _compute_wave(0, steps[0].depends_on, steps) == 0
        assert _compute_wave(1, steps[1].depends_on, steps) == 1

    def test_deep_chain(self):
        steps = [
            WorkflowStep(role="researcher"),
            WorkflowStep(role="architect", depends_on=[0]),
            WorkflowStep(role="coder", depends_on=[1]),
            WorkflowStep(role="reviewer", depends_on=[2]),
        ]
        assert _compute_wave(3, steps[3].depends_on, steps) == 3

    def test_parallel_deps(self):
        steps = [
            WorkflowStep(role="researcher"),       # wave 0
            WorkflowStep(role="researcher"),       # wave 0
            WorkflowStep(role="coder", depends_on=[0, 1]),  # wave 1
        ]
        assert _compute_wave(2, steps[2].depends_on, steps) == 1

    def test_circular_dependency_breaks_cleanly(self):
        """Circular deps should not cause infinite recursion."""
        steps = [
            WorkflowStep(role="coder", depends_on=[1]),
            WorkflowStep(role="reviewer", depends_on=[0]),
        ]
        # Should not hang or raise — cycle detection breaks the loop
        w0 = _compute_wave(0, steps[0].depends_on, steps)
        w1 = _compute_wave(1, steps[1].depends_on, steps)
        assert isinstance(w0, int)
        assert isinstance(w1, int)

    def test_self_dependency(self):
        """Self-referencing dep should not hang."""
        steps = [WorkflowStep(role="coder", depends_on=[0])]
        w = _compute_wave(0, steps[0].depends_on, steps)
        assert isinstance(w, int)

    def test_memoization(self):
        """Verify cache is used across calls with shared cache dict."""
        steps = [
            WorkflowStep(role="researcher"),
            WorkflowStep(role="coder", depends_on=[0]),
            WorkflowStep(role="reviewer", depends_on=[1]),
        ]
        cache: dict[int, int] = {}
        _compute_wave(2, steps[2].depends_on, steps, _cache=cache)
        assert 0 in cache
        assert 1 in cache
        assert 2 in cache

    def test_out_of_bounds_dep_ignored(self):
        steps = [WorkflowStep(role="coder", depends_on=[99])]
        w = _compute_wave(0, steps[0].depends_on, steps)
        assert w == 0


class TestBuiltinPresets:
    def test_builtin_presets_exist(self):
        assert "code-review" in _BUILTIN_PRESETS
        assert "spec-to-impl" in _BUILTIN_PRESETS
        assert "bug-fix" in _BUILTIN_PRESETS
        assert "refactor" in _BUILTIN_PRESETS
        assert "research-only" in _BUILTIN_PRESETS

    def test_all_builtins_have_steps(self):
        for name, preset in _BUILTIN_PRESETS.items():
            assert len(preset.steps) > 0, f"{name} has no steps"
            assert preset.builtin is True

    def test_get_preset(self):
        p = get_preset("code-review")
        assert p is not None
        assert p.name == "code-review"

    def test_get_nonexistent_preset(self):
        assert get_preset("nonexistent") is None


@pytest.mark.asyncio
class TestToolListWorkflowPresets:
    async def test_list_all(self):
        result = await tool_list_workflow_presets({})
        assert result["count"] >= 5  # At least the builtins

    async def test_filter_by_tag(self):
        result = await tool_list_workflow_presets({"tag": "review"})
        assert result["count"] >= 1
        for p in result["presets"]:
            assert "review" in p["tags"]


@pytest.mark.asyncio
class TestToolSaveWorkflowPreset:
    async def test_save_requires_name(self):
        result = await tool_save_workflow_preset({"steps": [{"role": "coder"}]})
        assert "error" in result

    async def test_cannot_overwrite_builtin(self):
        result = await tool_save_workflow_preset({
            "name": "code-review",
            "steps": [{"role": "coder"}],
        })
        assert "error" in result
        assert "builtin" in result["error"].lower()

    async def test_requires_steps(self):
        result = await tool_save_workflow_preset({"name": "empty", "steps": []})
        assert "error" in result


@pytest.mark.asyncio
class TestToolGetWorkflowPlan:
    async def test_unknown_preset(self):
        result = await tool_get_workflow_plan({"preset": "nonexistent"})
        assert "error" in result
        assert "available" in result

    async def test_code_review_plan(self):
        result = await tool_get_workflow_plan({"preset": "code-review"})
        assert result["preset"] == "code-review"
        assert result["total_waves"] >= 1
        assert len(result["steps"]) == 2

    async def test_refactor_plan_has_4_waves(self):
        result = await tool_get_workflow_plan({"preset": "refactor"})
        # researcher -> architect -> coder -> reviewer = 4 waves
        assert result["total_waves"] == 4
