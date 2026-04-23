"""Tests for operator.gateway_client — ConstructGatewayClient."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from operator_mcp.gateway_client import ConstructGatewayClient


class TestGatewayClientInit:
    def test_disabled_without_url(self):
        with patch.dict("os.environ", {}, clear=True):
            gw = ConstructGatewayClient()
            assert not gw._available

    def test_disabled_without_httpx(self):
        with patch.dict("os.environ", {"CONSTRUCT_GATEWAY_URL": "http://localhost:8080"}), \
             patch("operator.gateway_client._HAS_HTTPX", False):
            gw = ConstructGatewayClient()
            assert not gw._available

    def test_enabled(self):
        with patch.dict("os.environ", {"CONSTRUCT_GATEWAY_URL": "http://localhost:8080"}), \
             patch("operator.gateway_client._HAS_HTTPX", True):
            gw = ConstructGatewayClient()
            assert gw._available
            assert gw.gateway_url == "http://localhost:8080"

    def test_strips_trailing_slash(self):
        with patch.dict("os.environ", {"CONSTRUCT_GATEWAY_URL": "http://localhost:8080/"}), \
             patch("operator.gateway_client._HAS_HTTPX", True):
            gw = ConstructGatewayClient()
            assert gw.gateway_url == "http://localhost:8080"

    def test_headers_with_token(self):
        with patch.dict("os.environ", {
            "CONSTRUCT_GATEWAY_URL": "http://localhost:8080",
            "CONSTRUCT_GATEWAY_TOKEN": "my-token",
        }), patch("operator.gateway_client._HAS_HTTPX", True):
            gw = ConstructGatewayClient()
            headers = gw._headers()
            assert headers["Authorization"] == "Bearer my-token"
            assert headers["Accept"] == "application/json"

    def test_headers_without_token(self):
        with patch.dict("os.environ", {"CONSTRUCT_GATEWAY_URL": "http://localhost:8080"}, clear=True), \
             patch("operator.gateway_client._HAS_HTTPX", True):
            gw = ConstructGatewayClient()
            headers = gw._headers()
            assert "Authorization" not in headers


class TestGatewayClientMethods:
    @pytest.mark.asyncio
    async def test_get_cost_summary_unavailable(self):
        with patch.dict("os.environ", {}, clear=True):
            gw = ConstructGatewayClient()
            result = await gw.get_cost_summary()
            assert result is None

    @pytest.mark.asyncio
    async def test_get_status_unavailable(self):
        with patch.dict("os.environ", {}, clear=True):
            gw = ConstructGatewayClient()
            result = await gw.get_status()
            assert result is None

    @pytest.mark.asyncio
    async def test_push_channel_event_unavailable(self):
        with patch.dict("os.environ", {}, clear=True):
            gw = ConstructGatewayClient()
            result = await gw.push_channel_event({"type": "test"})
            assert result is False
