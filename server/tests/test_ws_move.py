import pytest, json
import websockets

@pytest.mark.asyncio
async def test_wrong_turn_error(ws_connect):
    ws1 = await ws_connect()
    ws2 = await ws_connect()
    # Create game with ws1
    await ws1.send(json.dumps({"type": "create_game"}))
    msg1 = json.loads(await ws1.recv())
    gid = msg1["gameId"]
    # ws2 joins
    await ws2.send(json.dumps({"type": "join_game", "gameId": gid}))
    # Both receive game_start
    start1 = json.loads(await ws1.recv())
    start2 = json.loads(await ws2.recv())
    # Find out who is white
    if start1["color"] == "white":
        white_ws, black_ws = ws1, ws2
    else:
        white_ws, black_ws = ws2, ws1
    # Black tries to move first (should be white's turn)
    await black_ws.send(json.dumps({
        "type": "move", "from": "Aa1", "to": "Ab2"
    }))
    err = json.loads(await black_ws.recv())
    assert err["type"] == "error"
    assert err["code"] == "wrong_turn"

@pytest.mark.asyncio
async def test_move_made_broadcast(ws_connect):
    ws1 = await ws_connect()
    ws2 = await ws_connect()
    # Create game with ws1
    await ws1.send(json.dumps({"type": "create_game"}))
    msg1 = json.loads(await ws1.recv())
    gid = msg1["gameId"]
    # ws2 joins
    await ws2.send(json.dumps({"type": "join_game", "gameId": gid}))
    # Both receive game_start
    start1 = json.loads(await ws1.recv())
    start2 = json.loads(await ws2.recv())
    # Find out who is white
    if start1["color"] == "white":
        white_ws, black_ws = ws1, ws2
    else:
        white_ws, black_ws = ws2, ws1
    # White makes a move
    await white_ws.send(json.dumps({
        "type": "move", "from": "Aa1", "to": "Ab2"
    }))
    # Both should receive move_made
    msgs = [json.loads(await white_ws.recv()), json.loads(await black_ws.recv())]
    assert all(m["type"] == "move_made" for m in msgs)
    assert all(m["by"] == "white" for m in msgs)
    assert all(m["from"] == "Aa1" and m["to"] == "Ab2" for m in msgs) 