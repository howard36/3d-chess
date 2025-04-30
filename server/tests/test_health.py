import sys
import os
import pytest
from httpx import AsyncClient

sys.path.insert(0, os.path.abspath(os.path.dirname(__file__) + '/../'))
from modal_app import serve

@pytest.mark.asyncio
async def test_health(ws_server):
    async with AsyncClient(base_url=ws_server) as ac:
        resp = await ac.get("/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "healthy"} 