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
    GameStart,
    Error,
    Color,
    Move,
    MoveMade,
)

# Mount the local messages.py module into the container so `from messages import …` works
image = (
    modal.Image.debian_slim()
    .pip_install("fastapi[standard]")
    .add_local_python_source("messages")  # see https://modal.com/docs/guide/images#Adding-local-Python-modules [1]
)

app = modal.App("3d-chess-backend")

# gid -> {color: websocket}. games[gid] and turns[gid] are always created and
# deleted together; a missing turns entry for a live game is a bug.
games: dict[str, dict[str, WebSocket]] = {}
turns: dict[str, str] = {}


def _new_game_id() -> str:
    while True:
        gid = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
        if gid not in games:
            return gid


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
    """Detach a socket from its game, deleting the game once it is empty."""
    game = games.get(gid)
    if game is None:
        return
    if game.get(color) is ws:
        del game[color]
    if not game:
        del games[gid]
        del turns[gid]


def create_web_app() -> fastapi.FastAPI:
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
                    await _safe_send(ws, err.model_dump())
                    continue
                try:
                    envelope = WebsocketV1MessageEnvelope.model_validate(data).root
                except ValidationError:
                    err = Error(
                        type="error",
                        code="invalid_message",
                        message="Message does not conform to the protocol schema",
                    )
                    await _safe_send(ws, err.model_dump())
                    continue

                if isinstance(envelope, CreateGame):
                    if gid is not None:
                        err = Error(type="error", code="already_in_game", message="Already in a game")
                        await _safe_send(ws, err.model_dump())
                        continue
                    gid = _new_game_id()
                    # Creator can be white or black, but white always moves first
                    player_color = random.choice(["white", "black"])
                    games[gid] = {player_color: ws}
                    turns[gid] = "white"  # Always white's turn to move first
                    await _safe_send(ws, GameCreated(type="game_created", gameId=gid).model_dump())
                elif isinstance(envelope, JoinGame):
                    if gid is not None:
                        err = Error(type="error", code="already_in_game", message="Already in a game")
                        await _safe_send(ws, err.model_dump())
                        continue
                    game = games.get(envelope.gameId)
                    if game is None:
                        err = Error(type="error", code="invalid_game", message="Cannot join")
                        await _safe_send(ws, err.model_dump())
                        continue
                    # Assign joiner the only remaining color
                    available_colors = [c for c in ("white", "black") if c not in game]
                    if not available_colors:
                        err = Error(type="error", code="game_full", message="Game full")
                        await _safe_send(ws, err.model_dump())
                        continue
                    gid = envelope.gameId
                    player_color = available_colors[0]
                    game[player_color] = ws
                    # Send GameStart to both players, white first
                    for col in ("white", "black"):
                        if col in game:
                            payload = GameStart(type="game_start", color=Color(col)).model_dump(
                                mode="json", exclude_none=True
                            )
                            await _safe_send(game[col], payload)
                elif isinstance(envelope, Move):
                    if gid is None:
                        err = Error(type="error", code="invalid_move", message="Not in a game")
                        await _safe_send(ws, err.model_dump())
                    elif len(games[gid]) < 2:
                        err = Error(
                            type="error",
                            code="game_not_started",
                            message="Both players must be present to move",
                        )
                        await _safe_send(ws, err.model_dump())
                    elif turns[gid] != player_color:
                        err = Error(type="error", code="wrong_turn", message="Not your turn")
                        await _safe_send(ws, err.model_dump())
                    else:
                        # Relay move to both players, using server-tracked color and gid
                        move_made = MoveMade.model_validate(
                            {
                                "type": "move_made",
                                "by": player_color,
                                "from": envelope.from_,
                                "to": envelope.to,
                                "promotion": envelope.promotion,
                            }
                        )
                        turns[gid] = "black" if player_color == "white" else "white"
                        payload = move_made.model_dump(mode="json", by_alias=True, exclude_none=True)
                        for sock in list(games[gid].values()):
                            await _safe_send(sock, payload)
                else:
                    # Structurally valid, but a message type only the server may send
                    err = Error(
                        type="error",
                        code="invalid_message",
                        message=f"Clients may not send {envelope.type} messages",
                    )
                    await _safe_send(ws, err.model_dump())
        except WebSocketDisconnect:
            pass
        finally:
            # Detach this connection from its game so later broadcasts don't hit
            # a dead socket and finished games don't accumulate in memory.
            if gid is not None and player_color is not None:
                _remove_player(gid, player_color, ws)

    return web_app


@app.function(image=image, include_source=True, max_containers=1, timeout=3600)
@modal.concurrent(max_inputs=1000)
@modal.asgi_app()
def serve() -> fastapi.FastAPI:
    return create_web_app()
