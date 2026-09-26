"""Local (no Modal deploy) tests for the websocket server logic.

These run create_web_app() in-process with Starlette's TestClient, so they
cover message validation, game lifecycle, turn handling, disconnect cleanup,
and rejoin without needing Modal credentials. The durable store is a plain
dict here; production passes a modal.Dict with the same access patterns.
"""

import logging
import time

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

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
    joined = ws2.receive_json()
    assert joined["type"] == "game_joined"
    start1 = ws1.receive_json()
    start2 = ws2.receive_json()
    assert start1["type"] == "game_start"
    assert start2["type"] == "game_start"
    assert start2["color"] == joined["color"]
    assert {start1["color"], start2["color"]} == {"white", "black"}
    # Each side is then told the other is connected
    assert ws1.receive_json() == {"type": "presence", "color": start2["color"], "online": True}
    assert ws2.receive_json() == {"type": "presence", "color": start1["color"], "online": True}
    if start1["color"] == "white":
        return gid, ws1, ws2
    return gid, ws2, ws1


def presence(color, online):
    return {"type": "presence", "color": color, "online": online}


def rejoin(ws, gid, color):
    ws.send_json({"type": "rejoin_game", "gameId": gid, "color": color})
    msg = ws.receive_json()
    assert msg["type"] == "game_state"
    assert msg["color"] == color
    # followed by the opponent's current presence
    assert ws.receive_json()["type"] == "presence"
    return msg


def test_health_reports_status_and_version(client, monkeypatch):
    resp = client.get("/health")
    assert resp.status_code == 200
    # Outside a deploy nothing sets APP_VERSION; CI's deploy job bakes in the
    # commit SHA and greps for it to prove the new build is serving.
    assert resp.json() == {"status": "healthy", "version": "dev"}
    monkeypatch.setenv("APP_VERSION", "abc123")
    assert client.get("/health").json()["version"] == "abc123"


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


def test_binary_frame_gets_error_and_connection_survives(client):
    # Starlette's receive_json reads message["text"], which a binary frame
    # lacks; that used to escape the handler and kill the socket.
    with client.websocket_connect("/ws") as ws:
        ws.send_bytes(b"\x00\x01")
        err = ws.receive_json()
        assert err["type"] == "error"
        assert err["code"] == "invalid_message"
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

        # ws2 disconnected: its socket must be removed from the live map, and
        # the survivor told
        assert wait_until(lambda: len(modal_app.connections.get(gid, {})) == 1)
        assert ws1.receive_json()["type"] == "presence"

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
        assert ws2.receive_json()["type"] == "game_joined"
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
            assert ws3.receive_json()["type"] == "game_joined"
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
        # White (already connected) is told black arrived
        assert ws_w.receive_json() == presence("black", True)

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
            assert ws1.receive_json() == presence("black", True)
            assert ws2.receive_json()["color"] == "black"
        assert wait_until(lambda: len(modal_app.connections.get(gid, {})) == 1)
        assert ws1.receive_json() == presence("black", False)

        # White moves while black is away
        ws1.send_json({"type": "move", "from": "Aa2", "to": "Aa3"})
        assert ws1.receive_json()["type"] == "move_made"

        # Black returns and receives the missed move, then replies
        with client.websocket_connect("/ws") as ws_b:
            state = rejoin(ws_b, gid, "black")
            assert state["moves"] == [{"by": "white", "from": "Aa2", "to": "Aa3"}]
            assert ws1.receive_json() == presence("black", True)
            ws_b.send_json({"type": "move", "from": "Ea4", "to": "Ea3"})
            assert ws_b.receive_json()["by"] == "black"
            assert ws1.receive_json()["by"] == "black"


def test_rejoin_while_in_game_rejected(client, creator_is_white):
    with client.websocket_connect("/ws") as ws:
        gid, _ = create_game(ws)
        ws.send_json({"type": "rejoin_game", "gameId": gid, "color": "white"})
        assert ws.receive_json()["code"] == "already_in_game"


def test_rejoin_replaces_lingering_socket(client, creator_is_white):
    with client.websocket_connect("/ws") as ws1, client.websocket_connect("/ws") as ws2:
        gid, _ = create_game(ws1)
        ws2.send_json({"type": "join_game", "gameId": gid})
        assert ws1.receive_json()["type"] == "game_start"
        assert ws1.receive_json() == presence("black", True)
        assert ws2.receive_json()["type"] == "game_joined"
        assert ws2.receive_json()["type"] == "game_start"
        assert ws2.receive_json() == presence("white", True)

        # White rejoins on a fresh socket while the old one is still open
        with client.websocket_connect("/ws") as ws_new:
            state = rejoin(ws_new, gid, "white")
            assert state["started"] is True
            # Black is told white (re)connected; it never sees white go
            # offline, because the replaced socket's disconnect is not a
            # departure.
            assert ws2.receive_json() == presence("white", True)

            # The old socket is closed server-side with the application close
            # code that tells the client it was replaced (so it must not
            # auto-reconnect and evict the replacement in turn).
            with pytest.raises(WebSocketDisconnect) as closed:
                ws1.receive_json()
            assert closed.value.code == modal_app.SEAT_REPLACED_CLOSE_CODE
            assert closed.value.reason == "seat_replaced"

            # Once the old socket's disconnect is processed it must not evict
            # the replacement.
            assert wait_until(lambda: modal_app.connections.get(gid, {}).get("white") is not None)

            # The replacement plays as white; black still receives the move
            ws_new.send_json({"type": "move", "from": "Aa2", "to": "Aa3"})
            assert ws_new.receive_json()["type"] == "move_made"
            assert ws2.receive_json()["type"] == "move_made"


def test_presence_follows_connections(client, creator_is_white):
    with client.websocket_connect("/ws") as ws1:
        gid, _ = create_game(ws1)
        with client.websocket_connect("/ws") as ws2:
            ws2.send_json({"type": "join_game", "gameId": gid})
            # Joiner: seat confirmed directly, then start, then opponent status
            assert ws2.receive_json() == {"type": "game_joined", "color": "black"}
            assert ws2.receive_json()["type"] == "game_start"
            assert ws2.receive_json() == presence("white", True)
            # Creator: start, then the joiner's arrival
            assert ws1.receive_json()["type"] == "game_start"
            assert ws1.receive_json() == presence("black", True)
        # Black leaves
        assert ws1.receive_json() == presence("black", False)

        # Black comes back on a new socket: it learns white is online, white
        # learns black is back
        with client.websocket_connect("/ws") as ws3:
            ws3.send_json({"type": "rejoin_game", "gameId": gid, "color": "black"})
            assert ws3.receive_json()["type"] == "game_state"
            assert ws3.receive_json() == presence("white", True)
            assert ws1.receive_json() == presence("black", True)

            # The other way round: white leaves and returns while black waits
            ws1.close()
            assert ws3.receive_json() == presence("white", False)
            with client.websocket_connect("/ws") as ws4:
                rejoin(ws4, gid, "white")
                assert ws3.receive_json() == presence("white", True)


def test_game_joined_alone_is_enough_to_rejoin(client, creator_is_white):
    """A joiner that drops right after game_joined (before game_start) has a
    claimed seat and knows its color, so it can rejoin."""
    with client.websocket_connect("/ws") as ws1:
        gid, _ = create_game(ws1)
        with client.websocket_connect("/ws") as ws2:
            ws2.send_json({"type": "join_game", "gameId": gid})
            joined = ws2.receive_json()
            assert joined == {"type": "game_joined", "color": "black"}
        with client.websocket_connect("/ws") as ws3:
            state = rejoin(ws3, gid, joined["color"])
            assert state["started"] is True


def test_repeated_join_from_the_claimant_returns_its_seat(client, creator_is_white):
    """A joiner whose game_joined was lost to a drop re-sends its join on the
    next connection; the server recognises its client id and hands the same
    seat back instead of answering "Game full" to its own claim."""
    with client.websocket_connect("/ws") as ws1:
        gid, _ = create_game(ws1)
        with client.websocket_connect("/ws") as ws2:
            ws2.send_json({"type": "join_game", "gameId": gid, "clientId": "tab-b"})
            assert ws2.receive_json() == {"type": "game_joined", "color": "black"}
        assert ws1.receive_json()["type"] == "game_start"
        assert ws1.receive_json() == presence("black", True)
        assert ws1.receive_json() == presence("black", False)

        # Meanwhile the creator (White) moved, which the lost socket never saw
        ws1.send_json({"type": "move", "from": "Aa2", "to": "Aa3"})
        assert ws1.receive_json()["type"] == "move_made"

        with client.websocket_connect("/ws") as ws3:
            ws3.send_json({"type": "join_game", "gameId": gid, "clientId": "tab-b"})
            assert ws3.receive_json() == {"type": "game_joined", "color": "black"}
            # Answered like a rejoin: the whole record, not a bare start, so the
            # page shows the position the game is actually in
            assert ws3.receive_json() == {
                "type": "game_state",
                "color": "black",
                "started": True,
                "moves": [{"by": "white", "from": "Aa2", "to": "Aa3"}],
            }
            assert ws3.receive_json() == presence("white", True)
            # The opponent is only told Black is back, not restarted
            assert ws1.receive_json() == presence("black", True)

            # Anyone else is still refused
            with client.websocket_connect("/ws") as ws4:
                ws4.send_json({"type": "join_game", "gameId": gid, "clientId": "tab-c"})
                assert ws4.receive_json()["code"] == "game_full"

            # And the seat plays
            ws3.send_json({"type": "move", "from": "Ed4", "to": "Ed3"})
            assert ws3.receive_json()["type"] == "move_made"
            assert ws1.receive_json()["type"] == "move_made"


def test_repeated_join_replaces_the_claimants_lingering_socket(client, creator_is_white):
    with client.websocket_connect("/ws") as ws1, client.websocket_connect("/ws") as ws2:
        gid, _ = create_game(ws1)
        ws2.send_json({"type": "join_game", "gameId": gid, "clientId": "tab-b"})
        assert ws2.receive_json()["type"] == "game_joined"
        with client.websocket_connect("/ws") as ws3:
            ws3.send_json({"type": "join_game", "gameId": gid, "clientId": "tab-b"})
            assert ws3.receive_json()["type"] == "game_joined"
            assert ws3.receive_json()["type"] == "game_state"
            assert ws2.receive_json()["type"] == "game_start"
            assert ws2.receive_json() == presence("white", True)
            with pytest.raises(WebSocketDisconnect) as closed:
                ws2.receive_json()
            assert closed.value.code == modal_app.SEAT_REPLACED_CLOSE_CODE
            assert wait_until(lambda: modal_app.connections.get(gid, {}).get("black") is not None)


def rejoin_as(ws, gid, color, client_id, takeover=None):
    msg = {"type": "rejoin_game", "gameId": gid, "color": color, "clientId": client_id}
    if takeover is not None:
        msg["takeover"] = takeover
    ws.send_json(msg)
    return ws.receive_json()


def test_automatic_rejoin_does_not_take_the_seat_from_another_tab(client, creator_is_white):
    """A tab that was reconnecting while the player moved to another tab must
    not take the seat back unasked; it is refused until the player asks."""
    with client.websocket_connect("/ws") as ws1:
        gid, _ = create_game(ws1)
        with client.websocket_connect("/ws") as tab_b:
            assert rejoin_as(tab_b, gid, "white", "tab-b")["type"] == "game_state"
            assert tab_b.receive_json()["type"] == "presence"
            with pytest.raises(WebSocketDisconnect):
                ws1.receive_json()

            with client.websocket_connect("/ws") as tab_a:
                refused = rejoin_as(tab_a, gid, "white", "tab-a", takeover=False)
                assert refused["type"] == "error"
                assert refused["code"] == "seat_in_use"
                # The seat and its connection are untouched
                assert modal_app.connections[gid]["white"] is not None
                tab_b.send_json({"type": "join_game", "gameId": "NOPE00"})
                assert tab_b.receive_json()["code"] == "already_in_game"

                # Asked explicitly ("Play here"), the same tab takes it
                assert rejoin_as(tab_a, gid, "white", "tab-a", takeover=True)["type"] == (
                    "game_state"
                )
                with pytest.raises(WebSocketDisconnect) as closed:
                    while True:
                        tab_b.receive_json()
                assert closed.value.code == modal_app.SEAT_REPLACED_CLOSE_CODE


def test_automatic_rejoin_replaces_its_own_stale_socket(client, creator_is_white):
    """After a drop the server may still hold the tab's old, half-open socket;
    the tab's automatic rejoin must not be refused because of it."""
    with client.websocket_connect("/ws") as ws1:
        gid, _ = create_game(ws1)
        with client.websocket_connect("/ws") as stale:
            assert rejoin_as(stale, gid, "white", "tab-a")["type"] == "game_state"
            with client.websocket_connect("/ws") as fresh:
                state = rejoin_as(fresh, gid, "white", "tab-a", takeover=False)
                assert state["type"] == "game_state"
                with pytest.raises(WebSocketDisconnect) as closed:
                    while True:
                        stale.receive_json()
                assert closed.value.code == modal_app.SEAT_REPLACED_CLOSE_CODE


def test_repeated_join_before_the_game_starts_waits_for_the_opponent(client, creator_is_white):
    """The creator's own tab joining its game (say, with storage disabled) is
    a repeated join too: it gets its seat back and a not-started snapshot."""
    with client.websocket_connect("/ws") as ws1:
        ws1.send_json({"type": "create_game", "clientId": "tab-a"})
        gid = ws1.receive_json()["gameId"]
    with client.websocket_connect("/ws") as ws2:
        ws2.send_json({"type": "join_game", "gameId": gid, "clientId": "tab-a"})
        assert ws2.receive_json() == {"type": "game_joined", "color": "white"}
        assert ws2.receive_json() == {
            "type": "game_state",
            "color": "white",
            "started": False,
            "moves": [],
        }
        assert ws2.receive_json() == presence("black", False)


def test_automatic_rejoin_takes_a_free_seat(client, creator_is_white):
    with client.websocket_connect("/ws") as ws1:
        gid, _ = create_game(ws1)
    assert wait_until(lambda: gid not in modal_app.connections)
    with client.websocket_connect("/ws") as ws2:
        assert rejoin_as(ws2, gid, "white", "tab-a", takeover=False)["type"] == "game_state"


# --- Logging ------------------------------------------------------------------


def app_logs(caplog, level):
    return [r.getMessage() for r in caplog.records if r.name == "3d_chess" and r.levelno == level]


def test_game_error_is_logged_as_warning(client, caplog):
    with caplog.at_level(logging.INFO, logger="3d_chess"):
        with client.websocket_connect("/ws") as ws:
            gid, _ = create_game(ws)
            ws.send_json({"type": "move", "from": "Aa2", "to": "Aa3"})
            assert ws.receive_json()["code"] == "game_not_started"
    warnings = app_logs(caplog, logging.WARNING)
    assert len(warnings) == 1
    assert f"gid={gid}" in warnings[0]
    assert "code=game_not_started" in warnings[0]
    assert "message=Both players must have joined to move" in warnings[0]


def test_lifecycle_and_moves_are_logged_at_info(client, caplog):
    with caplog.at_level(logging.INFO, logger="3d_chess"):
        with client.websocket_connect("/ws") as ws1, client.websocket_connect("/ws") as ws2:
            gid, white_ws, black_ws = start_game(ws1, ws2)
            white_ws.send_json({"type": "move", "from": "Aa2", "to": "Aa3"})
            white_ws.receive_json()
            black_ws.receive_json()
            black_ws.send_json({"type": "move", "from": "Ea4", "to": "Ea5", "promotion": "N"})
            black_ws.receive_json()
            white_ws.receive_json()
        assert wait_until(lambda: gid not in modal_app.connections)
    infos = app_logs(caplog, logging.INFO)
    assert sum(m.startswith("websocket accepted ") for m in infos) == 2
    assert sum(m.startswith(f"websocket closed gid={gid} ") for m in infos) == 2
    assert sum(m.startswith(f"game created gid={gid} color=") for m in infos) == 1
    assert sum(m.startswith(f"seat joined gid={gid} color=") for m in infos) == 1
    assert f"move recorded gid={gid} by=white from=Aa2 to=Aa3 promotion=None" in infos
    assert f"move recorded gid={gid} by=black from=Ea4 to=Ea5 promotion=N" in infos
    assert app_logs(caplog, logging.WARNING) == []


def test_rejoin_logs_whether_a_socket_was_replaced(client, caplog, creator_is_white):
    with caplog.at_level(logging.INFO, logger="3d_chess"):
        with client.websocket_connect("/ws") as ws1:
            gid, _ = create_game(ws1)
            with client.websocket_connect("/ws") as ws_new:
                rejoin(ws_new, gid, "white")
                with pytest.raises(WebSocketDisconnect):
                    ws1.receive_json()
        assert wait_until(lambda: gid not in modal_app.connections)
        with client.websocket_connect("/ws") as ws3:
            rejoin(ws3, gid, "white")
    rejoins = [m for m in app_logs(caplog, logging.INFO) if m.startswith("seat rejoined ")]
    assert len(rejoins) == 2
    assert rejoins[0].startswith(
        f"seat rejoined gid={gid} color=white moves=0 replaced_socket=True"
    )
    assert rejoins[1].startswith(
        f"seat rejoined gid={gid} color=white moves=0 replaced_socket=False"
    )


def test_unexpected_exception_is_logged_with_traceback_and_closes_socket(
    client, caplog, monkeypatch
):
    def boom(*args, **kwargs):
        raise RuntimeError("store exploded")

    monkeypatch.setattr(modal_app, "record_move", boom)
    with caplog.at_level(logging.INFO, logger="3d_chess"):
        with client.websocket_connect("/ws") as ws:
            gid, _ = create_game(ws)
            ws.send_json({"type": "move", "from": "Aa2", "to": "Aa3"})
            with pytest.raises(WebSocketDisconnect) as closed:
                ws.receive_json()
            assert closed.value.code == modal_app.INTERNAL_ERROR_CLOSE_CODE
            assert closed.value.reason == "internal_error"
    errors = [r for r in caplog.records if r.name == "3d_chess" and r.levelno == logging.ERROR]
    assert len(errors) == 1
    assert f"gid={gid}" in errors[0].getMessage()
    assert errors[0].exc_info is not None
    assert errors[0].exc_info[0] is RuntimeError
    # The connection was still detached from the live map
    assert wait_until(lambda: gid not in modal_app.connections)
