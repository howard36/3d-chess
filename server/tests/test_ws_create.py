import pytest, json
import websockets

@pytest.mark.asyncio
async def test_create_game(ws_server):
    uri = ws_server.replace("http", "ws") + "/ws"
    async with websockets.connect(uri) as ws:
        await ws.send(json.dumps({"type":"create_game"}))
        msg = json.loads(await ws.recv())
        assert msg["type"] == "game_created"
        assert "gameId" in msg 