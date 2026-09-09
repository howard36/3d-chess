"""Smoke test over a real uvicorn process.

Everything about the protocol is covered in-process by test_local_ws.py;
this file exists only to prove the `uvicorn modal_app:create_web_app
--factory` entry point that Playwright's webServer (and the README's local
backend instructions) rely on actually serves HTTP and WebSocket traffic.
"""

import json
import urllib.request

import pytest


def test_health_over_http(ws_server):
    with urllib.request.urlopen(ws_server + "/health", timeout=5) as resp:
        body = json.load(resp)
    assert body["status"] == "healthy"
    assert "version" in body


@pytest.mark.asyncio
async def test_create_join_move_roundtrip(ws_connect):
    ws1 = await ws_connect()
    ws2 = await ws_connect()
    await ws1.send(json.dumps({"type": "create_game"}))
    created = json.loads(await ws1.recv())
    assert created["type"] == "game_created"

    await ws2.send(json.dumps({"type": "join_game", "gameId": created["gameId"]}))
    start1 = json.loads(await ws1.recv())
    start2 = json.loads(await ws2.recv())
    assert {start1["type"], start2["type"]} == {"game_start"}
    assert {start1["color"], start2["color"]} == {"white", "black"}
    white_ws, black_ws = (ws1, ws2) if start1["color"] == "white" else (ws2, ws1)

    await white_ws.send(json.dumps({"type": "move", "from": "Aa2", "to": "Aa3"}))
    mm1 = json.loads(await white_ws.recv())
    mm2 = json.loads(await black_ws.recv())
    assert mm1 == mm2
    assert mm1["type"] == "move_made"

    await white_ws.send(json.dumps({"type": "move", "from": "Aa3", "to": "Aa4"}))
    assert json.loads(await white_ws.recv())["code"] == "wrong_turn"
