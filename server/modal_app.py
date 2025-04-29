import modal
import uuid
from fastapi import WebSocket, WebSocketDisconnect
from messages import WebsocketV1MessageEnvelope, CreateGame, GameCreated

# Mount the local messages.py module into the container so `from messages import …` works
image = (
    modal.Image.debian_slim()
    .pip_install("fastapi[standard]")
    .add_local_python_source("messages")  # see https://modal.com/docs/guide/images#Adding-local-Python-modules [1]
)

app = modal.App("3d-chess-backend")

games: dict[str, WebSocket] = {}

@app.function(image=image, include_source=True)
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
                    games[gid] = ws
                    await ws.send_json(GameCreated(type="game_created", gameId=gid).model_dump())
        except WebSocketDisconnect:
            pass

    return web_app 