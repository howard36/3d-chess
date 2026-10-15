import logging
import os
import random
import re
import string

import fastapi
import modal
from fastapi import WebSocket, WebSocketDisconnect
from fastapi.websockets import WebSocketState
from pydantic import ValidationError

from messages import (
    AcceptDraw,
    AcceptRematch,
    AcceptTakeback,
    Color,
    CreateGame,
    DeclineDraw,
    DeclineRematch,
    DeclineTakeback,
    DrawDeclined,
    DrawOffered,
    Error,
    ErrorCode,
    GameCreated,
    GameEnded,
    GameInfo,
    GameJoined,
    GameStart,
    GameState,
    JoinGame,
    LookGame,
    Move,
    MoveMade,
    OfferDraw,
    OfferRematch,
    Presence,
    RejoinGame,
    RematchDeclined,
    RematchOffered,
    RematchStarted,
    RequestTakeback,
    Resign,
    TakebackDeclined,
    TakebackRequested,
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
# (see ARCHITECTURE.md) sets it so it never shares production's games.
image = (
    modal.Image.debian_slim(python_version="3.13")
    .uv_sync("./", uv_version="0.12.24")  # pinned so the image build itself is reproducible
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
# "moves": [move dicts in wire format]}, plus "claimants" (which client id
# claimed each seat), "ending" once a player resigns or a draw is agreed
# ({"result", "winner"?}), and "drawOffer", the latest draw offer
# ({"by", "ply", "declined"?}; it stands only while "ply" is the number of
# moves, so a move cancels it without touching it), "takebackRequest",
# the latest take-back request, kept the same way, and "rematch", the latest
# offer of a new game between the same players ({"by", "declined"?,
# "gameId"?}: "gameId" once accepted). In production it is a modal.Dict,
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


# A game id as create_game makes them. Any other names no game and is never
# looked up: the id comes from the link, and a long one would go to the
# store as a long key, every game on the server waiting on that call
GAME_ID_CHARS = string.ascii_uppercase + string.digits
GAME_ID = re.compile(f"[{GAME_ID_CHARS}]{{6}}")


def _stored(store, gid: str) -> dict | None:
    """The record of `gid`, or None for an id create_game would never make."""
    return store.get(gid) if GAME_ID.fullmatch(gid) else None


# A game's id is all it takes to claim its open seat: drawn from the system's
# entropy, not the module's Mersenne Twister, whose state its outputs give away
_rng = random.SystemRandom()


def _fresh_id(store) -> str:
    """An id no game in `store` has."""
    while True:
        gid = "".join(_rng.choices(GAME_ID_CHARS, k=6))
        if gid not in store:
            return gid


def create_game(store, client_id: str | None = None, color: str | None = None) -> tuple[str, str]:
    """Create a game with one seat claimed; return (game id, creator's color).

    `color` is the side the creator asked for; without one it is picked at
    random. `client_id`, when the client sent one, is remembered as the
    seat's claimant (see claim_seat).
    """
    gid = _fresh_id(store)
    # Creator can be white or black, but white always moves first
    if color is None:
        color = _rng.choice(["white", "black"])
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
    record = _stored(store, gid)
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


def taken_seats(store, gid: str) -> list[str]:
    """Return the seats claimed in `gid` (read-only)."""
    record = _stored(store, gid)
    if record is None:
        raise GameError(ErrorCode.invalid_game, "No such game")
    return list(record["seats"])


def find_seat(store, gid: str, color: str) -> dict:
    """Return the record of `gid` if `color` holds a seat in it (read-only)."""
    record = _stored(store, gid)
    if record is None:
        raise GameError(ErrorCode.invalid_game, "Cannot rejoin")
    if color not in record["seats"]:
        raise GameError(ErrorCode.invalid_rejoin, "No such seat to rejoin")
    return record


def _live_record(store, gid: str | None, absent: ErrorCode = ErrorCode.game_not_started) -> dict:
    """The record of `gid` if its game is under way: both seats taken, not ended.

    `absent` is the refusal when the connection is in no game.
    """
    record = store.get(gid) if gid is not None else None
    if record is None:
        raise GameError(absent, "Not in a game")
    if len(record["seats"]) < 2:
        raise GameError(ErrorCode.game_not_started, "Both players must have joined")
    if "ending" in record:
        raise GameError(ErrorCode.game_over, "The game is over")
    return record


def record_move(store, gid: str | None, color: str | None, move: Move) -> dict:
    """Append `move` by `color` to `gid`'s history; return the stored move dict.

    Validates that the game exists, has both seats, has not ended (a
    resignation or an agreed draw), and that it is `color`'s turn. Move
    legality is deliberately not checked (see ARCHITECTURE.md). A standing draw
    offer lapses with the move: it was made at the previous ply.
    """
    record = _live_record(store, gid, absent=ErrorCode.invalid_move)
    if _turn(record) != color:
        raise GameError(ErrorCode.wrong_turn, "Not your turn")
    move_dict = {"by": color, "from": move.from_, "to": move.to}
    if move.promotion is not None:
        move_dict["promotion"] = move.promotion.value
    record["moves"].append(move_dict)
    store[gid] = record
    return move_dict


def resign(store, gid: str | None, color: str | None) -> dict:
    """`color` resigns `gid`; return the ending ({"result", "winner"})."""
    record = _live_record(store, gid)
    ending = {"result": "resignation", "winner": _opponent(color)}
    record["ending"] = ending
    store[gid] = record
    return ending


def _standing(record: dict, key: str) -> dict | None:
    """The draw offer or take-back request under `key`, if it stands."""
    ask = record.get(key)
    if ask is None or ask["ply"] != len(record["moves"]) or ask.get("declined"):
        return None
    return ask


def _taken_back(moves: list, color: str | None) -> int:
    """How many moves a take-back by `color` removes: their last and any reply."""
    for i in range(len(moves) - 1, -1, -1):
        if moves[i]["by"] == color:
            return len(moves) - i
    return 0


def request_takeback(store, gid: str | None, color: str | None) -> dict:
    """`color` asks to take back their last move in `gid`; return the request ({"by", "ply"}).

    Only a player with a move on the record may ask, and once per move (ply):
    never while a request stands, nor again after one made since the last
    move was declined.
    """
    record = _live_record(store, gid)
    if _taken_back(record["moves"], color) == 0:
        raise GameError(ErrorCode.invalid_takeback, "No move of yours to take back")
    ply = len(record["moves"])
    latest = record.get("takebackRequest")
    if latest is not None and latest["ply"] == ply:
        raise GameError(ErrorCode.invalid_takeback, "A take-back was already asked for this move")
    request = {"by": color, "ply": ply}
    record["takebackRequest"] = request
    store[gid] = record
    return request


def _request_to_answer(record: dict, color: str | None) -> dict:
    request = _standing(record, "takebackRequest")
    if request is None or request["by"] == color:
        raise GameError(ErrorCode.invalid_takeback, "No take-back to answer")
    return request


def accept_takeback(store, gid: str | None, color: str | None) -> dict:
    """`color` grants the opponent's standing take-back in `gid`; return the record.

    The requester's last move goes, and the reply to it if one was made. The
    draw offer and the take-back request go with them: each names a ply the
    game can reach again.
    """
    record = _live_record(store, gid)
    request = _request_to_answer(record, color)
    moves = record["moves"]
    record["moves"] = moves[: len(moves) - _taken_back(moves, request["by"])]
    record.pop("drawOffer", None)
    record.pop("takebackRequest", None)
    store[gid] = record
    return record


def decline_takeback(store, gid: str | None, color: str | None) -> dict:
    """`color` refuses the opponent's standing take-back in `gid`; return it, declined."""
    record = _live_record(store, gid)
    request = {**_request_to_answer(record, color), "declined": True}
    record["takebackRequest"] = request
    store[gid] = record
    return request


def offer_draw(store, gid: str | None, color: str | None) -> dict:
    """`color` offers a draw in `gid`; return the offer ({"by", "ply"}).

    A draw can be offered once per move (ply), by either side: never while an
    offer stands, nor again after one made since the last move was declined.
    """
    record = _live_record(store, gid)
    ply = len(record["moves"])
    latest = record.get("drawOffer")
    if latest is not None and latest["ply"] == ply:
        raise GameError(ErrorCode.invalid_draw, "A draw was already offered this move")
    offer = {"by": color, "ply": ply}
    record["drawOffer"] = offer
    store[gid] = record
    return offer


def _offer_to_answer(record: dict, color: str | None) -> dict:
    offer = _standing(record, "drawOffer")
    if offer is None or offer["by"] == color:
        raise GameError(ErrorCode.invalid_draw, "No draw offer to answer")
    return offer


def accept_draw(store, gid: str | None, color: str | None) -> dict:
    """`color` accepts the opponent's standing offer in `gid`; return the ending."""
    record = _live_record(store, gid)
    _offer_to_answer(record, color)
    ending = {"result": "agreement"}
    record["ending"] = ending
    store[gid] = record
    return ending


def decline_draw(store, gid: str | None, color: str | None) -> dict:
    """`color` declines the opponent's standing offer in `gid`; return the offer, declined."""
    record = _live_record(store, gid)
    offer = {**_offer_to_answer(record, color), "declined": True}
    record["drawOffer"] = offer
    store[gid] = record
    return offer


def _seated_record(store, gid: str | None) -> dict:
    """The record of `gid` once both seats are taken, whether or not it has ended.

    A rematch is offered once the game is over, which the server cannot
    always tell: a mate or a draw on the board is the clients' to see.
    """
    record = store.get(gid) if gid is not None else None
    if record is None:
        raise GameError(ErrorCode.game_not_started, "Not in a game")
    if len(record["seats"]) < 2:
        raise GameError(ErrorCode.game_not_started, "Both players must have joined")
    return record


def _start_rematch(store, gid: str, record: dict, offer: dict) -> dict:
    """Store the rematch `offer` asks for and return it, accepted ({"by", "gameId"}).

    The new game has both seats taken, each player holding the other colour
    (each tab's claim goes with its player), and no moves.
    """
    new_gid = _fresh_id(store)
    rematch: dict = {"seats": ["white", "black"], "moves": []}
    claimants = record.get("claimants")
    if claimants:
        rematch["claimants"] = {_opponent(c): client_id for c, client_id in claimants.items()}
    store[new_gid] = rematch
    started = {"by": offer["by"], "gameId": new_gid}
    record["rematch"] = started
    store[gid] = record
    return started


def offer_rematch(store, gid: str | None, color: str | None) -> dict:
    """`color` offers a rematch of `gid`; return the offer ({"by"}), or the rematch begun.

    The opponent's offer standing, this accepts it (both asked). A player
    whose offer was declined cannot offer another; the opponent still can.
    """
    record = _seated_record(store, gid)
    latest = record.get("rematch")
    if latest is not None:
        if "gameId" in latest:
            raise GameError(ErrorCode.invalid_rematch, "The rematch has already begun")
        if latest["by"] == color:
            raise GameError(ErrorCode.invalid_rematch, "A rematch was already offered")
        if not latest.get("declined"):
            return _start_rematch(store, gid, record, latest)
    offer = {"by": color}
    record["rematch"] = offer
    store[gid] = record
    return offer


def _rematch_to_answer(record: dict, color: str | None) -> dict:
    offer = record.get("rematch")
    if offer is None or offer.get("declined") or "gameId" in offer or offer["by"] == color:
        raise GameError(ErrorCode.invalid_rematch, "No rematch to answer")
    return offer


def accept_rematch(store, gid: str | None, color: str | None) -> dict:
    """`color` accepts the opponent's rematch offer in `gid`; return it, with the new game's id."""
    record = _seated_record(store, gid)
    return _start_rematch(store, gid, record, _rematch_to_answer(record, color))


def decline_rematch(store, gid: str | None, color: str | None) -> dict:
    """`color` declines the opponent's rematch offer in `gid`; return it, declined."""
    record = _seated_record(store, gid)
    offer = {**_rematch_to_answer(record, color), "declined": True}
    record["rematch"] = offer
    store[gid] = record
    return offer


STORE_OPERATIONS = (
    create_game,
    claim_seat,
    taken_seats,
    find_seat,
    record_move,
    resign,
    offer_draw,
    accept_draw,
    decline_draw,
    request_takeback,
    accept_takeback,
    decline_takeback,
    offer_rematch,
    accept_rematch,
    decline_rematch,
)


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


def _game_state(record: dict, color: str) -> dict:
    """The `game_state` snapshot of `record` for the player seated as `color`.

    It carries everything a rejoining client replays: the moves, and the
    ending, the latest draw offer, take-back request and rematch offer when
    there are any.
    """
    state = {
        "type": "game_state",
        "color": color,
        "started": len(record["seats"]) == 2,
        "moves": record["moves"],
    }
    for key in ("ending", "drawOffer", "takebackRequest", "rematch"):
        if key in record:
            state[key] = record[key]
    model = GameState.model_validate(state)
    return model.model_dump(mode="json", by_alias=True, exclude_none=True)


async def _broadcast(gid: str, message) -> None:
    """Send `message` (a protocol model) to every player of `gid` who is connected.

    A player who is not catches up from the durable record's game_state on rejoin.
    """
    payload = message.model_dump(mode="json", by_alias=True, exclude_none=True)
    for sock in list(connections.get(gid, {}).values()):
        await _safe_send(sock, payload)


async def _announce_rematch(gid: str, rematch: dict) -> None:
    """Tell both players of `gid` of a rematch offered, or of the rematch begun."""
    if "gameId" in rematch:
        logger.info("rematch started gid=%s new=%s", gid, rematch["gameId"])
        await _broadcast(gid, RematchStarted(type="rematch_started", gameId=rematch["gameId"]))
    else:
        logger.info("rematch offered gid=%s by=%s", gid, rematch["by"])
        await _broadcast(gid, RematchOffered(type="rematch_offered", by=Color(rematch["by"])))


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
                        asked = envelope.color.value if envelope.color else None
                        gid, player_color = create_game(store, client_id, asked)
                        ws.state.client_id = client_id
                        connections[gid] = {player_color: ws}
                        logger.info(
                            "game created gid=%s color=%s client=%s", gid, player_color, client
                        )
                        created = GameCreated(
                            type="game_created", gameId=gid, color=Color(player_color)
                        )
                        await _safe_send(ws, created.model_dump(mode="json"))
                    elif isinstance(envelope, LookGame):
                        # A look binds nothing: the connection stays free to
                        # join this game or any other.
                        seats = taken_seats(store, envelope.gameId)
                        info = GameInfo(
                            type="game_info",
                            gameId=envelope.gameId,
                            seats=[Color(c) for c in seats],
                        )
                        await _safe_send(ws, info.model_dump(mode="json"))
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
                            await _safe_send(ws, _game_state(record, player_color))
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
                        await _safe_send(ws, _game_state(record, player_color))
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
                        await _broadcast(gid, move_made)
                    elif isinstance(envelope, Resign):
                        ending = resign(store, gid, player_color)
                        logger.info("resigned gid=%s by=%s", gid, player_color)
                        await _broadcast(
                            gid, GameEnded.model_validate({"type": "game_ended", **ending})
                        )
                    elif isinstance(envelope, OfferDraw):
                        offer = offer_draw(store, gid, player_color)
                        logger.info(
                            "draw offered gid=%s by=%s ply=%d", gid, offer["by"], offer["ply"]
                        )
                        await _broadcast(
                            gid, DrawOffered.model_validate({"type": "draw_offered", **offer})
                        )
                    elif isinstance(envelope, AcceptDraw):
                        ending = accept_draw(store, gid, player_color)
                        logger.info("draw agreed gid=%s by=%s", gid, player_color)
                        await _broadcast(
                            gid, GameEnded.model_validate({"type": "game_ended", **ending})
                        )
                    elif isinstance(envelope, DeclineDraw):
                        offer = decline_draw(store, gid, player_color)
                        logger.info("draw declined gid=%s by=%s", gid, player_color)
                        declined = DrawDeclined(
                            type="draw_declined", by=Color(player_color), ply=offer["ply"]
                        )
                        await _broadcast(gid, declined)
                    elif isinstance(envelope, RequestTakeback):
                        request = request_takeback(store, gid, player_color)
                        logger.info(
                            "take-back requested gid=%s by=%s ply=%d",
                            gid,
                            request["by"],
                            request["ply"],
                        )
                        await _broadcast(
                            gid,
                            TakebackRequested.model_validate(
                                {"type": "takeback_requested", **request}
                            ),
                        )
                    elif isinstance(envelope, AcceptTakeback):
                        record = accept_takeback(store, gid, player_color)
                        logger.info(
                            "take-back granted gid=%s by=%s moves=%d",
                            gid,
                            player_color,
                            len(record["moves"]),
                        )
                        # Each player gets the game as it now stands, as a
                        # rejoin would: the record is replayed afresh
                        for color, sock in list(connections.get(gid, {}).items()):
                            await _safe_send(sock, _game_state(record, color))
                    elif isinstance(envelope, DeclineTakeback):
                        request = decline_takeback(store, gid, player_color)
                        logger.info("take-back declined gid=%s by=%s", gid, player_color)
                        declined = TakebackDeclined(
                            type="takeback_declined", by=Color(player_color), ply=request["ply"]
                        )
                        await _broadcast(gid, declined)
                    elif isinstance(envelope, OfferRematch):
                        await _announce_rematch(gid, offer_rematch(store, gid, player_color))
                    elif isinstance(envelope, AcceptRematch):
                        await _announce_rematch(gid, accept_rematch(store, gid, player_color))
                    elif isinstance(envelope, DeclineRematch):
                        decline_rematch(store, gid, player_color)
                        logger.info("rematch declined gid=%s by=%s", gid, player_color)
                        await _broadcast(
                            gid, RematchDeclined(type="rematch_declined", by=Color(player_color))
                        )
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
    # 7-day inactivity TTL (no reads or writes), so abandoned games clean
    # themselves up.
    store = modal.Dict.from_name(os.environ["GAMES_STORE"], create_if_missing=True)
    return create_web_app(store=store)
