import sys
import os
import pytest
from httpx import AsyncClient

sys.path.insert(0, os.path.abspath(os.path.dirname(__file__) + '/../'))
from modal_app import serve

WEB_URL = "https://howard-modal-labs--3d-chess-backend-serve-dev.modal.run"

@pytest.mark.asyncio
async def test_health():
    async with AsyncClient(base_url=WEB_URL) as ac:
        resp = await ac.get("/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "healthy"} 