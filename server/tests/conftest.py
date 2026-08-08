import os
import socket
import subprocess
import sys
import time
import urllib.request

import pytest
import pytest_asyncio
import websockets

SERVER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_for_health(url: str, timeout: float = 30.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url + "/health", timeout=1):
                return
        except OSError:
            time.sleep(0.2)
    raise RuntimeError(f"server at {url} did not become healthy within {timeout}s")


@pytest.fixture(scope="session")
def ws_server():
    """
    Return the base HTTP URL of a running backend.

    By default, starts uvicorn locally against create_web_app() — no Modal
    account or deploy needed. Set WS_SERVER_URL to test against an already
    running server instead (e.g. a deployed Modal app).
    """
    external_url = os.environ.get("WS_SERVER_URL")
    if external_url:
        yield external_url.rstrip("/")
        return

    port = _free_port()
    url = f"http://127.0.0.1:{port}"
    proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "modal_app:create_web_app",
            "--factory",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        cwd=SERVER_DIR,
    )
    try:
        _wait_for_health(url)
        yield url
    finally:
        proc.terminate()
        proc.wait(timeout=10)


@pytest_asyncio.fixture
async def ws_connect(ws_server):
    """
    Returns an async factory; call it each time you need a new WebSocket.
    All opened connections are closed automatically after the test.
    """
    uri = ws_server.replace("http", "ws") + "/ws"
    opened = []

    async def _new(**kwargs):
        conn = await websockets.connect(uri, **kwargs)
        opened.append(conn)
        return conn

    yield _new

    # teardown – close every socket we opened
    for conn in opened:
        await conn.close()
