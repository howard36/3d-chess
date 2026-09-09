import inspect
import os
import random
import string

import fastapi
import modal
from fastapi import WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from messages import (
    Color,
    CreateGame,
    Error,
    ErrorCode,
    GameCreated,
    GameStart,
    GameState,
    JoinGame,
    Move,
    MoveMade,
    RejoinGame,
    WebsocketV1MessageEnvelope,
)

# The image installs exactly the dependency set in uv.lock (main dependencies
# only, no extras), so production runs the versions CI tested rather than
# whatever `pip install fastapi` resolved to when the layer was first built.
# `uv_project_dir` is relative to where `modal deploy` runs, i.e. server/.
# messages.py is mounted separately so a code change doesn't rebuild the
# dependency layer. APP_VERSION is baked in at deploy time so /health can
# prove which commit is serving (CI greps for it after a deploy).
image = (
    modal.Image.debian_slim(python_version="3.13")
    .uv_sync("./")
    .env({"APP_VERSION": os.environ.get("GITHUB_SHA", "dev")})
    .add_local_python_source("messages")
)

# Close code sent to a socket whose seat was reclaimed by a newer connection
# (rejoin_game from another tab or a refreshed page). It is an application
# code (4000-4999) so the client can tell "you were replaced, stop
# reconnecting" from a network drop, which it should retry.
SEAT_REPLACED_CLOSE_CODE = 4001

app = modal.App("3d-chess-backend")

# Live sockets only: gid -> {color: websocket}. The durable game record (seats
# claimed, move history) lives in the store passed to create_web_app, so a
# disconnect only detaches the socket here — the game itself survives and a
# player can rejoin later.
connections: dict[str, dict[str, WebSocket]] = {}


class GameError(Exception):
    """A rejected client request; the handler answers with an `error` message."""

    def __init__(self, code: ErrorCode, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


# --- Store operations ---------------------------------------------------------
#
# The store holds each game's durable record: {"seats": [colors claimed],
# "moves": [move dicts in wire format]}. In production it is a modal.Dict,
# which returns deserialized copies and whose calls BLOCK (they are the sync
# wrappers; never switch to the `.aio` variants). So every mutation below is a
# read-modify-write that must complete without yielding to the event loop, or
# a concurrent handler could interleave a stale write.
#
# These functions are deliberately plain `def`, not `async def`: `await` is a
# syntax error inside them, so the no-yield property holds by construction
# rather than by review. test_store_ops.py asserts they stay synchronous.
# Tests pass a plain dict, which has the same access pattern.


def create_game(store) -> tuple[str, str]:
    """Create a game with one seat claimed; return (game id, creator's color)."""
    while True:
        gid = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
        if gid not in store:
            break
    # Creator can be white or black, but white always moves first
    color = random.choice(["white", "black"])
    store[gid] = {"seats": [color], "moves": []}
    return gid, color


def claim_seat(store, gid: str) -> str:
    """Claim the free seat in `gid`; return its color.

    Seats are claimed for the life of the game, so a full game stays full
    even while a claimant is disconnected.
    """
    record = store.get(gid)
    if record is None:
        raise GameError(ErrorCode.invalid_game, "Cannot join")
    free = [c for c in ("white", "black") if c not in record["seats"]]
    if not free:
        raise GameError(ErrorCode.game_full, "Game full")
    record["seats"].append(free[0])
    store[gid] = record
    return free[0]


def find_seat(store, gid: str, color: str) -> dict:
    """Return the record of `gid` if `color` holds a seat in it (read-only)."""
    record = store.get(gid)
    if record is None:
        raise GameError(ErrorCode.invalid_game, "Cannot rejoin")
    if color not in record["seats"]:
        raise GameError(ErrorCode.invalid_rejoin, "No such seat to rejoin")
    return record


def record_move(store, gid: str | None, color: str | None, move: Move) -> dict:
    """Append `move` by `color` to `gid`'s history; return the stored move dict.

    Validates that the game exists, has both seats, and that it is `color`'s
    turn. Move legality is deliberately not checked (see README).
    """
    record = store.get(gid) if gid is not None else None
    if record is None:
        raise GameError(ErrorCode.invalid_move, "Not in a game")
    if len(record["seats"]) < 2:
        raise GameError(ErrorCode.game_not_started, "Both players must have joined to move")
    if _turn(record) != color:
        raise GameError(ErrorCode.wrong_turn, "Not your turn")
    move_dict = {"by": color, "from": move.from_, "to": move.to}
    if move.promotion is not None:
        move_dict["promotion"] = move.promotion.value
    record["moves"].append(move_dict)
    store[gid] = record
    return move_dict


STORE_OPERATIONS = (create_game, claim_seat, find_seat, record_move)
assert not any(inspect.iscoroutinefunction(f) for f in STORE_OPERATIONS)


def _turn(record: dict) -> str:
    # White moves first; turn alternates with each recorded move.
    return "white" if len(record["moves"]) % 2 == 0 else "black"


# --- Socket plumbing ----------------------------------------------------------


async def _safe_send(ws: WebSocket, payload: dict) -> bool:
    """Send to a socket that may have closed.

    A peer's dead socket must not take down the other player's connection.
    Failures are not fatal here: the dead socket's own handler detaches it
    from `connections` when its disconnect is processed.
    """
    try:
        await ws.send_json(payload)
        return True
    except Exception:
        return False


async def _send_error(ws: WebSocket, code: ErrorCode, message: str) -> None:
    await _safe_send(ws, Error(type="error", code=code, message=message).model_dump(mode="json"))


def _remove_player(gid: str, color: str, ws: WebSocket) -> None:
    """Detach a socket from the live-connection map.

    The identity check makes a replaced socket's late disconnect a no-op, so a
    player who rejoined on a fresh socket is not evicted when the old one dies.
    The durable game record is deliberately left alone — it must survive
    disconnects so players can rejoin.
    """
    conns = connections.get(gid)
    if conns is None:
        return
    if conns.get(color) is ws:
        del conns[color]
    if not conns:
        del connections[gid]


def _require_not_in_game(gid: str | None) -> None:
    if gid is not None:
        raise GameError(ErrorCode.already_in_game, "Already in a game")


def create_web_app(store=None) -> fastapi.FastAPI:
    if store is None:
        store = {}
    web_app = fastapi.FastAPI()

    @web_app.get("/health")
    async def health_check():
        return {"status": "healthy", "version": os.environ.get("APP_VERSION", "dev")}

    @web_app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket):
        await ws.accept()
        player_color: str | None = None  # this connection's seat, once claimed
        gid: str | None = None  # this connection's game, once in one
        try:
            while True:
                try:
                    data = await ws.receive_json()
                except (ValueError, KeyError):
                    # ValueError: the text frame was not valid JSON. KeyError:
                    # Starlette reads message["text"], which a binary frame
                    # doesn't carry; without this the exception would escape
                    # the loop and kill the connection.
                    await _send_error(ws, ErrorCode.invalid_message, "Message is not valid JSON")
                    continue
                try:
                    envelope = WebsocketV1MessageEnvelope.model_validate(data).root
                except ValidationError:
                    await _send_error(
                        ws,
                        ErrorCode.invalid_message,
                        "Message does not conform to the protocol schema",
                    )
                    continue

                try:
                    if isinstance(envelope, CreateGame):
                        _require_not_in_game(gid)
                        gid, player_color = create_game(store)
                        connections[gid] = {player_color: ws}
                        created = GameCreated(
                            type="game_created", gameId=gid, color=Color(player_color)
                        )
                        await _safe_send(ws, created.model_dump(mode="json"))
                    elif isinstance(envelope, JoinGame):
                        _require_not_in_game(gid)
                        player_color = claim_seat(store, envelope.gameId)
                        gid = envelope.gameId
                        conns = connections.setdefault(gid, {})
                        conns[player_color] = ws
                        # Send GameStart to the connected players, white first
                        for col in ("white", "black"):
                            sock = conns.get(col)
                            if sock is not None:
                                payload = GameStart(type="game_start", color=Color(col))
                                await _safe_send(sock, payload.model_dump(mode="json"))
                    elif isinstance(envelope, RejoinGame):
                        _require_not_in_game(gid)
                        record = find_seat(store, envelope.gameId, envelope.color.value)
                        gid = envelope.gameId
                        player_color = envelope.color.value
                        # Last connection wins: a refresh's old socket can linger
                        # half-open for minutes, and rejecting the new connection
                        # would lock the returning player out.
                        conns = connections.setdefault(gid, {})
                        old_ws = conns.get(player_color)
                        conns[player_color] = ws
                        state = GameState.model_validate(
                            {
                                "type": "game_state",
                                "color": player_color,
                                "started": len(record["seats"]) == 2,
                                "moves": record["moves"],
                            }
                        )
                        await _safe_send(
                            ws, state.model_dump(mode="json", by_alias=True, exclude_none=True)
                        )
                        if old_ws is not None and old_ws is not ws:
                            try:
                                await old_ws.close(
                                    code=SEAT_REPLACED_CLOSE_CODE, reason="seat_replaced"
                                )
                            except Exception:
                                pass
                    elif isinstance(envelope, Move):
                        # Recorded durably first, then relayed to whichever
                        # players are connected; an offline opponent catches up
                        # via game_state on rejoin.
                        move_dict = record_move(store, gid, player_color, envelope)
                        move_made = MoveMade.model_validate({"type": "move_made", **move_dict})
                        payload = move_made.model_dump(
                            mode="json", by_alias=True, exclude_none=True
                        )
                        for sock in list(connections.get(gid, {}).values()):
                            await _safe_send(sock, payload)
                    else:
                        # Structurally valid, but a message type only the server may send
                        raise GameError(
                            ErrorCode.invalid_message,
                            f"Clients may not send {envelope.type} messages",
                        )
                except GameError as err:
                    await _send_error(ws, err.code, err.message)
        except WebSocketDisconnect:
            pass
        finally:
            # Detach this connection so later broadcasts don't hit a dead
            # socket. The durable record stays in the store for rejoins.
            if gid is not None and player_color is not None:
                _remove_player(gid, player_color, ws)

    return web_app


@app.function(image=image, include_source=True, max_containers=1, timeout=3600)
@modal.concurrent(max_inputs=1000)
@modal.asgi_app()
def serve() -> fastapi.FastAPI:
    # Durable game records survive container restarts and expire via Modal's
    # ~30-day inactivity TTL, so abandoned games clean themselves up.
    return create_web_app(store=modal.Dict.from_name("3d-chess-games", create_if_missing=True))
