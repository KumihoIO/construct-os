"""Tests for operator.tool_handlers.pool — agent pool tool handlers."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from operator_mcp.agent_state import AgentPool, AgentTemplate
from operator_mcp.tool_handlers.pool import (
    _template_to_dict,
    tool_list_agent_templates,
    tool_save_agent_template,
    tool_search_agent_pool,
)


# ---------------------------------------------------------------------------
# _template_to_dict (pure function)
# ---------------------------------------------------------------------------

class TestTemplateToDict:
    def test_conversion(self):
        t = AgentTemplate(
            name="test", agent_type="claude", role="coder",
            capabilities=["python", "rust"], description="Test agent",
            use_count=3,
        )
        d = _template_to_dict(t)
        assert d == {
            "name": "test",
            "agent_type": "claude",
            "role": "coder",
            "capabilities": ["python", "rust"],
            "description": "Test agent",
            "use_count": 3,
        }

    def test_does_not_include_extra_fields(self):
        t = AgentTemplate(
            name="x", agent_type="codex", role="reviewer",
            capabilities=[], description="X",
            identity="secret identity", soul="brave",
        )
        d = _template_to_dict(t)
        assert "identity" not in d
        assert "soul" not in d


# ---------------------------------------------------------------------------
# tool_search_agent_pool
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestSearchAgentPool:
    async def test_local_only(self, pool_path, mock_pool_client):
        pool = AgentPool(pool_path)
        pool.add(AgentTemplate(name="rust-dev", agent_type="codex", role="coder", capabilities=["rust"], description="Rust"))
        with patch("operator.tool_handlers.pool.POOL", pool):
            result = await tool_search_agent_pool({"query": "rust"}, mock_pool_client)
            assert result["count"] == 1
            assert result["matches"][0]["name"] == "rust-dev"

    async def test_deduplication(self, pool_path, mock_pool_client):
        pool = AgentPool(pool_path)
        pool.add(AgentTemplate(name="shared", agent_type="claude", role="coder", capabilities=[], description="Shared"))
        mock_pool_client.search_agents = AsyncMock(return_value=[{"item_name": "shared"}])
        with patch("operator.tool_handlers.pool.POOL", pool):
            result = await tool_search_agent_pool({"query": "shared"}, mock_pool_client)
            assert result["count"] == 1  # not duplicated


# ---------------------------------------------------------------------------
# tool_save_agent_template
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestSaveAgentTemplate:
    async def test_save_new(self, pool_path, mock_pool_client):
        pool = AgentPool(pool_path)
        with patch("operator.tool_handlers.pool.POOL", pool):
            result = await tool_save_agent_template({
                "name": "new-agent",
                "agent_type": "claude",
                "role": "coder",
                "capabilities": ["python"],
                "description": "Python coder",
            }, mock_pool_client)
            assert result["saved"] is True
            assert result["is_update"] is False

    async def test_update_existing(self, pool_path, mock_pool_client):
        pool = AgentPool(pool_path)
        pool.add(AgentTemplate(name="existing", agent_type="claude", role="coder", capabilities=[], description="Old"))
        with patch("operator.tool_handlers.pool.POOL", pool):
            result = await tool_save_agent_template({
                "name": "existing",
                "agent_type": "claude",
                "role": "coder",
                "capabilities": ["updated"],
                "description": "New",
            }, mock_pool_client)
            assert result["saved"] is True
            assert result["is_update"] is True

    async def test_invalid_agent_type(self, pool_path, mock_pool_client):
        pool = AgentPool(pool_path)
        with patch("operator.tool_handlers.pool.POOL", pool):
            result = await tool_save_agent_template({
                "name": "bad",
                "agent_type": "gpt4",
                "role": "coder",
                "capabilities": [],
                "description": "Bad",
            }, mock_pool_client)
            assert "error" in result

    async def test_invalid_role(self, pool_path, mock_pool_client):
        pool = AgentPool(pool_path)
        with patch("operator.tool_handlers.pool.POOL", pool):
            result = await tool_save_agent_template({
                "name": "bad",
                "agent_type": "claude",
                "role": "manager",
                "capabilities": [],
                "description": "Bad",
            }, mock_pool_client)
            assert "error" in result

    async def test_capabilities_from_string(self, pool_path, mock_pool_client):
        pool = AgentPool(pool_path)
        with patch("operator.tool_handlers.pool.POOL", pool):
            result = await tool_save_agent_template({
                "name": "str-caps",
                "agent_type": "claude",
                "role": "coder",
                "capabilities": "python, rust, go",
                "description": "Multi-lang",
            }, mock_pool_client)
            assert result["saved"] is True
            assert pool.templates["str-caps"].capabilities == ["python", "rust", "go"]


# ---------------------------------------------------------------------------
# tool_list_agent_templates
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestListAgentTemplates:
    async def test_local_only(self, pool_path, mock_pool_client):
        pool = AgentPool(pool_path)
        pool.add(AgentTemplate(name="t1", agent_type="claude", role="coder", capabilities=[], description="T1"))
        pool.add(AgentTemplate(name="t2", agent_type="codex", role="reviewer", capabilities=[], description="T2"))
        with patch("operator.tool_handlers.pool.POOL", pool):
            result = await tool_list_agent_templates(mock_pool_client)
            assert result["count"] == 2
