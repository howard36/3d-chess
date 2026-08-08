"""Local (no Modal deploy) tests for the websocket server logic.

These run create_web_app() in-process with Starlette's TestClient, so they
cover message validation, game lifecycle, turn handling, disconnect cleanup,
and rejoin without needing Modal credentials. The durable store is a plain
dict here; production passes a modal.Dict with the same access patterns.
"""

import time

import pytest
from fastapi.testclient import TestClient

import modal_app
from modal_app import create_web_app


@pytest.fixture()
def store():
    return {}


@pytest.fixture()
def client(store):
    modal_app.connections.clear()
    with TestClient(create_web_app(store=store)) as c:
        yield c
    modal_app.connections.clear()


@pytest.fixture()
def creator_is_white(monkeypatch):
    """Pin the creator's color to white for tests that need determinism."""
    monkeypatch.setattr(modal_app.random, "choice", lambda seq: "white")


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
    assert msg["color"] in ("white", "black")
    return msg["gameId"], msg["color"]


def start_game(ws1, ws2):
    """Create with ws1, join with ws2; return (gid, white_ws, black_ws)."""
    gid, _ = create_game(ws1)
    ws2.send_json({"type": "join_game", "gameId": gid})
    start1 = ws1.receive_json()
    start2 = ws2.receive_json()
    assert start1["type"] == "game_start"
    assert start2["type"] == "game_start"
    assert {start1["color"], start2["color"]} == {"white", "black"}
    if start1["color"] == "white":
        return gid, ws1, ws2
    return gid, ws2, ws1


def rejoin(ws, gid, color):
    ws.send_json({"type": "rejoin_game", "gameId": gid, "color": color})
    msg = ws.receive_json()
    assert msg["type"] == "game_state"
    assert msg["color"] == color
    return msg


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
        ws.send_json({"type": "game_created", "gameId": "XXXXXX", "color": "white"})
        assert ws.receive_json()["code"] == "invalid_message"
        # rejoin_game without a color is malformed
        ws.send_json({"type": "rejoin_game", "gameId": "XXXXXX"})
        assert ws.receive_json()["code"] == "invalid_message"
        # Connection still usable
        create_game(ws)


def test_move_requires_a_game(client):
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "move", "from": "Aa2", "to": "Aa3"})
        assert ws.receive_json()["code"] == "invalid_move"


def test_move_requires_both_seats_claimed(client):
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


def test_double_create_rejected(client, store):
    with client.websocket_connect("/ws") as ws:
        create_game(ws)
        ws.send_json({"type": "create_game"})
        assert ws.receive_json()["code"] == "already_in_game"
        assert len(store) == 1


def test_creator_cannot_join_own_game(client):
    with client.websocket_connect("/ws") as ws:
        gid, _ = create_game(ws)
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


def test_game_stays_full_while_a_player_is_disconnected(client):
    """Seats are claimed for the game's life, not tied to live sockets."""
    with client.websocket_connect("/ws") as ws1:
        with client.websocket_connect("/ws") as ws2:
            gid, _, _ = start_game(ws1, ws2)
        assert wait_until(lambda: len(modal_app.connections.get(gid, {})) == 1)
        with client.websocket_connect("/ws") as ws3:
            ws3.send_json({"type": "join_game", "gameId": gid})
            assert ws3.receive_json()["code"] == "game_full"


def test_disconnect_cleanup_and_survivor_keeps_working(client, store):
    with client.websocket_connect("/ws") as ws1:
        with client.websocket_connect("/ws") as ws2:
            gid, white_ws, black_ws = start_game(ws1, ws2)
            survivor_is_white = white_ws is ws1

        # ws2 disconnected: its socket must be removed from the live map
        assert wait_until(lambda: len(modal_app.connections.get(gid, {})) == 1)

        # The survivor may keep playing while the opponent is away; the
        # opponent catches up from the stored history on rejoin.
        ws1.send_json({"type": "move", "from": "Aa2", "to": "Aa3"})
        msg = ws1.receive_json()
        if survivor_is_white:
            assert msg["type"] == "move_made"
            assert store[gid]["moves"] == [{"by": "white", "from": "Aa2", "to": "Aa3"}]
        else:
            assert msg["code"] == "wrong_turn"

    # Once the last player leaves, the live map drains but the durable
    # record survives so either player can rejoin later.
    assert wait_until(lambda: gid not in modal_app.connections)
    assert gid in store


def test_finished_games_do_not_leak_sockets(client, store):
    for _ in range(3):
        with client.websocket_connect("/ws") as ws1, client.websocket_connect("/ws") as ws2:
            start_game(ws1, ws2)
    # Live-socket map drains; durable records persist (their cleanup is the
    # store's concern — Modal Dict entries expire after ~30 days of inactivity).
    assert wait_until(lambda: len(modal_app.connections) == 0)
    assert len(store) == 3


def test_rejoin_unknown_game(client):
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "rejoin_game", "gameId": "NOPE99", "color": "white"})
        assert ws.receive_json()["code"] == "invalid_game"
        # A failed rejoin does not bind the connection to a game
        create_game(ws)


def test_rejoin_unclaimed_seat_rejected(client, creator_is_white):
    with client.websocket_connect("/ws") as ws1:
        gid, color = create_game(ws1)
        assert color == "white"
    with client.websocket_connect("/ws") as ws2:
        # Black was never claimed by anyone
        ws2.send_json({"type": "rejoin_game", "gameId": gid, "color": "black"})
        assert ws2.receive_json()["code"] == "invalid_rejoin"
        # The failed rejoin leaves the connection free to join normally
        ws2.send_json({"type": "join_game", "gameId": gid})
        assert ws2.receive_json()["type"] == "game_start"


def test_rejoin_before_opponent_joins(client):
    with client.websocket_connect("/ws") as ws1:
        gid, color = create_game(ws1)
    assert wait_until(lambda: gid not in modal_app.connections)

    with client.websocket_connect("/ws") as ws2:
        state = rejoin(ws2, gid, color)
        assert state["started"] is False
        assert state["moves"] == []
        # The rejoined creator gets game_start when an opponent arrives
        with client.websocket_connect("/ws") as ws3:
            ws3.send_json({"type": "join_game", "gameId": gid})
            assert ws3.receive_json()["type"] == "game_start"
            start = ws2.receive_json()
            assert start["type"] == "game_start"
            assert start["color"] == color


def test_rejoin_restores_history_and_play_continues(client):
    with client.websocket_connect("/ws") as ws1, client.websocket_connect("/ws") as ws2:
        gid, white_ws, black_ws = start_game(ws1, ws2)
        white_ws.send_json({"type": "move", "from": "Aa2", "to": "Aa3"})
        white_ws.receive_json()
        black_ws.receive_json()
    assert wait_until(lambda: len(modal_app.connections) == 0)

    # Both players come back on fresh sockets
    with client.websocket_connect("/ws") as ws_w, client.websocket_connect("/ws") as ws_b:
        state_w = rejoin(ws_w, gid, "white")
        assert state_w["started"] is True
        assert state_w["moves"] == [{"by": "white", "from": "Aa2", "to": "Aa3"}]
        state_b = rejoin(ws_b, gid, "black")
        assert state_b["moves"] == state_w["moves"]

        # Turn enforcement picks up where the history left off: black to move
        ws_w.send_json({"type": "move", "from": "Aa3", "to": "Aa4"})
        assert ws_w.receive_json()["code"] == "wrong_turn"
        ws_b.send_json({"type": "move", "from": "Ea4", "to": "Ea3"})
        mm = ws_b.receive_json()
        assert mm["type"] == "move_made"
        assert mm["by"] == "black"
        assert ws_w.receive_json() == mm


def test_moves_while_opponent_disconnected_appear_on_rejoin(client, creator_is_white):
    with client.websocket_connect("/ws") as ws1:
        gid, _ = create_game(ws1)
        with client.websocket_connect("/ws") as ws2:
            ws2.send_json({"type": "join_game", "gameId": gid})
            assert ws1.receive_json()["type"] == "game_start"
            assert ws2.receive_json()["color"] == "black"
        assert wait_until(lambda: len(modal_app.connections.get(gid, {})) == 1)

        # White moves while black is away
        ws1.send_json({"type": "move", "from": "Aa2", "to": "Aa3"})
        assert ws1.receive_json()["type"] == "move_made"

        # Black returns and receives the missed move, then replies
        with client.websocket_connect("/ws") as ws_b:
            state = rejoin(ws_b, gid, "black")
            assert state["moves"] == [{"by": "white", "from": "Aa2", "to": "Aa3"}]
            ws_b.send_json({"type": "move", "from": "Ea4", "to": "Ea3"})
            assert ws_b.receive_json()["by"] == "black"
            assert ws1.receive_json()["by"] == "black"


def test_rejoin_replaces_lingering_socket(client, creator_is_white):
    with client.websocket_connect("/ws") as ws1, client.websocket_connect("/ws") as ws2:
        gid, _ = create_game(ws1)
        ws2.send_json({"type": "join_game", "gameId": gid})
        assert ws1.receive_json()["type"] == "game_start"
        assert ws2.receive_json()["type"] == "game_start"

        # White rejoins on a fresh socket while the old one is still open
        with client.websocket_connect("/ws") as ws_new:
            state = rejoin(ws_new, gid, "white")
            assert state["started"] is True

            # The old socket is closed server-side; once its disconnect is
            # processed it must not evict the replacement.
            assert wait_until(lambda: modal_app.connections.get(gid, {}).get("white") is not None)

            # The replacement plays as white; black still receives the move
            ws_new.send_json({"type": "move", "from": "Aa2", "to": "Aa3"})
            assert ws_new.receive_json()["type"] == "move_made"
            assert ws2.receive_json()["type"] == "move_made"
