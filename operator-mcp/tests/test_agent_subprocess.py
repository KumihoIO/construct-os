"""Tests for operator.agent_subprocess — _build_command, compose_agent_prompt, stderr filtering."""
from __future__ import annotations

from operator_mcp.agent_subprocess import _build_command, _is_stderr_noise, compose_agent_prompt


class TestBuildCommand:
    def test_codex_command(self):
        cmd = _build_command("codex", "fix the bug")
        assert cmd[0] == "codex"
        assert "--quiet" in cmd
        assert "-a" in cmd
        assert "full-auto" in cmd
        assert "fix the bug" in cmd

    def test_claude_command(self):
        cmd = _build_command("claude", "write tests")
        assert cmd[0] == "claude"
        assert "--print" in cmd
        assert "-p" in cmd
        assert "write tests" in cmd

    def test_unknown_defaults_to_claude(self):
        cmd = _build_command("unknown-type", "hello")
        assert cmd[0] == "claude"

    def test_prompt_preserved(self):
        prompt = "This is a long prompt with special chars: $HOME && echo 'hello'"
        cmd = _build_command("claude", prompt)
        assert prompt in cmd

    def test_codex_prompt_is_last_arg(self):
        cmd = _build_command("codex", "task")
        assert cmd[-1] == "task"


class TestComposeAgentPrompt:
    def test_minimal(self):
        prompt = compose_agent_prompt("Agent1", "coder", "", [], "Fix bug")
        assert "You are Agent1, a coder agent." in prompt
        assert "## Task" in prompt
        assert "Fix bug" in prompt

    def test_with_identity(self):
        prompt = compose_agent_prompt("Agent2", "reviewer", "A meticulous reviewer", [], "Review PR")
        assert "## Identity" in prompt
        assert "A meticulous reviewer" in prompt

    def test_with_expertise(self):
        prompt = compose_agent_prompt("Agent3", "coder", "", ["rust", "typescript"], "Build API")
        assert "## Expertise" in prompt
        assert "rust, typescript" in prompt

    def test_full(self):
        prompt = compose_agent_prompt(
            "Agent4", "researcher", "Deep thinker",
            ["security", "cryptography"], "Audit the auth module",
        )
        assert "You are Agent4, a researcher agent." in prompt
        assert "## Identity" in prompt
        assert "Deep thinker" in prompt
        assert "## Expertise" in prompt
        assert "security, cryptography" in prompt
        assert "## Task" in prompt
        assert "Audit the auth module" in prompt

    def test_empty_identity_skipped(self):
        prompt = compose_agent_prompt("A", "coder", "", ["python"], "task")
        assert "## Identity" not in prompt

    def test_empty_expertise_skipped(self):
        prompt = compose_agent_prompt("A", "coder", "identity", [], "task")
        assert "## Expertise" not in prompt


class TestStderrNoiseFilter:
    def test_ev_poll_posix_is_noise(self):
        assert _is_stderr_noise("ev_poll_posix.cc: some gRPC fd warning")

    def test_grpc_warning_is_noise(self):
        assert _is_stderr_noise("grpc_chttp2_transport: warning stuff")

    def test_growthbook_is_noise(self):
        assert _is_stderr_noise("GrowthBook: feature flag loaded")

    def test_telemetry_is_noise(self):
        assert _is_stderr_noise("telemetry: sending batch")

    def test_experimental_warning_is_noise(self):
        assert _is_stderr_noise("ExperimentalWarning: something")

    def test_blank_line_is_noise(self):
        assert _is_stderr_noise("   \n")

    def test_real_error_is_not_noise(self):
        assert not _is_stderr_noise("Not logged in · Please run /login")

    def test_permission_error_is_not_noise(self):
        assert not _is_stderr_noise("Error: permission denied")

    def test_connection_refused_is_not_noise(self):
        assert not _is_stderr_noise("ConnectionRefusedError: connect ECONNREFUSED")
