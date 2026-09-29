"""Flood attacker for bench_server.py's flood section, run as its own process.

    python flood_attacker.py <ws_url> <malformed|schema|out_of_turn> <seconds> [window]

Connects (for `out_of_turn` it seats both colours of its own game and floods
from the side whose turn it is not), prints READY, then pipelines junk frames
for <seconds> with at most <window> unanswered at a time, prints DONE, waits
for the outstanding replies and prints one JSON line:
{"sent", "replies", "codes", "seconds", "rate"}.

It is a separate process so its CPU never competes with the canary game the
runner measures during the flood, as with a remote attacker. Frames are sent
uncompressed, the cheapest option for an attacker.
"""

from __future__ import annotations

import asyncio
import json
import sys
import time

from bench_app import die_with_parent
from websockets.asyncio.client import connect

KW = dict(ping_interval=None, max_size=None, max_queue=None, open_timeout=10, compression=None)
TIMEOUT = 10.0

FRAMES = {
    "malformed": "this is not json {{{",
    "schema": json.dumps({"type": "move", "from": "Zz9", "to": "Aa1"}),
    # a well-formed move from the seated player whose turn it is not
    "out_of_turn": json.dumps({"type": "move", "from": "Ed5", "to": "Ee3"}),
}


async def _recv(ws) -> dict:
    return json.loads(await asyncio.wait_for(ws.recv(), TIMEOUT))


async def _seat_both(url: str):
    """Create and join a game; return the socket that is never on turn, and both."""
    a1 = await connect(url, **KW)
    await a1.send(json.dumps({"type": "create_game"}))
    created = await _recv(a1)
    a2 = await connect(url, **KW)
    await a2.send(json.dumps({"type": "join_game", "gameId": created["gameId"]}))
    for _ in range(3):  # game_joined, game_start, presence
        await _recv(a2)
    for _ in range(2):  # game_start, presence
        await _recv(a1)
    # White moves first and nobody moves, so black is out of turn forever.
    black = a1 if created["color"] == "black" else a2
    return black, [a1, a2]


async def flood(url: str, kind: str, seconds: float, window: int) -> dict:
    if kind == "out_of_turn":
        ws, sockets = await _seat_both(url)
    else:
        ws = await connect(url, **KW)
        sockets = [ws]
    frame = FRAMES[kind]
    slots = asyncio.Semaphore(window)
    replies = 0
    codes: dict[str, int] = {}

    async def reader() -> None:
        nonlocal replies
        async for text in ws:
            replies += 1
            try:
                code = str(json.loads(text).get("code"))
            except ValueError:
                code = "?"
            codes[code] = codes.get(code, 0) + 1
            slots.release()

    reader_task = asyncio.create_task(reader())
    print("READY", flush=True)
    t0 = time.perf_counter()
    deadline = t0 + seconds
    sent = 0
    while time.perf_counter() < deadline:
        await asyncio.wait_for(slots.acquire(), TIMEOUT)
        await ws.send(frame)
        sent += 1
    print("DONE", flush=True)
    drain_until = time.perf_counter() + TIMEOUT
    while replies < sent and time.perf_counter() < drain_until and not reader_task.done():
        await asyncio.sleep(0.001)
    elapsed = time.perf_counter() - t0
    reader_task.cancel()
    for s in sockets:
        try:
            await asyncio.wait_for(s.close(), 2)
        except Exception:
            pass
    return {
        "sent": sent,
        "replies": replies,
        "codes": codes,
        "seconds": elapsed,
        "rate": replies / elapsed if elapsed else 0.0,
    }


def main() -> None:
    die_with_parent()
    url, kind, seconds = sys.argv[1], sys.argv[2], float(sys.argv[3])
    window = int(sys.argv[4]) if len(sys.argv) > 4 else 64
    result = asyncio.run(flood(url, kind, seconds, window))
    print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
