import modal
import random
import string
import fastapi
from fastapi import WebSocket, WebSocketDisconnect
from pydantic import ValidationError
from messages import (
    WebsocketV1MessageEnvelope,
    CreateGame,
    GameCreated,
    JoinGame,
    RejoinGame,
    GameStart,
    GameState,
    Error,
    Color,
    Move,
    MoveMade,
)

# Mount the local messages.py module into the container so `from messages import …` works
image = (
    modal.Image.debian_slim(python_version="3.13")
    .pip_install("fastapi[standard]>=0.115.4")
    .add_local_python_source("messages")  # see https://modal.com/docs/guide/images#Adding-local-Python-modules [1]
)

app = modal.App("3d-chess-backend")

# Live sockets only: gid -> {color: websocket}. The durable game record (seats
# claimed, move history) lives in the store passed to create_web_app, so a
# disconnect only detaches the socket here — the game itself survives and a
# player can rejoin later.
connections: dict[str, dict[str, WebSocket]] = {}


def _new_game_id(store) -> str:
    while True:
        gid = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
        if gid not in store:
            return gid


def _turn(record: dict) -> str:
    # White moves first; turn alternates with each recorded move.
    return "white" if len(record["moves"]) % 2 == 0 else "black"


async def _safe_send(ws: WebSocket, payload: dict) -> bool:
    """Send to a socket that may have closed.

    A peer's dead socket must not take down the other player's connection;
    the False return feeds the caller's cleanup, it is not silently ignored.
    """
    try:
        await ws.send_json(payload)
        return True
    except Exception:
        return False


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


def create_web_app(store=None) -> fastapi.FastAPI:
    # The store holds each game's durable record: {"seats": [colors claimed],
    # "moves": [move dicts in wire format]}. In production it is a modal.Dict,
    # which returns deserialized copies — every mutation must read-modify-write
    # and write back before any await, so concurrent handlers on the shared
    # event loop can't interleave a stale write. Tests pass a plain dict.
    if store is None:
        store = {}
    web_app = fastapi.FastAPI()

    @web_app.get("/health")
    async def health_check():
        return {"status": "healthy"}

    @web_app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket):
        await ws.accept()
        player_color = None  # Track the player's color for this connection
        gid = None  # Track the game id for this connection
        try:
            while True:
                try:
                    data = await ws.receive_json()
                except ValueError:
                    # Frame was not valid JSON
                    err = Error(type="error", code="invalid_message", message="Message is not valid JSON")
                    await _safe_send(ws, err.model_dump(mode="json"))
                    continue
                try:
                    envelope = WebsocketV1MessageEnvelope.model_validate(data).root
                except ValidationError:
                    err = Error(
                        type="error",
                        code="invalid_message",
                        message="Message does not conform to the protocol schema",
                    )
                    await _safe_send(ws, err.model_dump(mode="json"))
                    continue

                if isinstance(envelope, CreateGame):
                    if gid is not None:
                        err = Error(type="error", code="already_in_game", message="Already in a game")
                        await _safe_send(ws, err.model_dump(mode="json"))
                        continue
                    gid = _new_game_id(store)
                    # Creator can be white or black, but white always moves first
                    player_color = random.choice(["white", "black"])
                    store[gid] = {"seats": [player_color], "moves": []}
                    connections[gid] = {player_color: ws}
                    created = GameCreated(type="game_created", gameId=gid, color=Color(player_color))
                    await _safe_send(ws, created.model_dump(mode="json"))
                elif isinstance(envelope, JoinGame):
                    if gid is not None:
                        err = Error(type="error", code="already_in_game", message="Already in a game")
                        await _safe_send(ws, err.model_dump(mode="json"))
                        continue
                    record = store.get(envelope.gameId)
                    if record is None:
                        err = Error(type="error", code="invalid_game", message="Cannot join")
                        await _safe_send(ws, err.model_dump(mode="json"))
                        continue
                    # Seats are claimed for the life of the game, so a full game
                    # stays full even while a claimant is disconnected.
                    available_colors = [c for c in ("white", "black") if c not in record["seats"]]
                    if not available_colors:
                        err = Error(type="error", code="game_full", message="Game full")
                        await _safe_send(ws, err.model_dump(mode="json"))
                        continue
                    gid = envelope.gameId
                    player_color = available_colors[0]
                    record["seats"].append(player_color)
                    store[gid] = record
                    conns = connections.setdefault(gid, {})
                    conns[player_color] = ws
                    # Send GameStart to the connected players, white first
                    for col in ("white", "black"):
                        sock = conns.get(col)
                        if sock is not None:
                            payload = GameStart(type="game_start", color=Color(col)).model_dump(
                                mode="json", exclude_none=True
                            )
                            await _safe_send(sock, payload)
                elif isinstance(envelope, RejoinGame):
                    if gid is not None:
                        err = Error(type="error", code="already_in_game", message="Already in a game")
                        await _safe_send(ws, err.model_dump(mode="json"))
                        continue
                    record = store.get(envelope.gameId)
                    if record is None:
                        err = Error(type="error", code="invalid_game", message="Cannot rejoin")
                        await _safe_send(ws, err.model_dump(mode="json"))
                        continue
                    if envelope.color.value not in record["seats"]:
                        err = Error(type="error", code="invalid_rejoin", message="No such seat to rejoin")
                        await _safe_send(ws, err.model_dump(mode="json"))
                        continue
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
                    await _safe_send(ws, state.model_dump(mode="json", by_alias=True, exclude_none=True))
                    if old_ws is not None and old_ws is not ws:
                        try:
                            await old_ws.close()
                        except Exception:
                            pass
                elif isinstance(envelope, Move):
                    record = store.get(gid) if gid is not None else None
                    if record is None:
                        err = Error(type="error", code="invalid_move", message="Not in a game")
                        await _safe_send(ws, err.model_dump(mode="json"))
                    elif len(record["seats"]) < 2:
                        err = Error(
                            type="error",
                            code="game_not_started",
                            message="Both players must have joined to move",
                        )
                        await _safe_send(ws, err.model_dump(mode="json"))
                    elif _turn(record) != player_color:
                        err = Error(type="error", code="wrong_turn", message="Not your turn")
                        await _safe_send(ws, err.model_dump(mode="json"))
                    else:
                        # Record the move (write back before any await), then
                        # relay to whichever players are connected; an offline
                        # opponent catches up via game_state on rejoin.
                        move_dict = {"by": player_color, "from": envelope.from_, "to": envelope.to}
                        if envelope.promotion is not None:
                            move_dict["promotion"] = envelope.promotion.value
                        record["moves"].append(move_dict)
                        store[gid] = record
                        move_made = MoveMade.model_validate({"type": "move_made", **move_dict})
                        payload = move_made.model_dump(mode="json", by_alias=True, exclude_none=True)
                        for sock in list(connections.get(gid, {}).values()):
                            await _safe_send(sock, payload)
                else:
                    # Structurally valid, but a message type only the server may send
                    err = Error(
                        type="error",
                        code="invalid_message",
                        message=f"Clients may not send {envelope.type} messages",
                    )
                    await _safe_send(ws, err.model_dump(mode="json"))
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
