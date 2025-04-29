import modal
import uuid
import random
from fastapi import WebSocket, WebSocketDisconnect
from messages import WebsocketV1MessageEnvelope, CreateGame, GameCreated, JoinGame, GameStart, Error, Color

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
    web_app = fastapi.FastAPI()

    @web_app.get("/health")
    async def health_check():
        return {"status": "healthy"}

    @web_app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket):
        await ws.accept()
        try:
            while True:
                data = await ws.receive_json()
                envelope = WebsocketV1MessageEnvelope.model_validate(data).root
                if isinstance(envelope, CreateGame):
                    gid = str(uuid.uuid4())
                    games[gid] = {"white": ws}
                    turns[gid] = "white"
                    await ws.send_json(GameCreated(type="game_created", gameId=gid).model_dump())
                elif isinstance(envelope, JoinGame):
                    gid = envelope.gameId
                    if gid not in games or "black" in games[gid]:
                        err = Error(type="error", code="invalid_game", message="Cannot join")
                        await ws.send_json(err.model_dump())
                    else:
                        # Randomly assign color to joining player
                        color = "black" if "white" in games[gid] else "white"
                        games[gid][color] = ws
                        # Send GameStart to both players
                        for col, sock in games[gid].items():
                            await sock.send_json(GameStart(type="game_start", color=Color(col)).model_dump(mode="json"))
        except WebSocketDisconnect:
            pass

    return web_app 