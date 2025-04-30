import pytest, json
import websockets

@pytest.mark.asyncio
async def test_create_game(ws_connect):
    ws = await ws_connect()
    await ws.send(json.dumps({"type":"create_game"}))
    msg = json.loads(await ws.recv())
    assert msg["type"] == "game_created"
    assert "gameId" in msg 

@pytest.mark.asyncio
async def test_join_game(ws_connect):
    # First client creates the game
    ws1 = await ws_connect()
    await ws1.send(json.dumps({"type": "create_game"}))
    msg1 = json.loads(await ws1.recv())
    assert msg1["type"] == "game_created"
    gid = msg1["gameId"]

    # Second client joins the game
    ws2 = await ws_connect()
    await ws2.send(json.dumps({"type": "join_game", "gameId": gid}))
    # Both clients should receive game_start
    start_msgs = [json.loads(await ws1.recv()), json.loads(await ws2.recv())]
    assert all(m["type"] == "game_start" for m in start_msgs)
    colors = {m["color"] for m in start_msgs}
    assert colors == {"white", "black"} 