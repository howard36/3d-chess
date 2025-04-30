import pytest
import websockets
import json

@pytest.mark.asyncio
async def test_full_ws_flow(ws_connect):
    # Client A creates a game
    ws1 = await ws_connect()
    ws2 = await ws_connect()
    await ws1.send(json.dumps({"type":"create_game"}))
    created = json.loads(await ws1.recv())
    game_id = created["gameId"]

    # Client B joins
    await ws2.send(json.dumps({"type":"join_game","gameId":game_id}))
    start1 = json.loads(await ws1.recv())
    start2 = json.loads(await ws2.recv())
    assert start1["type"] == "game_start"
    assert start1["color"] != start2["color"]
    # Determine which connection is white or black
    if start1["color"] == "white":
        white_ws, black_ws = ws1, ws2
    else:
        white_ws, black_ws = ws2, ws1

    # White makes a valid move
    move = {"type": "move", "from": "Aa1", "to": "Aa2"}
    await white_ws.send(json.dumps(move))
    mm1 = json.loads(await white_ws.recv())
    mm2 = json.loads(await black_ws.recv())
    assert mm1 == mm2
    assert mm1["type"] == "move_made"

    # White tries to move out of turn → error
    bad = {"type": "move", "from": "Aa2", "to": "Aa3"}
    await white_ws.send(json.dumps(bad))
    err = json.loads(await white_ws.recv())
    assert err["type"] == "error"
    assert err["code"] == "wrong_turn" 