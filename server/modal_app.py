import modal
import uuid
import random
from fastapi import WebSocket, WebSocketDisconnect
from messages import WebsocketV1MessageEnvelope, CreateGame, GameCreated, JoinGame, GameStart, Error, Color, Move, MoveMade, By

# Mount the local messages.py module into the container so `from messages import …` works
image = (
    modal.Image.debian_slim()
    .pip_install("fastapi[standard]")
    .add_local_python_source("messages")  # see https://modal.com/docs/guide/images#Adding-local-Python-modules [1]
)

app = modal.App("3d-chess-backend")

games: dict[str, dict[str, WebSocket]] = {}
turns: dict[str, str] = {}

@app.function(image=image, include_source=True, max_containers=1)
@modal.concurrent(max_inputs=1000)
@modal.asgi_app()
def serve() -> "fastapi.FastAPI":
    import fastapi
    import pydantic
    web_app = fastapi.FastAPI()

    @web_app.get("/health")
    async def health_check():
        return {"status": "healthy"}

    @web_app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket):
        await ws.accept()
        print(f"[modal] pydantic version: {pydantic.__version__}")
        player_color = None  # Track the player's color for this connection
        gid = None  # Track the game id for this connection
        try:
            while True:
                data = await ws.receive_json()
                envelope = WebsocketV1MessageEnvelope.model_validate(data).root
                if isinstance(envelope, CreateGame):
                    gid = str(uuid.uuid4())
                    # Creator can be white or black, but white always moves first
                    player_color = random.choice(["white", "black"])
                    games[gid] = {player_color: ws}
                    turns[gid] = "white"  # Always white's turn to move first
                    await ws.send_json(GameCreated(type="game_created", gameId=gid).model_dump())
                elif isinstance(envelope, JoinGame):
                    gid = envelope.gameId
                    if gid not in games:
                        err = Error(type="error", code="invalid_game", message="Cannot join")
                        await ws.send_json(err.model_dump())
                    else:
                        # Assign joiner the only remaining color
                        available_colors = [c for c in ("white", "black") if c not in games[gid]]
                        if not available_colors:
                            err = Error(type="error", code="invalid_game", message="Game full")
                            await ws.send_json(err.model_dump())
                        else:
                            player_color = available_colors[0]
                            games[gid][player_color] = ws
                            # Send GameStart to both players, white first
                            for col in ("white", "black"):
                                if col in games[gid]:
                                    sock = games[gid][col]
                                    await sock.send_json(GameStart(type="game_start", color=Color(col)).model_dump(mode="json"))
                elif isinstance(envelope, Move):
                    if gid is None or player_color is None or gid not in games:
                        err = Error(type="error", code="invalid_move", message="Invalid game or player state")
                        await ws.send_json(err.model_dump())
                    elif turns[gid] != player_color:
                        err = Error(type="error", code="wrong_turn", message="Not your turn")
                        await ws.send_json(err.model_dump())
                    else:
                        # Relay move to both players, using server-tracked color and gid
                        payload = {
                            "type": "move_made",
                            "by": player_color,
                            "from": envelope.from_,
                            "to": envelope.to,
                            "promotion": envelope.promotion,
                        }
                        move_made = MoveMade.model_validate(payload)
                        for sock in games[gid].values():
                            await sock.send_json(move_made.model_dump(mode="json", by_alias=True))
                        turns[gid] = "black" if player_color == "white" else "white"
        except WebSocketDisconnect:
            # Optionally: clean up player from games here if desired
            pass

    return web_app 