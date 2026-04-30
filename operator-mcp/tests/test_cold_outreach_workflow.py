"""Tests for the cold-outreach builtin workflow.

This pins the YAML against the schema so a future schema change that
breaks the cold-outreach demo is caught immediately, not at first
demo run. Pure structural tests — no SMTP, no agents, no live
execution. The end-to-end run path is exercised manually for the demo.
"""
from __future__ import annotations

import os

import pytest

from operator_mcp.workflow.loader import load_workflow_from_yaml
from operator_mcp.workflow.schema import StepType


_WORKFLOW_PATH = os.path.join(
    os.path.dirname(__file__),
    "..",
    "operator_mcp",
    "workflow",
    "builtins",
    "cold-outreach.yaml",
)


@pytest.fixture(scope="module")
def workflow():
    """Parse the YAML once per test module — Pydantic validation runs
    inside the loader, so a schema break shows up here as a failed
    fixture rather than a noisy test rerun."""
    return load_workflow_from_yaml(_WORKFLOW_PATH)


class TestStructure:
    """The workflow has the steps and dependencies the demo expects."""

    def test_loads_without_errors(self, workflow):
        assert workflow.name == "cold-outreach"
        assert "outreach" in workflow.tags

    def test_has_required_inputs(self, workflow):
        """leads_json must be required — sending into a malformed list
        silently is the worst-case outcome we want to avoid."""
        names = {i.name for i in workflow.inputs}
        assert "leads_json" in names
        leads_input = next(i for i in workflow.inputs if i.name == "leads_json")
        assert leads_input.required is True

    def test_step_ids(self, workflow):
        ids = {s.id for s in workflow.steps}
        assert ids == {
            "parse_leads",
            "outreach_loop",
            "extract_lead",
            "personalize",
            "send_email",
        }

    def test_dependency_chain(self, workflow):
        """outreach_loop runs after parse_leads. Inside the loop:
        extract_lead → personalize → send_email, in that order."""
        by_id = {s.id: s for s in workflow.steps}
        assert by_id["outreach_loop"].depends_on == ["parse_leads"]
        # personalize and send_email declare their iteration-internal
        # dependencies — the for_each executor walks them in order.
        assert "extract_lead" in by_id["personalize"].depends_on
        assert "personalize" in by_id["send_email"].depends_on


class TestForEach:
    def test_loops_over_lead_indices(self, workflow):
        """The for_each iterates `0..N-1` (interpolated from
        parse_leads.output_data.count_minus_one). Must reference each
        of the three sub-steps inline so the executor knows which
        steps are loop-bodies."""
        loop = next(s for s in workflow.steps if s.id == "outreach_loop")
        assert loop.type == StepType.FOR_EACH
        cfg = loop.for_each
        assert cfg is not None
        assert cfg.range == "0..${parse_leads.output_data.count_minus_one}"
        assert cfg.variable == "idx"
        assert cfg.steps == ["extract_lead", "personalize", "send_email"]
        # fail_fast=False so one bad lead doesn't kill the campaign.
        assert cfg.fail_fast is False


class TestEmailStep:
    """The send step must default to dry_run=true so the demo can't
    accidentally blast unreviewed copy."""

    def test_send_email_defaults_to_dry_run(self, workflow):
        send = next(s for s in workflow.steps if s.id == "send_email")
        assert send.type == StepType.EMAIL
        cfg = send.email
        assert cfg is not None
        assert cfg.dry_run is True, (
            "cold-outreach.yaml MUST default to dry_run=true so users "
            "always see a preview before any actual SMTP send. Don't "
            "remove this without a deliberate, documented decision."
        )

    def test_send_email_has_click_tracking_enabled(self, workflow):
        send = next(s for s in workflow.steps if s.id == "send_email")
        cfg = send.email
        assert cfg.track_clicks is True
        # Per-send kref must include both run_id and the loop index so
        # downstream click events join back to a unique send revision.
        assert "${run_id}" in cfg.track_kref
        assert "${for_each.idx}" in cfg.track_kref

    def test_send_email_interpolates_lead_fields(self, workflow):
        send = next(s for s in workflow.steps if s.id == "send_email")
        cfg = send.email
        # to/subject/body all pull from earlier steps — typo or schema
        # rename here breaks the demo at runtime, this catches it.
        assert cfg.to == "${extract_lead.output_data.contact_email}"
        assert cfg.subject == "${personalize.output_data.subject}"
        assert cfg.body == "${personalize.output_data.body}"


class TestPersonalize:
    def test_codex_writer_with_tight_constraints(self, workflow):
        """The personalize step is Codex (faster + cheaper than Claude
        for short generation under tight token budgets) with max_turns=1
        and tools=none — pure generation, no tool loops."""
        step = next(s for s in workflow.steps if s.id == "personalize")
        assert step.type == StepType.AGENT
        cfg = step.agent
        assert cfg.agent_type == "codex"
        assert cfg.max_turns == 1
        assert cfg.tools == "none"
        assert "subject" in cfg.output_fields
        assert "body" in cfg.output_fields

    def test_prompt_includes_anti_ai_tells(self, workflow):
        """The prompt explicitly bans the words readers use to spot AI
        cold email. If the constraint goes missing the demo's value
        prop ('feels hand-written') breaks."""
        step = next(s for s in workflow.steps if s.id == "personalize")
        prompt = step.agent.prompt
        for banned in ["AI", "automation", "personalize", "outreach"]:
            assert banned in prompt, (
                f"prompt must list '{banned}' as a banned word — "
                "removing it weakens the 'doesn't look AI-written' guarantee"
            )


class TestPythonSteps:
    """parse_leads and extract_lead are Python steps. Both must use
    `code:` (inline) rather than `script:` so the workflow ships
    self-contained without a separate file dependency."""

    def test_parse_leads_is_inline_python(self, workflow):
        step = next(s for s in workflow.steps if s.id == "parse_leads")
        assert step.type == StepType.PYTHON
        cfg = step.python
        assert cfg.script is None
        assert cfg.code is not None
        assert "leads_json" in cfg.code

    def test_extract_lead_passes_idx(self, workflow):
        """The for_each variable `idx` arrives as a stringified int.
        extract_lead must receive it via args so the python step's
        stdin payload has it."""
        step = next(s for s in workflow.steps if s.id == "extract_lead")
        cfg = step.python
        assert cfg.args == {"idx": "${for_each.idx}"}
