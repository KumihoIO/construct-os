"""Tests for operator.tool_handlers.skills — skill tool handlers."""
from __future__ import annotations

from unittest.mock import patch

import pytest

from operator_mcp.tool_handlers.skills import tool_list_skills, tool_load_skill


@pytest.mark.asyncio
class TestToolListSkills:
    async def test_returns_skills(self, skills_dir):
        with patch("operator_mcp.tool_handlers.skills.list_skills", return_value=[
            {"name": "operator-loop", "title": "Loop Skill", "path": "/skills/operator-loop.md"},
        ]):
            result = await tool_list_skills()
            assert result["count"] == 1
            assert result["skills"][0]["name"] == "operator-loop"

    async def test_empty(self):
        with patch("operator_mcp.tool_handlers.skills.list_skills", return_value=[]):
            result = await tool_list_skills()
            assert result["count"] == 0


@pytest.mark.asyncio
class TestToolLoadSkill:
    async def test_found(self):
        with patch("operator_mcp.tool_handlers.skills.load_skill", return_value="# Skill Content"):
            result = await tool_load_skill({"name": "operator-chat"})
            assert result["name"] == "operator-chat"
            assert result["content"] == "# Skill Content"

    async def test_not_found(self):
        with patch("operator_mcp.tool_handlers.skills.load_skill", return_value=None):
            result = await tool_load_skill({"name": "nonexistent"})
            assert "error" in result
            assert "not found" in result["error"]
