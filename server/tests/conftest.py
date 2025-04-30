import pytest
from modal_app import app, serve
import websockets
import pytest_asyncio

@pytest.fixture(scope="session")
def ws_server():
    """
    Deploy the backend once for the session,
    then return the public WebSocket URL.
    """
    app.deploy()     # programmatic deploy
    return serve.web_url          # the function's web_url property 

@pytest_asyncio.fixture
async def ws_connect(ws_server):
    """
    Returns an async factory; call it each time you need a new WebSocket.
    All opened connections are closed automatically after the test.
    """
    uri = ws_server.replace("http", "ws") + "/ws"
    opened = []

    async def _new(**kwargs):
        conn = await websockets.connect(uri, open_timeout=10, **kwargs)
        opened.append(conn)
        return conn

    yield _new

    # teardown – close every socket we opened
    for conn in opened:
        await conn.close() 