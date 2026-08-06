"""Local (no Modal deploy) tests for the websocket server logic.

These run create_web_app() in-process with Starlette's TestClient, so they
cover message validation, game lifecycle, turn handling, and disconnect
cleanup without needing Modal credentials.
"""

import time

import pytest
from fastapi.testclient import TestClient

import modal_app
from modal_app import create_web_app


@pytest.fixture()
def client():
    modal_app.games.clear()
    modal_app.turns.clear()
    with TestClient(create_web_app()) as c:
        yield c
    modal_app.games.clear()
    modal_app.turns.clear()


def wait_until(predicate, timeout=2.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return False


def create_game(ws):
    ws.send_json({"type": "create_game"})
    msg = ws.receive_json()
    assert msg["type"] == "game_created"
    return msg["gameId"]


def start_game(ws1, ws2):
    """Create with ws1, join with ws2; return (gid, white_ws, black_ws)."""
    gid = create_game(ws1)
    ws2.send_json({"type": "join_game", "gameId": gid})
    start1 = ws1.receive_json()
    start2 = ws2.receive_json()
    assert start1["type"] == "game_start"
    assert start2["type"] == "game_start"
    assert {start1["color"], start2["color"]} == {"white", "black"}
    if start1["color"] == "white":
        return gid, ws1, ws2
    return gid, ws2, ws1


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "healthy"}


def test_full_flow_and_turn_enforcement(client):
    with client.websocket_connect("/ws") as ws1, client.websocket_connect("/ws") as ws2:
        gid, white_ws, black_ws = start_game(ws1, ws2)

        # Black may not move first
        black_ws.send_json({"type": "move", "from": "Ea4", "to": "Ea3"})
        err = black_ws.receive_json()
        assert err["type"] == "error"
        assert err["code"] == "wrong_turn"

        # White moves; both players receive the same move_made
        white_ws.send_json({"type": "move", "from": "Aa2", "to": "Aa3"})
        mm1 = white_ws.receive_json()
        mm2 = black_ws.receive_json()
        assert mm1 == mm2
        assert mm1["type"] == "move_made"
        assert mm1["by"] == "white"
        assert mm1["from"] == "Aa2"
        assert mm1["to"] == "Aa3"
        # promotion was not sent, so it must be omitted (schema forbids null)
        assert "promotion" not in mm1

        # White may not move twice in a row
        white_ws.send_json({"type": "move", "from": "Aa3", "to": "Aa4"})
        err = white_ws.receive_json()
        assert err["code"] == "wrong_turn"

        # Black's turn works
        black_ws.send_json({"type": "move", "from": "Ea4", "to": "Ea3"})
        assert black_ws.receive_json()["type"] == "move_made"
        assert white_ws.receive_json()["type"] == "move_made"


def test_promotion_is_relayed(client):
    with client.websocket_connect("/ws") as ws1, client.websocket_connect("/ws") as ws2:
        _, white_ws, black_ws = start_game(ws1, ws2)
        white_ws.send_json({"type": "move", "from": "Ea4", "to": "Ea5", "promotion": "N"})
        mm = white_ws.receive_json()
        assert mm["promotion"] == "N"
        assert black_ws.receive_json()["promotion"] == "N"


def test_invalid_json_gets_error_and_connection_survives(client):
    with client.websocket_connect("/ws") as ws:
        ws.send_text("this is not json {")
        err = ws.receive_json()
        assert err["type"] == "error"
        assert err["code"] == "invalid_message"
        # Connection still usable
        create_game(ws)


def test_schema_violations_get_error_and_connection_survives(client):
    with client.websocket_connect("/ws") as ws:
        # Unknown message type
        ws.send_json({"type": "bogus"})
        assert ws.receive_json()["code"] == "invalid_message"
        # Bad coordinate format
        ws.send_json({"type": "move", "from": "Zz9", "to": "Aa1"})
        assert ws.receive_json()["code"] == "invalid_message"
        # Invalid promotion value (K is the King's letter, not a legal promotion)
        ws.send_json({"type": "move", "from": "Ea4", "to": "Ea5", "promotion": "K"})
        assert ws.receive_json()["code"] == "invalid_message"
        # Server-only message type sent by a client
        ws.send_json({"type": "game_created", "gameId": "XXXXXX"})
        assert ws.receive_json()["code"] == "invalid_message"
        # Connection still usable
        create_game(ws)


def test_move_requires_a_game(client):
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "move", "from": "Aa2", "to": "Aa3"})
        assert ws.receive_json()["code"] == "invalid_move"


def test_move_requires_both_players(client):
    with client.websocket_connect("/ws") as ws:
        create_game(ws)
        ws.send_json({"type": "move", "from": "Aa2", "to": "Aa3"})
        assert ws.receive_json()["code"] == "game_not_started"


def test_join_unknown_game(client):
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "join_game", "gameId": "NOPE99"})
        assert ws.receive_json()["code"] == "invalid_game"
        # A failed join does not bind the connection to a game
        create_game(ws)


def test_double_create_rejected(client):
    with client.websocket_connect("/ws") as ws:
        create_game(ws)
        ws.send_json({"type": "create_game"})
        assert ws.receive_json()["code"] == "already_in_game"
        assert len(modal_app.games) == 1


def test_creator_cannot_join_own_game(client):
    with client.websocket_connect("/ws") as ws:
        gid = create_game(ws)
        ws.send_json({"type": "join_game", "gameId": gid})
        assert ws.receive_json()["code"] == "already_in_game"


def test_third_player_cannot_join_full_game(client):
    with (
        client.websocket_connect("/ws") as ws1,
        client.websocket_connect("/ws") as ws2,
        client.websocket_connect("/ws") as ws3,
    ):
        gid, _, _ = start_game(ws1, ws2)
        ws3.send_json({"type": "join_game", "gameId": gid})
        assert ws3.receive_json()["code"] == "game_full"


def test_disconnect_cleanup_and_survivor_keeps_working(client):
    with client.websocket_connect("/ws") as ws1:
        with client.websocket_connect("/ws") as ws2:
            gid, white_ws, black_ws = start_game(ws1, ws2)
            survivor_is_white = white_ws is ws1

        # ws2 disconnected: it must be removed from the game
        assert wait_until(lambda: len(modal_app.games.get(gid, {})) == 1)

        # The survivor's connection still works; moving now is rejected
        # cleanly instead of crashing the connection.
        ws1.send_json({"type": "move", "from": "Aa2", "to": "Aa3"})
        err = ws1.receive_json()
        assert err["type"] == "error"
        assert err["code"] in ("game_not_started", "wrong_turn")
        if survivor_is_white:
            assert err["code"] == "game_not_started"

    # Once the last player leaves, the game is deleted entirely
    assert wait_until(lambda: gid not in modal_app.games and gid not in modal_app.turns)


def test_finished_games_do_not_leak(client):
    for _ in range(3):
        with client.websocket_connect("/ws") as ws1, client.websocket_connect("/ws") as ws2:
            start_game(ws1, ws2)
    assert wait_until(lambda: len(modal_app.games) == 0 and len(modal_app.turns) == 0)
