import logging
import os
import random
import string

import fastapi
import modal
from fastapi import WebSocket, WebSocketDisconnect
from fastapi.websockets import WebSocketState
from pydantic import ValidationError

from messages import (
    Color,
    CreateGame,
    Error,
    ErrorCode,
    GameCreated,
    GameJoined,
    GameStart,
    GameState,
    JoinGame,
    Move,
    MoveMade,
    Presence,
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
# GAMES_STORE names the modal.Dict holding game records; a staging deploy
# (see README) sets it so it never shares production's games.
image = (
    modal.Image.debian_slim(python_version="3.13")
    .uv_sync("./", uv_version="0.12.9")  # pinned so the image build itself is reproducible
    .env(
        {
            "APP_VERSION": os.environ.get("GITHUB_SHA", "dev"),
            "GAMES_STORE": os.environ.get("GAMES_STORE", "3d-chess-games"),
        }
    )
    .add_local_python_source("messages")
)

# Close code sent to a socket whose seat was reclaimed by a newer connection
# (rejoin_game from another tab or a refreshed page). It is an application
# code (4000-4999) so the client can tell "you were replaced, stop
# reconnecting" from a network drop, which it should retry.
SEAT_REPLACED_CLOSE_CODE = 4001

# Standard "internal error" close code, sent when a handler hits an exception
# it did not expect; the traceback is in the server log.
INTERNAL_ERROR_CLOSE_CODE = 1011

logger = logging.getLogger("3d_chess")


def _configure_logging() -> None:
    """Make this module's INFO logs visible on stderr.

    uvicorn configures only its own loggers (and Modal none), never the root,
    so without a handler of our own everything below WARNING is dropped.
    create_web_app calls this on every construction (tests build many apps),
    hence the guards: never stack a second handler, never override a level
    someone else configured.
    """
    if not logger.handlers:
        handler = logging.StreamHandler()  # stderr
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
        logger.addHandler(handler)
    if logger.level == logging.NOTSET:
        logger.setLevel(logging.INFO)


def _client(ws: WebSocket) -> str:
    """`host:port` of the peer, for correlating log lines about one socket."""
    return f"{ws.client.host}:{ws.client.port}" if ws.client else "?"


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
# Two rules make that hold without relying on review:
#   1. These functions are plain `def`, not `async def`, so nothing inside
#      them can yield (`await` is a syntax error in a plain function).
#   2. The WebSocket handler never touches `store` itself; it only passes it
#      to these functions. So there is no read in the handler that a later
#      write could race against.
# test_store_ops.py asserts both. Tests pass a plain dict, which has the same
# access pattern.


def create_game(store, client_id: str | None = None) -> tuple[str, str]:
    """Create a game with one seat claimed; return (game id, creator's color).

    `client_id`, when the client sent one, is remembered as the seat's
    claimant (see claim_seat).
    """
    while True:
        gid = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
        if gid not in store:
            break
    # Creator can be white or black, but white always moves first
    color = random.choice(["white", "black"])
    record: dict = {"seats": [color], "moves": []}
    if client_id is not None:
        record["claimants"] = {color: client_id}
    store[gid] = record
    return gid, color


def claim_seat(store, gid: str, client_id: str | None = None) -> tuple[str, bool]:
    """Claim the free seat in `gid`; return (its color, whether it was already ours).

    Seats are claimed for the life of the game, so a full game stays full
    even while a claimant is disconnected. The one exception is the claimant
    itself: a join from the client that already holds a seat returns that
    seat again (with True), so a tab whose game_joined was lost to a drop can
    simply re-send its join instead of being told "Game full" by its own claim.
    """
    record = store.get(gid)
    if record is None:
        raise GameError(ErrorCode.invalid_game, "Cannot join")
    claimants = record.get("claimants", {})
    if client_id is not None:
        for color, claimant in claimants.items():
            if claimant == client_id:
                return color, True
    free = [c for c in ("white", "black") if c not in record["seats"]]
    if not free:
        raise GameError(ErrorCode.game_full, "Game full")
    record["seats"].append(free[0])
    if client_id is not None:
        record["claimants"] = {**claimants, free[0]: client_id}
    store[gid] = record
    return free[0], False


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
    except Exception as exc:
        logger.warning(
            "send failed client=%s type=%s error=%r", _client(ws), payload.get("type"), exc
        )
        return False


async def _send_error(ws: WebSocket, code: ErrorCode, message: str, gid: str | None) -> None:
    """Answer a rejected request with an `error` message (and log the rejection)."""
    logger.warning(
        "request rejected client=%s gid=%s code=%s message=%s",
        _client(ws),
        gid,
        code.value,
        message,
    )
    await _safe_send(ws, Error(type="error", code=code, message=message).model_dump(mode="json"))


def _remove_player(gid: str, color: str, ws: WebSocket) -> bool:
    """Detach a socket from the live-connection map; True if it was the live one.

    The identity check makes a replaced socket's late disconnect a no-op, so a
    player who rejoined on a fresh socket is not evicted (nor reported
    offline) when the old one dies. The durable game record is deliberately
    left alone — it must survive disconnects so players can rejoin.
    """
    conns = connections.get(gid)
    if conns is None:
        return False
    detached = conns.get(color) is ws
    if detached:
        del conns[color]
    if not conns:
        del connections[gid]
    return detached


def _opponent(color: str) -> str:
    return "black" if color == "white" else "white"


async def _notify_opponent_presence(gid: str, color: str, online: bool) -> None:
    """Tell `color`'s opponent, if connected, that `color` came online/went offline."""
    sock = connections.get(gid, {}).get(_opponent(color))
    if sock is not None:
        msg = Presence(type="presence", color=Color(color), online=online)
        await _safe_send(sock, msg.model_dump(mode="json"))


async def _send_opponent_presence(gid: str, ws: WebSocket, color: str) -> None:
    """Tell `ws` (seated as `color`) whether its opponent is connected right now."""
    opponent = _opponent(color)
    online = opponent in connections.get(gid, {})
    msg = Presence(type="presence", color=Color(opponent), online=online)
    await _safe_send(ws, msg.model_dump(mode="json"))


def _client_id(ws: WebSocket) -> str | None:
    """The client id the socket announced when it took its seat, if any."""
    return getattr(ws.state, "client_id", None)


async def _close_replaced(old_ws: WebSocket) -> None:
    """Tell a socket whose seat moved to a newer connection that it was replaced."""
    try:
        await old_ws.close(code=SEAT_REPLACED_CLOSE_CODE, reason="seat_replaced")
    except Exception:
        pass


def _require_not_in_game(gid: str | None) -> None:
    if gid is not None:
        raise GameError(ErrorCode.already_in_game, "Already in a game")


def create_web_app(store=None) -> fastapi.FastAPI:
    if store is None:
        store = {}
    _configure_logging()
    web_app = fastapi.FastAPI()

    @web_app.get("/health")
    async def health_check():
        return {"status": "healthy", "version": os.environ.get("APP_VERSION", "dev")}

    @web_app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket):
        await ws.accept()
        client = _client(ws)
        logger.info("websocket accepted client=%s", client)
        player_color: str | None = None  # this connection's seat, once claimed
        gid: str | None = None  # this connection's game, once in one
        try:
            # A send to a client that already closed (_safe_send swallows the
            # failure) leaves Starlette considering the socket disconnected,
            # and receiving on it would raise RuntimeError. That is a normal
            # disconnect, so stop the loop and fall through to `finally`.
            while ws.application_state == WebSocketState.CONNECTED:
                try:
                    data = await ws.receive_json()
                except (ValueError, KeyError):
                    # ValueError: the text frame was not valid JSON. KeyError:
                    # Starlette reads message["text"], which a binary frame
                    # doesn't carry; without this the exception would escape
                    # the loop and kill the connection.
                    await _send_error(
                        ws, ErrorCode.invalid_message, "Message is not valid JSON", gid
                    )
                    continue
                try:
                    envelope = WebsocketV1MessageEnvelope.model_validate(data).root
                except ValidationError:
                    await _send_error(
                        ws,
                        ErrorCode.invalid_message,
                        "Message does not conform to the protocol schema",
                        gid,
                    )
                    continue

                try:
                    if isinstance(envelope, CreateGame):
                        _require_not_in_game(gid)
                        client_id = envelope.clientId.root if envelope.clientId else None
                        gid, player_color = create_game(store, client_id)
                        ws.state.client_id = client_id
                        connections[gid] = {player_color: ws}
                        logger.info(
                            "game created gid=%s color=%s client=%s", gid, player_color, client
                        )
                        created = GameCreated(
                            type="game_created", gameId=gid, color=Color(player_color)
                        )
                        await _safe_send(ws, created.model_dump(mode="json"))
                    elif isinstance(envelope, JoinGame):
                        _require_not_in_game(gid)
                        client_id = envelope.clientId.root if envelope.clientId else None
                        player_color, reclaimed = claim_seat(store, envelope.gameId, client_id)
                        gid = envelope.gameId
                        ws.state.client_id = client_id
                        conns = connections.setdefault(gid, {})
                        # Only a repeated join from the seat's own claimant can
                        # find the seat occupied: its first socket, which lost
                        # the answer and may linger half-open. Replace it.
                        old_ws = conns.get(player_color)
                        conns[player_color] = ws
                        logger.info(
                            "seat joined gid=%s color=%s reclaimed=%s client=%s",
                            gid,
                            player_color,
                            reclaimed,
                            client,
                        )
                        # The joiner's seat is confirmed to it directly first, so a
                        # drop before the game_start below still leaves it able to
                        # rejoin (the seat is already claimed in the store).
                        joined = GameJoined(type="game_joined", color=Color(player_color))
                        await _safe_send(ws, joined.model_dump(mode="json"))
                        if reclaimed:
                            # A repeated join: the game may have started and moved on
                            # since the first one, and the opponent already had its
                            # start. Answer like a rejoin, with the whole record.
                            record = find_seat(store, gid, player_color)
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
                        else:
                            # Send GameStart to the connected players, white first
                            for col in ("white", "black"):
                                sock = conns.get(col)
                                if sock is not None:
                                    payload = GameStart(type="game_start", color=Color(col))
                                    await _safe_send(sock, payload.model_dump(mode="json"))
                        await _notify_opponent_presence(gid, player_color, True)
                        await _send_opponent_presence(gid, ws, player_color)
                        if old_ws is not None and old_ws is not ws:
                            await _close_replaced(old_ws)
                    elif isinstance(envelope, RejoinGame):
                        _require_not_in_game(gid)
                        record = find_seat(store, envelope.gameId, envelope.color.value)
                        client_id = envelope.clientId.root if envelope.clientId else None
                        # Last connection wins: a refresh's old socket can linger
                        # half-open for minutes, and rejecting the new connection
                        # would lock the returning player out. An automatic
                        # reconnect (takeover=false) is the exception: if another
                        # tab's connection holds the seat, that tab is the one the
                        # player is using, and this one must not take it back
                        # unasked. Its own stale socket (same client id) it may.
                        live_ws = connections.get(envelope.gameId, {}).get(envelope.color.value)
                        if (
                            envelope.takeover is False
                            and live_ws is not None
                            and (client_id is None or _client_id(live_ws) != client_id)
                        ):
                            raise GameError(
                                ErrorCode.seat_in_use, "This game is open in another tab"
                            )
                        gid = envelope.gameId
                        player_color = envelope.color.value
                        ws.state.client_id = client_id
                        conns = connections.setdefault(gid, {})
                        old_ws = conns.get(player_color)
                        conns[player_color] = ws
                        replaced = old_ws is not None and old_ws is not ws
                        logger.info(
                            "seat rejoined gid=%s color=%s moves=%d replaced_socket=%s client=%s",
                            gid,
                            player_color,
                            len(record["moves"]),
                            replaced,
                            client,
                        )
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
                        await _send_opponent_presence(gid, ws, player_color)
                        await _notify_opponent_presence(gid, player_color, True)
                        if replaced:
                            await _close_replaced(old_ws)
                    elif isinstance(envelope, Move):
                        # Recorded durably first, then relayed to whichever
                        # players are connected; an offline opponent catches up
                        # via game_state on rejoin.
                        move_dict = record_move(store, gid, player_color, envelope)
                        logger.info(
                            "move recorded gid=%s by=%s from=%s to=%s promotion=%s",
                            gid,
                            move_dict["by"],
                            move_dict["from"],
                            move_dict["to"],
                            move_dict.get("promotion"),
                        )
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
                    await _send_error(ws, err.code, err.message, gid)
        except WebSocketDisconnect:
            pass
        except Exception:
            # Anything else is a bug. Log the traceback (uvicorn would only
            # report it if we re-raised, and Modal's wrapper not at all) and
            # end this connection cleanly; the client's reconnect logic then
            # rejoins as it would after a network drop.
            logger.exception("unhandled error gid=%s color=%s client=%s", gid, player_color, client)
            try:
                await ws.close(code=INTERNAL_ERROR_CLOSE_CODE, reason="internal_error")
            except Exception:
                pass
        finally:
            logger.info("websocket closed gid=%s color=%s client=%s", gid, player_color, client)
            # Detach this connection so later broadcasts don't hit a dead
            # socket. The durable record stays in the store for rejoins.
            if gid is not None and player_color is not None:
                if _remove_player(gid, player_color, ws):
                    await _notify_opponent_presence(gid, player_color, False)

    return web_app


@app.function(image=image, include_source=True, max_containers=1, timeout=3600)
@modal.concurrent(max_inputs=1000)
@modal.asgi_app()
def serve() -> fastapi.FastAPI:
    # Durable game records survive container restarts and expire via Modal's
    # ~30-day inactivity TTL, so abandoned games clean themselves up.
    store = modal.Dict.from_name(os.environ["GAMES_STORE"], create_if_missing=True)
    return create_web_app(store=store)
