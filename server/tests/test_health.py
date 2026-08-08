import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health(ws_server):
    async with AsyncClient(base_url=ws_server) as ac:
        resp = await ac.get("/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "healthy"}
