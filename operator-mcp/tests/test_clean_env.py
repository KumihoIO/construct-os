"""Tests for operator.clean_env — environment sanitization."""
from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from operator_mcp.clean_env import (
    build_agent_env,
    build_sidecar_env_config,
    clean_build_caches,
    _ALLOWED_KEYS,
    _BLOCKED_KEYS,
    _DANGEROUS_KEYS,
)


class TestBuildAgentEnv:
    def test_sets_node_env(self):
        env = build_agent_env()
        assert env["NODE_ENV"] == "development"

    def test_custom_node_env(self):
        env = build_agent_env(node_env="production")
        assert env["NODE_ENV"] == "production"

    def test_blocked_keys_excluded_permissive(self):
        with patch.dict(os.environ, {"DEBUG": "1", "CI": "true", "NODE_OPTIONS": "--max-old-space-size=4096"}):
            env = build_agent_env(clean_build=False)
            assert "DEBUG" not in env
            assert "CI" not in env
            assert "NODE_OPTIONS" not in env

    def test_clean_build_allowlist(self):
        with patch.dict(os.environ, {"PATH": "/usr/bin", "DEBUG": "1", "RANDOM_VAR": "x"}, clear=True):
            env = build_agent_env(clean_build=True)
            assert "PATH" in env
            assert "DEBUG" not in env
            assert "RANDOM_VAR" not in env

    def test_auth_keys_forwarded_in_clean_build(self):
        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "sk-test", "PATH": "/usr/bin"}, clear=True):
            env = build_agent_env(clean_build=True)
            assert env.get("ANTHROPIC_API_KEY") == "sk-test"

    def test_extra_vars_applied(self):
        env = build_agent_env(extra={"MY_VAR": "hello"})
        assert env["MY_VAR"] == "hello"

    def test_dangerous_keys_blocked_in_extra(self):
        env = build_agent_env(extra={
            "LD_PRELOAD": "/evil.so",
            "DYLD_INSERT_LIBRARIES": "/evil.dylib",
            "SAFE_VAR": "ok",
        })
        assert "LD_PRELOAD" not in env
        assert "DYLD_INSERT_LIBRARIES" not in env
        assert env["SAFE_VAR"] == "ok"

    def test_all_dangerous_keys_blocked(self):
        # Use a controlled os.environ so inherited DYLD_* vars don't leak through
        clean_os_env = {"PATH": "/usr/bin", "HOME": "/tmp"}
        extra = {k: "bad" for k in _DANGEROUS_KEYS}
        extra["GOOD_KEY"] = "good"
        with patch.dict(os.environ, clean_os_env, clear=True):
            env = build_agent_env(extra=extra)
        for k in _DANGEROUS_KEYS:
            assert k not in env, f"{k} should be blocked"
        assert env["GOOD_KEY"] == "good"


class TestBuildSidecarEnvConfig:
    def test_sets_node_env(self):
        overrides = build_sidecar_env_config()
        assert overrides["NODE_ENV"] == "development"

    def test_clean_build_unsets_blocked(self):
        overrides = build_sidecar_env_config(clean_build=True)
        # Blocked keys should be set to empty string (unset)
        for key in _BLOCKED_KEYS:
            if key != "NODE_ENV":
                assert overrides.get(key) == "", f"{key} should be empty in clean_build"

    def test_dangerous_keys_blocked_in_extra(self):
        overrides = build_sidecar_env_config(extra={
            "LD_PRELOAD": "/evil.so",
            "PYTHONPATH": "/evil",
            "MY_VAR": "ok",
        })
        assert "LD_PRELOAD" not in overrides
        assert "PYTHONPATH" not in overrides
        assert overrides["MY_VAR"] == "ok"


class TestCleanBuildCaches:
    def test_removes_cache_dirs(self, tmp_path):
        (tmp_path / ".next").mkdir()
        (tmp_path / ".turbo").mkdir()
        (tmp_path / "node_modules" / ".cache").mkdir(parents=True)
        removed = clean_build_caches(str(tmp_path))
        assert len(removed) == 3
        assert not (tmp_path / ".next").exists()
        assert not (tmp_path / ".turbo").exists()

    def test_dry_run(self, tmp_path):
        (tmp_path / ".next").mkdir()
        removed = clean_build_caches(str(tmp_path), dry_run=True)
        assert len(removed) == 1
        assert (tmp_path / ".next").exists()  # Not removed

    def test_no_caches_to_clean(self, tmp_path):
        removed = clean_build_caches(str(tmp_path))
        assert removed == []


class TestDangerousKeysCompleteness:
    """Verify the dangerous keys list covers known attack vectors."""

    def test_ld_preload_variants(self):
        assert "LD_PRELOAD" in _DANGEROUS_KEYS
        assert "LD_LIBRARY_PATH" in _DANGEROUS_KEYS

    def test_dyld_variants(self):
        assert "DYLD_INSERT_LIBRARIES" in _DANGEROUS_KEYS
        assert "DYLD_LIBRARY_PATH" in _DANGEROUS_KEYS

    def test_interpreter_paths(self):
        assert "PYTHONPATH" in _DANGEROUS_KEYS
        assert "NODE_OPTIONS" in _DANGEROUS_KEYS

    def test_shell_injection(self):
        assert "BASH_ENV" in _DANGEROUS_KEYS
        assert "PROMPT_COMMAND" in _DANGEROUS_KEYS
