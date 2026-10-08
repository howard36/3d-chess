"""Benchmark runner for the 3D-chess server (FastAPI WebSocket relay).

Run from the repository root:

    uv run --project server python server/bench/bench_server.py --out bench.json \\
        [--quick] [--only decode,store,...]

A full run takes roughly 35-45 s on a 4-core VM; `--quick` is a smoke run of a
few seconds. `--only` takes comma-separated section keys (see SECTION_KEYS)
and starts only the servers those sections need. Every network await has a
timeout and every section a wall-clock cap, so a failed or slow case becomes a
row (or a failed section) rather than a hung run. Per-section wall time goes to
raw["timings"] and a summary to stderr.

Each section carries `metrics`, aligned 1:1 with `rows`: null, or the row's
primary number as {"key", "value", "unit": "ms"|"per_s"|"bytes",
"better": "lower"|"higher"}. `key` names the row stably across runs (never a
measured value) and is unique within its section, so runs can be compared row
by row on (section title, key).

Sections:
  A. In-process (no sockets): decode+validate, store ops, rejoin payload build.
  B. Live over WebSockets (uvicorn subprocesses): baselines, move round trips,
     concurrency across store models, rejoin into long histories.
  C. Adversarial/unusual (live): junk floods, oversized/nested frames, seat
     contention, connection churn.

Store models (see bench_app.py): `dict` (local dev), `pickle` (copy-on-
read/write like modal.Dict's serialization, no latency), `latent:<ms>`
(pickle plus a blocking sleep per store call, a MODEL of modal.Dict's sync RPC
with an ASSUMED latency; the real modal.Dict latency is not measured here).
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import inspect
import json
import os
import pickle
import platform
import shutil
import signal
import socket
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.request
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

import websockets
from websockets.asyncio.client import connect as ws_connect
from websockets.exceptions import ConnectionClosed

SERVER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BENCH_DIR = os.path.dirname(os.path.abspath(__file__))
ATTACKER = os.path.join(BENCH_DIR, "flood_attacker.py")
for _p in (SERVER_DIR, BENCH_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)

# modal_app.SEAT_REPLACED_CLOSE_CODE: part of the protocol contract with the
# client, so it is safe to name here without importing the (slow) server module.
SEAT_REPLACED = 4001

# The knight shuffle used everywhere a move is needed: shape-valid coordinates
# that also form a legal repeating knight move in the real game. The server
# checks only shape and turn parity, so content never affects cost.
WHITE_SHUFFLE = (("Ab1", "Aa3"), ("Aa3", "Ab1"))
BLACK_SHUFFLE = (("Ed5", "Ee3"), ("Ee3", "Ed5"))


def shuffle_move(ply: int) -> dict[str, str]:
    """A shape-valid move for the given ply index (0 = white's first)."""
    seq = WHITE_SHUFFLE if ply % 2 == 0 else BLACK_SHUFFLE
    frm, to = seq[(ply // 2) % 2]
    return {"type": "move", "from": frm, "to": to}


# The shuffle repeats every 4 plies; pre-serialized for the hot loops.
MOVE_FRAMES = tuple(json.dumps(shuffle_move(p)) for p in range(4))


def _app_modules():
    """Import the server modules lazily: they pull in FastAPI and Modal (~0.5 s),
    which only the in-process sections need."""
    import bench_app

    import messages
    import modal_app

    return modal_app, messages, bench_app


# --- Formatting ---------------------------------------------------------------


def _num(x: float) -> str:
    """3 significant figures, without scientific notation for sane magnitudes."""
    if x == 0:
        return "0"
    s = f"{x:.3g}"
    if "e" in s or "E" in s:
        s = f"{x:,.0f}" if abs(x) >= 1 else f"{x:.3g}"
    return s


def fmt_dur(ns: float | None) -> str:
    if ns is None:
        return "—"
    if ns < 1_000:
        return f"{_num(ns)} ns"
    if ns < 1_000_000:
        return f"{_num(ns / 1_000)} µs"
    if ns < 1_000_000_000:
        return f"{_num(ns / 1_000_000)} ms"
    return f"{_num(ns / 1_000_000_000)} s"


def fmt_tput(per_s: float, unit: str = "ops/s") -> str:
    if per_s >= 1_000:
        return f"{_num(per_s / 1_000)}k {unit}"
    return f"{_num(per_s)} {unit}"


def fmt_bytes(b: float) -> str:
    if b < 1024:
        return f"{int(b)} B"
    if b < 1024**2:
        return f"{_num(b / 1024)} KiB"
    return f"{_num(b / 1024**2)} MiB"


def esc(cell: str) -> str:
    return str(cell).replace("|", "\\|")


# --- Statistics ---------------------------------------------------------------

# A tail percentile is only shown when there are enough samples for it to be
# distinct from the max; below that the cell reads "—" (raw keeps the value).
MIN_N_P95 = 20
MIN_N_P99 = 100


def percentile(sorted_ns: Sequence[float], q: float) -> float:
    if not sorted_ns:
        return 0.0
    if len(sorted_ns) == 1:
        return sorted_ns[0]
    idx = min(len(sorted_ns) - 1, max(0, int(round(q / 100 * len(sorted_ns) + 0.5)) - 1))
    return sorted_ns[idx]


class Stats:
    """Latency distribution over a list of nanosecond samples."""

    def __init__(self, samples: Sequence[float]) -> None:
        self.samples = sorted(samples)
        self.n = len(self.samples)
        if self.n:
            self.median = statistics.median(self.samples)
            self.p95 = percentile(self.samples, 95)
            self.p99 = percentile(self.samples, 99)
            self.max = self.samples[-1]
            self.mean = statistics.fmean(self.samples)
        else:
            self.median = self.p95 = self.p99 = self.max = self.mean = None

    def p95_cell(self) -> str:
        return fmt_dur(self.p95) if self.n >= MIN_N_P95 else "—"

    def p99_cell(self) -> str:
        return fmt_dur(self.p99) if self.n >= MIN_N_P99 else "—"

    def latency_cells(self) -> list[str]:
        return [
            fmt_dur(self.median),
            self.p95_cell(),
            self.p99_cell(),
            fmt_dur(self.max),
            str(self.n),
        ]

    def raw(self) -> dict[str, float | None]:
        return {
            "median_ns": self.median,
            "p95_ns": self.p95,
            "p99_ns": self.p99,
            "max_ns": self.max,
            "mean_ns": self.mean,
            "n": self.n,
        }


# --- Tables and metrics ---------------------------------------------------------


def m_ms(key: str, ns: float | None) -> dict | None:
    """Row metric: a duration, lower is better."""
    if ns is None:
        return None
    return {"key": key, "value": round(ns / 1e6, 6), "unit": "ms", "better": "lower"}


def m_rate(key: str, per_s: float | None) -> dict | None:
    """Row metric: a throughput, higher is better."""
    if not per_s:
        return None
    return {"key": key, "value": round(per_s, 2), "unit": "per_s", "better": "higher"}


class Table:
    """One output section: rows of pre-formatted cells plus a metric per row."""

    def __init__(
        self,
        key: str,
        title: str,
        intro: str,
        columns: list[str],
        align: list[str],
        notes: list[str] | None = None,
    ) -> None:
        self.key = key
        self.title = title
        self.intro = intro
        self.columns = columns
        self.align = align
        self.notes = list(notes or [])
        self.rows: list[list[str]] = []
        self.metrics: list[dict | None] = []

    def add(self, cells: list[str], metric: dict | None = None) -> None:
        if len(cells) != len(self.columns):
            raise ValueError(f"{self.key}: row has {len(cells)} cells, want {len(self.columns)}")
        self.rows.append([str(c) for c in cells])
        self.metrics.append(metric)

    def to_dict(self) -> dict:
        keys = [m["key"] for m in self.metrics if m is not None]
        if len(keys) != len(set(keys)):
            raise ValueError(f"{self.key}: duplicate metric keys {keys}")
        return {
            "key": self.key,
            "title": self.title,
            "intro": self.intro,
            "columns": self.columns,
            "align": self.align,
            "rows": [[esc(c) for c in row] for row in self.rows],
            "metrics": self.metrics,
            "notes": self.notes,
        }


LAT_COLUMNS = ["Case", "Workload", "median", "p95", "p99", "max", "n", "Notes"]
LAT_ALIGN = ["l", "l", "r", "r", "r", "r", "r", "l"]


@dataclass
class Ctx:
    quick: bool
    servers: dict[str, LiveServer]


# =============================================================================
# Section A: in-process
# =============================================================================


def bench_decode_validate(ctx: Ctx) -> tuple[Table, dict]:
    """json.loads + envelope validate, as the handler does per message."""
    _, messages, _ = _app_modules()
    envelope = messages.WebsocketV1MessageEnvelope
    n = 1_000 if ctx.quick else 5_000
    n_big = 20 if ctx.quick else 100

    def decode_validate(text: str) -> None:
        try:
            envelope.model_validate(json.loads(text))
        except ValueError:  # JSONDecodeError and ValidationError both subclass it
            pass

    cases = [
        ("create_game", {"type": "create_game"}, "valid message", n),
        ("join_game", {"type": "join_game", "gameId": "ABC123"}, "valid message", n),
        (
            "rejoin_game",
            {"type": "rejoin_game", "gameId": "ABC123", "color": "white", "takeover": True},
            "valid message",
            n,
        ),
        ("move", {"type": "move", "from": "Ab1", "to": "Aa3"}, "valid message", n),
        (
            "move + promotion",
            {"type": "move", "from": "Ea4", "to": "Ea5", "promotion": "Q"},
            "valid message",
            n,
        ),
        ("unknown type", {"type": "spaghetti"}, "ValidationError", n),
        ("bad coordinate", {"type": "move", "from": "Zz9", "to": "Aa1"}, "ValidationError", n),
        ("missing field", {"type": "move", "from": "Aa1"}, "ValidationError", n),
        (
            "1 MiB junk string",
            {"type": "join_game", "gameId": "x" * (1 << 20)},
            "schema-valid huge gameId (rejected later by claim_seat)",
            n_big,
        ),
    ]
    t = Table(
        "decode",
        "Decode + validate (in-process)",
        "Every frame the relay accepts costs a `json.loads` plus "
        "`WebsocketV1MessageEnvelope.model_validate` before any game logic runs "
        "(`receive_json` then validate). This is the fixed per-message CPU floor.",
        LAT_COLUMNS,
        LAT_ALIGN,
        [
            "A rejected message still pays decode + a full validation against the 11-member "
            "union (it has no discriminator), so a reject can cost more than an accept.",
        ],
    )
    raw: dict[str, Any] = {}
    for name, obj, note, count in cases:
        text = json.dumps(obj)
        for _ in range(min(50, count)):  # warm up
            decode_validate(text)
        samples = []
        for _ in range(count):
            t0 = time.perf_counter_ns()
            decode_validate(text)
            samples.append(time.perf_counter_ns() - t0)
        st = Stats(samples)
        t.add(
            [name, f"{len(text.encode()):,} B frame", *st.latency_cells(), note],
            m_ms(name, st.median),
        )
        raw[name] = st.raw()
    return t, raw


def _game_record(n_moves: int) -> dict:
    moves = []
    for i in range(n_moves):
        m = shuffle_move(i)
        moves.append({"by": "white" if i % 2 == 0 else "black", "from": m["from"], "to": m["to"]})
    return {"seats": ["white", "black"], "moves": moves}


def bench_store_ops(ctx: Ctx) -> tuple[Table, dict]:
    """record_move / claim_seat / find_seat / create_game under dict and pickle."""
    modal_app, messages, bench_app = _app_modules()
    quick = ctx.quick
    hist_lengths = (0, 100, 1_000) if quick else (0, 100, 1_000, 5_000)
    n_small = 1_000 if quick else 5_000
    game_ply = 200
    game_runs = 3 if quick else 10
    big_store_games = 1_000 if quick else 10_000

    def n_rec(length: int) -> int:
        if quick:
            return 200
        return 1_000 if length <= 1_000 else 300

    mv = messages.Move.model_validate({"type": "move", "from": "Ab1", "to": "Aa3"})
    t = Table(
        "store",
        "Store operations (in-process)",
        "The synchronous store ops the handler calls per request. In production the store "
        "is a `modal.Dict` that returns a **copy** on every read, so `record_move` reads and "
        "rewrites the whole game record each move — the `pickle` model shows that cost "
        "(the `dict` model is local dev, where the record is shared by reference).",
        LAT_COLUMNS,
        LAT_ALIGN,
        [
            "`record_move` cost is flat under `dict` (a shared reference) but grows with history "
            "length under `pickle` (unpickle N moves, repickle N+1) — the source of the per-game "
            "O(n²) ARCHITECTURE.md warns about.",
            "`find_seat`/`claim_seat`/`create_game` are O(1) in game count under both models; "
            "modal.Dict's real cost is network round trips, not store size, and is not "
            "modelled here.",
        ],
    )
    raw: dict[str, Any] = {}

    for model in ("dict", "pickle"):
        # record_move at fixed history lengths
        for length in hist_lengths:
            store = bench_app.make_store(model)
            gid = "BENCH0"
            base = _game_record(length)
            base_blob = pickle.dumps(base, protocol=pickle.HIGHEST_PROTOCOL)
            if model == "pickle":
                store.raw_put(gid, base_blob)
            else:
                store[gid] = base
            color = "white" if length % 2 == 0 else "black"
            samples = []
            for _ in range(n_rec(length)):
                # Reset to exactly `length` moves outside the timed region. For
                # `dict` the stored record is the same object record_move
                # appends to, so trimming the list restores it.
                if model == "pickle":
                    store.raw_put(gid, base_blob)
                else:
                    del store[gid]["moves"][length:]
                t0 = time.perf_counter_ns()
                modal_app.record_move(store, gid, color, mv)
                samples.append(time.perf_counter_ns() - t0)
            st = Stats(samples)
            key = f"record_move · {model} · {length}-move history"
            t.add(
                [
                    "record_move",
                    f"{model} · {length}-move history",
                    *st.latency_cells(),
                    "get+append+set",
                ],
                m_ms(key, st.median),
            )
            raw[f"record_move.{model}.{length}"] = st.raw()

        # a whole game's record_moves, back to back
        game_totals = []
        for _ in range(game_runs):
            store = bench_app.make_store(model)
            store["G0"] = {"seats": ["white", "black"], "moves": []}
            t0 = time.perf_counter_ns()
            for i in range(game_ply):
                modal_app.record_move(store, "G0", "white" if i % 2 == 0 else "black", mv)
            game_totals.append(time.perf_counter_ns() - t0)
        st = Stats(game_totals)
        note = (
            "O(n²) per game: each move copies the whole record"
            if model == "pickle"
            else "O(n) per game: constant per move (record shared by reference)"
        )
        t.add(
            [
                "200-ply game",
                f"{model} · {game_ply} record_moves total",
                fmt_dur(st.median),
                "—",
                "—",
                fmt_dur(st.max),
                str(st.n),
                note,
            ],
            m_ms(f"200-ply game · {model}", st.median),
        )
        raw[f"game200.{model}"] = st.raw()

        # create/claim/find into a store already holding many games
        store = bench_app.make_store(model)
        one_seat = {"seats": ["white"], "moves": []}
        one_seat_blob = pickle.dumps(one_seat, protocol=pickle.HIGHEST_PROTOCOL)
        for i in range(big_store_games):
            key = f"{i:06d}"
            if model == "pickle":
                store.raw_put(key, one_seat_blob)
            else:
                store[key] = {"seats": ["white"], "moves": []}
        size = f"{model} · {big_store_games:,} games"

        samples = []
        for _ in range(n_small):
            t0 = time.perf_counter_ns()
            modal_app.find_seat(store, "000000", "white")
            samples.append(time.perf_counter_ns() - t0)
        st = Stats(samples)
        t.add(
            ["find_seat", size, *st.latency_cells(), "1 get"],
            m_ms(f"find_seat · {model}", st.median),
        )
        raw[f"find_seat.{model}"] = st.raw()

        samples = []
        free_key = "000001"
        for i in range(n_small):
            if model == "pickle":
                store.raw_put(free_key, one_seat_blob)
            else:
                store[free_key] = {"seats": ["white"], "moves": []}
            t0 = time.perf_counter_ns()
            modal_app.claim_seat(store, free_key, f"c{i}")
            samples.append(time.perf_counter_ns() - t0)
        st = Stats(samples)
        t.add(
            ["claim_seat", size, *st.latency_cells(), "get+set"],
            m_ms(f"claim_seat · {model}", st.median),
        )
        raw[f"claim_seat.{model}"] = st.raw()

        samples = []
        for _ in range(n_small):
            t0 = time.perf_counter_ns()
            modal_app.create_game(store)
            samples.append(time.perf_counter_ns() - t0)
        st = Stats(samples)
        t.add(
            ["create_game", size, *st.latency_cells(), "membership + set"],
            m_ms(f"create_game · {model}", st.median),
        )
        raw[f"create_game.{model}"] = st.raw()
    return t, raw


def bench_rejoin_payload(ctx: Ctx) -> tuple[Table, dict]:
    """Build the game_state payload the handler sends on rejoin."""
    _, messages, _ = _app_modules()
    lengths = (100, 1_000, 5_000) if ctx.quick else (100, 1_000, 5_000, 20_000)
    t = Table(
        "rejoin-payload",
        "Rejoin payload build (in-process)",
        "On `rejoin_game` (and a reclaimed `join_game`) the handler re-validates the whole "
        "history into a `game_state` and serializes it. With no draw rules a game's history "
        "is unbounded, so this grows without limit.",
        LAT_COLUMNS,
        LAT_ALIGN,
        ["Cost is linear in history length; payload bytes scale the same way."],
    )
    raw: dict[str, Any] = {}
    for length in lengths:
        payload_in = {
            "type": "game_state",
            "color": "white",
            "started": True,
            "moves": _game_record(length)["moves"],
        }
        if length <= 1_000:
            n = 100
        else:
            n = 10 if ctx.quick or length >= 20_000 else 30
        payload_bytes = 0
        samples = []
        for _ in range(n):
            t0 = time.perf_counter_ns()
            gs = messages.GameState.model_validate(payload_in)
            dumped = gs.model_dump(mode="json", by_alias=True, exclude_none=True)
            text = json.dumps(dumped)
            samples.append(time.perf_counter_ns() - t0)
            payload_bytes = len(text.encode())
        st = Stats(samples)
        key = f"{length:,} moves"
        t.add(
            [
                key,
                f"validate+dump+json → {fmt_bytes(payload_bytes)}",
                *st.latency_cells(),
                "sent on every rejoin",
            ],
            m_ms(key, st.median),
        )
        raw[f"rejoin_payload.{length}"] = {**st.raw(), "payload_bytes": payload_bytes}
    return t, raw


# =============================================================================
# Live server plumbing
# =============================================================================


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def rss_kb(pid: int) -> int | None:
    try:
        with open(f"/proc/{pid}/status") as fh:
            for line in fh:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1])
    except OSError:
        return None
    return None


def child_env(**extra: str) -> dict[str, str]:
    """Environment for spawned processes: they die with this runner (bench_app)."""
    return dict(os.environ, BENCH_PARENT_PID=str(os.getpid()), **extra)


class LiveServer:
    """A uvicorn subprocess running bench_app with the given store model."""

    def __init__(self, name: str, store_model: str, logdir: str) -> None:
        self.name = name
        self.store_model = store_model
        self.log_path = os.path.join(logdir, f"uvicorn-{name.replace(':', '_')}.log")
        self.port = free_port()
        self.http = f"http://127.0.0.1:{self.port}"
        self.ws = f"ws://127.0.0.1:{self.port}/ws"
        self.proc: subprocess.Popen | None = None
        self._log = None

    def start(self) -> None:
        self._log = open(self.log_path, "w")
        self.proc = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "bench_app:create_bench_app",
                "--factory",
                "--app-dir",
                BENCH_DIR,
                "--host",
                "127.0.0.1",
                "--port",
                str(self.port),
                "--log-level",
                "info",
            ],
            cwd=SERVER_DIR,
            env=child_env(BENCH_STORE=self.store_model, APP_VERSION="bench"),
            stdout=self._log,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
        )

    def wait_ready(self, timeout: float = 30.0) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.proc is None or self.proc.poll() is not None:
                raise RuntimeError(f"uvicorn ({self.name}) exited early; see {self.log_path}")
            if health_ok(self.http, timeout=1):
                return
            time.sleep(0.05)
        raise RuntimeError(f"server ({self.name}) not healthy within {timeout}s")

    def rss_kb(self) -> int | None:
        return rss_kb(self.proc.pid) if self.proc else None

    def cpu_s(self) -> float | None:
        """User+system CPU seconds the server process has used so far (Linux)."""
        try:
            with open(f"/proc/{self.proc.pid}/stat") as fh:
                fields = fh.read().rsplit(")", 1)[1].split()
            return (int(fields[11]) + int(fields[12])) / os.sysconf("SC_CLK_TCK")
        except (OSError, AttributeError, IndexError, ValueError):
            return None

    def health_latency_ns(self) -> float:
        t0 = time.perf_counter_ns()
        with urllib.request.urlopen(self.http + "/health", timeout=5):
            pass
        return time.perf_counter_ns() - t0

    def stop(self) -> None:
        if self.proc is not None and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=5)
        if self._log is not None:
            self._log.close()
            self._log = None


# Server roles -> store model. `dict` serves the baseline/load sections; `adv`
# is a separate dict server for the adversarial ones, so their tracebacks,
# retained games and RSS never touch the load measurements.
SERVER_MODELS = {"dict": "dict", "pickle": "pickle", "latent:2": "latent:2", "adv": "dict"}

CONNECT_KW = dict(ping_interval=None, max_size=None, max_queue=None, open_timeout=10)
RECV_TIMEOUT = 15.0
SECTION_TIMEOUT = 180.0


def health_ok(url: str, timeout: float = 3) -> bool:
    try:
        with urllib.request.urlopen(url + "/health", timeout=timeout):
            return True
    except OSError:
        return False


async def recv_json(ws: Any, timeout: float = RECV_TIMEOUT) -> dict:
    text = await asyncio.wait_for(ws.recv(), timeout)
    return json.loads(text)


async def setup_game(url: str, **connect_kw: Any) -> dict:
    """Create + join a game; return the connected sockets and colours."""
    kw = {**CONNECT_KW, **connect_kw}
    w = await ws_connect(url, **kw)
    await w.send(json.dumps({"type": "create_game"}))
    created = await recv_json(w)
    gid, wcolor = created["gameId"], created["color"]
    b = await ws_connect(url, **kw)
    await b.send(json.dumps({"type": "join_game", "gameId": gid}))
    for _ in range(3):  # joiner: game_joined, game_start, presence
        await recv_json(b)
    for _ in range(2):  # creator: game_start, presence
        await recv_json(w)
    white_ws, black_ws = (w, b) if wcolor == "white" else (b, w)
    return {
        "w": w,
        "b": b,
        "white": white_ws,
        "black": black_ws,
        "gid": gid,
        "creator_color": wcolor,
        "ply": 0,
    }


async def play_moves(game: dict, n_moves: int, collect: list[float] | None = None) -> int:
    """Play n_moves closed-loop; return how many completed. Records mover echo latency."""
    white_ws, black_ws = game["white"], game["black"]
    done = 0
    for _ in range(n_moves):
        ply = game["ply"]
        mover = white_ws if ply % 2 == 0 else black_ws
        other = black_ws if ply % 2 == 0 else white_ws
        t0 = time.perf_counter_ns()
        await mover.send(MOVE_FRAMES[ply % 4])
        echo = await recv_json(mover)  # own echo
        if collect is not None:
            collect.append(time.perf_counter_ns() - t0)
        if echo.get("type") != "move_made":
            raise RuntimeError(f"expected move_made, got {echo}")
        await recv_json(other)  # drain opponent copy
        game["ply"] = ply + 1
        done += 1
    return done


async def wait_own_echo(ws: Any, color: str, timeout: float = RECV_TIMEOUT) -> None:
    """Read until this seat's own move_made, skipping anything queued before it
    (the opponent's previous move, presence, a rejoin's game_state)."""
    while True:
        m = json.loads(await asyncio.wait_for(ws.recv(), timeout))
        kind = m.get("type")
        if kind == "move_made" and m.get("by") == color:
            return
        if kind == "error":
            raise RuntimeError(f"server rejected a move: {m.get('code')}")


async def close_all(*socks: Any) -> None:
    for s in socks:
        with contextlib.suppress(Exception):
            await asyncio.wait_for(s.close(), 5)


async def canary_ok(url: str) -> bool:
    """True if the server can still run a fresh create/join/move end to end."""
    try:
        game = await setup_game(url)
    except Exception:
        return False
    try:
        return await play_moves(game, 1) == 1
    except Exception:
        return False
    finally:
        await close_all(game["w"], game["b"])


async def healthy_after(server: LiveServer) -> bool:
    return health_ok(server.http) and await canary_ok(server.ws)


# =============================================================================
# Section B: live baselines, move RTT, concurrency, rejoin
# =============================================================================


async def bench_baselines(ctx: Ctx) -> tuple[Table, dict]:
    server = ctx.servers["dict"]
    n = 100 if ctx.quick else 300
    n_setup = 30 if ctx.quick else 100
    t = Table(
        "baselines",
        "Live baselines",
        "Round-trip cost of the primitive operations over a real uvicorn WebSocket "
        "connection on loopback (`dict` store). These bound everything else.",
        LAT_COLUMNS,
        LAT_ALIGN,
        ["Loopback only; a real client adds internet RTT on top of every row."],
    )
    raw: dict[str, Any] = {}

    st = Stats([server.health_latency_ns() for _ in range(n)])
    t.add(
        ["GET /health", "HTTP round trip", *st.latency_cells(), "liveness probe"],
        m_ms("GET /health", st.median),
    )
    raw["health"] = st.raw()

    samples = []
    for _ in range(n):
        t0 = time.perf_counter_ns()
        c = await ws_connect(server.ws, **CONNECT_KW)
        samples.append(time.perf_counter_ns() - t0)
        await close_all(c)
    st = Stats(samples)
    t.add(
        ["WS connect", "handshake only", *st.latency_cells(), "accept + upgrade"],
        m_ms("WS connect", st.median),
    )
    raw["ws_connect"] = st.raw()

    samples = []
    for _ in range(n):
        c = await ws_connect(server.ws, **CONNECT_KW)
        t0 = time.perf_counter_ns()
        await c.send(json.dumps({"type": "create_game"}))
        await recv_json(c)
        samples.append(time.perf_counter_ns() - t0)
        await close_all(c)
    st = Stats(samples)
    t.add(
        ["create_game", "send → game_created", *st.latency_cells(), ""],
        m_ms("create_game", st.median),
    )
    raw["create_game_rt"] = st.raw()

    samples = []
    for _ in range(n_setup):
        t0 = time.perf_counter_ns()
        game = await setup_game(server.ws)
        samples.append(time.perf_counter_ns() - t0)
        await close_all(game["w"], game["b"])
    st = Stats(samples)
    t.add(
        ["game setup", "create+join → both game_start", *st.latency_cells(), ""],
        m_ms("game setup", st.median),
    )
    raw["game_setup"] = st.raw()
    return t, raw


async def bench_move_rtt(ctx: Ctx) -> tuple[Table, dict]:
    server = ctx.servers["dict"]
    n = 50 if ctx.quick else 1_000
    game = await setup_game(server.ws)
    own, opp = [], []
    try:
        for ply in range(n):
            mover = game["white"] if ply % 2 == 0 else game["black"]
            other = game["black"] if ply % 2 == 0 else game["white"]
            t0 = time.perf_counter_ns()
            await mover.send(MOVE_FRAMES[ply % 4])
            await recv_json(mover)
            own.append(time.perf_counter_ns() - t0)
            await recv_json(other)
            opp.append(time.perf_counter_ns() - t0)
    finally:
        await close_all(game["w"], game["b"])
    st_own, st_opp = Stats(own), Stats(opp)
    t = Table(
        "move-rtt",
        "Sequential move round trip",
        "One game, moves played back to back: time from a player's `move` to their own "
        "`move_made` echo, and to the opponent's copy. This is the hot path in a live game "
        "(`dict` store).",
        LAT_COLUMNS,
        LAT_ALIGN,
    )
    t.add(
        ["mover echo", f"{n} sequential moves", *st_own.latency_cells(), "send → own move_made"],
        m_ms("mover echo", st_own.median),
    )
    t.add(
        [
            "opponent recv",
            f"{n} sequential moves",
            *st_opp.latency_cells(),
            "send → peer move_made",
        ],
        m_ms("opponent recv", st_opp.median),
    )
    return t, {"move_own": st_own.raw(), "move_opp": st_opp.raw()}


async def _run_concurrency(server: LiveServer, games_count: int, moves_each: int) -> dict:
    """G concurrent games, each playing M moves closed-loop. Returns metrics."""
    games = await asyncio.gather(*(setup_game(server.ws) for _ in range(games_count)))
    per_game_lat: list[list[float]] = [[] for _ in games]

    async def drive(idx: int, game: dict) -> int:
        try:
            return await play_moves(game, moves_each, per_game_lat[idx])
        except Exception:
            return -1

    cpu0 = server.cpu_s()
    t0 = time.perf_counter_ns()
    results = await asyncio.gather(*(drive(i, g) for i, g in enumerate(games)))
    wall_ns = time.perf_counter_ns() - t0
    cpu1 = server.cpu_s()
    # Share of one core the server used during the load window: near 100% means
    # the number is server-bound; well below means the load (or the machine)
    # limited it.
    cpu_pct = (
        100 * (cpu1 - cpu0) / (wall_ns / 1e9) if cpu0 is not None and cpu1 is not None else None
    )
    latencies: list[float] = []
    failures = total_moves = 0
    for r, lat in zip(results, per_game_lat, strict=True):
        if r < 0:
            failures += 1
            total_moves += len(lat)
        else:
            total_moves += r
        latencies.extend(lat)
    rss = server.rss_kb()
    await asyncio.gather(*(close_all(g["w"], g["b"]) for g in games))
    return {
        "games": games_count,
        "moves_each": moves_each,
        "total_moves": total_moves,
        "wall_ns": wall_ns,
        "moves_per_s": (total_moves / (wall_ns / 1e9)) if wall_ns else 0.0,
        "latencies": latencies,
        "failures": failures,
        "rss_kb": rss,
        "server_cpu_pct": cpu_pct,
    }


CONC_COLUMNS = ["Games", "Workload", "moves/s", "median", "p95", "p99", "RSS", "Notes"]
CONC_ALIGN = ["r", "l", "r", "r", "r", "r", "r", "l"]


def _games(g: int) -> str:
    return f"{g} game" if g == 1 else f"{g} games"


def _add_conc_row(t: Table, label: str, key: str, m: dict) -> dict:
    """Add one concurrency row; return the metrics dict made JSON-sized for raw."""
    st = Stats(m.pop("latencies"))
    notes = []
    if m["server_cpu_pct"] is not None:
        notes.append(f"server CPU {m['server_cpu_pct']:.0f}%")
    if m["failures"]:
        notes.append(f"{m['failures']} games failed")
    t.add(
        [
            label,
            f"{m['moves_each']} moves/game · {m['total_moves']} total",
            fmt_tput(m["moves_per_s"], "moves/s"),
            fmt_dur(st.median),
            st.p95_cell(),
            st.p99_cell(),
            fmt_bytes(m["rss_kb"] * 1024) if m["rss_kb"] else "—",
            "; ".join(notes),
        ],
        m_rate(key, m["moves_per_s"]),
    )
    m["stats"] = st.raw()
    return m


async def bench_concurrency_dict(ctx: Ctx) -> tuple[Table, dict]:
    server = ctx.servers["dict"]
    configs = [(1, 20), (5, 20)] if ctx.quick else [(1, 500), (10, 200), (50, 80), (200, 25)]
    t = Table(
        "conc",
        "Concurrency — dict store",
        "G games played concurrently on the single event loop, each side moving when it "
        "receives the previous move. With a plain in-memory dict (no store latency), "
        "throughput rises until relaying saturates the loop; after that more games only "
        "add queueing latency.",
        CONC_COLUMNS,
        CONC_ALIGN,
        [
            "RSS is the uvicorn process's VmRSS right after the load phase.",
            "Server CPU is the uvicorn process's share of one core during the load window: "
            "near 100% means the row is server-bound; well below it, the load generator (one "
            "Python process) or other work on the machine limited it, so compare such rows "
            "with care.",
        ],
    )
    raw = {}
    for g, m in configs:
        raw[f"dict.g{g}"] = _add_conc_row(
            t, str(g), f"dict · {_games(g)}", await _run_concurrency(server, g, m)
        )
    return t, raw


async def bench_concurrency_stores(ctx: Ctx) -> tuple[Table, dict]:
    # latent:2 is deterministic (2 blocking calls x 2 ms per move), so a few
    # hundred moves per point pin its ceiling; more would only add wall time.
    if ctx.quick:
        plan = [("pickle", [(1, 20), (10, 5)]), ("latent:2", [(1, 20), (10, 5)])]
    else:
        plan = [
            ("pickle", [(1, 500), (10, 150), (50, 40)]),
            ("latent:2", [(1, 300), (10, 40), (50, 8)]),
        ]
    predicted = 1 / (2 * 0.002)
    t = Table(
        "conc-stores",
        "Concurrency — serializing store models",
        "The same sweep with stores that copy on every access (`pickle`) and that also "
        "**block** the event loop per store call (`latent:2` = a simulated 2 ms blocking RPC "
        "per store call; real modal.Dict latency is not measured here). Because the loop is "
        "single-threaded and store calls block, all games serialize behind them.",
        CONC_COLUMNS,
        CONC_ALIGN,
        [
            f"`latent:2`: `record_move` does a get **and** a set (2 blocking calls), so per-move "
            f"throughput is capped near 1/(2×2 ms) ≈ {fmt_tput(predicted, 'moves/s')} "
            f"across **all** games combined, no matter how many run.",
            "This models modal.Dict's synchronous RPCs; it assumes a latency rather than "
            "measuring the real network cost.",
        ],
    )
    raw = {}
    for model, configs in plan:
        server = ctx.servers[model]
        for g, m in configs:
            metrics = await _run_concurrency(server, g, m)
            raw[f"{model}.g{g}"] = _add_conc_row(
                t, f"{model} · {g}", f"{model} · {_games(g)}", metrics
            )
    return t, raw


def _rejoin_frame(gid: str) -> str:
    return json.dumps({"type": "rejoin_game", "gameId": gid, "color": "white", "takeover": True})


async def _build_history(white: Any, black: Any, start: int, end: int) -> None:
    """Play plies start..end-1 through the real move path, one ply in flight.

    Moves cannot be pipelined across the two sockets (the server has no
    cross-connection read ordering, so a queued reply could be read before the
    move it answers is recorded and rejected as wrong_turn), but the next mover
    need not wait for its copy of the previous move: the mover's own echo
    proves the move is recorded, and each socket reads its queue in order.
    """
    for ply in range(start, end):
        ws, color = (white, "white") if ply % 2 == 0 else (black, "black")
        await ws.send(MOVE_FRAMES[ply % 4])
        await wait_own_echo(ws, color)


async def bench_rejoin_live(ctx: Ctx) -> tuple[Table, dict]:
    server = ctx.servers["adv"]
    lengths = (100, 1_000, 5_000) if ctx.quick else (100, 1_000, 5_000, 20_000)
    t = Table(
        "rejoin",
        "Rejoin into long histories",
        "Games have no draw rules (no repetition or 50-move limit), so histories can grow "
        "without bound. On rejoin the server rebuilds and resends the entire history as one "
        "`game_state` (`dict` store; the cost is dominated by validate + serialize + send).",
        LAT_COLUMNS,
        LAT_ALIGN,
    )
    raw: dict[str, Any] = {}
    # One game grows through each length in turn. The builders skip
    # permessage-deflate (it is not what is measured); the rejoining sockets
    # keep it, as browsers negotiate it.
    game = await setup_game(server.ws, compression=None)
    gid, white, black = game["gid"], game["white"], game["black"]
    built, build_ns = 0, 0
    try:
        for length in lengths:
            key = f"{length:,} moves"
            t0 = time.perf_counter_ns()
            try:
                await _build_history(white, black, built, length)
            except Exception as exc:
                t.add([key, "history build failed", "—", "—", "—", "—", "0", type(exc).__name__])
                break
            build_ns += time.perf_counter_ns() - t0
            built = length

            if ctx.quick:
                n = 20
            else:
                n = 50 if length <= 1_000 else (30 if length <= 5_000 else 10)
            samples, payload_bytes, in_sync = [], 0, False
            holder = white  # the socket currently holding the white seat
            for i in range(n):
                rj = await ws_connect(server.ws, **CONNECT_KW)
                t1 = time.perf_counter_ns()
                await rj.send(_rejoin_frame(gid))
                text = await asyncio.wait_for(rj.recv(), 30)
                samples.append(time.perf_counter_ns() - t1)
                if i == 0:
                    payload_bytes = len(text.encode())
                    state = json.loads(text)
                    in_sync = state.get("type") == "game_state" and len(state["moves"]) == length
                await close_all(holder)  # already replaced (4001) by the server
                holder = rj
            # Take the seat back on an uncompressed socket to keep building.
            white = await ws_connect(server.ws, compression=None, **CONNECT_KW)
            await white.send(_rejoin_frame(gid))
            await close_all(holder)

            st = Stats(samples)
            t.add(
                [
                    key,
                    f"rejoin → game_state ({fmt_bytes(payload_bytes)})",
                    *st.latency_cells(),
                    "full history resent" if in_sync else "DESYNC: history length mismatch",
                ],
                m_ms(key, st.median) if in_sync else None,
            )
            raw[f"rejoin.{length}"] = {
                **st.raw(),
                "payload_bytes": payload_bytes,
                "in_sync": in_sync,
            }
    finally:
        await close_all(white, black, game["w"], game["b"])
    build_s = build_ns / 1e9
    raw["build"] = {"moves": built, "seconds": build_s}
    t.notes = [
        "Latency and payload both grow linearly with history length.",
        f"The history is built through the real move path, one ply in flight: {built:,} moves "
        f"took {build_s:.1f} s ({fmt_tput(built / build_s if build_s else 0, 'moves/s')}); "
        "that build is excluded from the rows.",
    ]
    return t, raw


# =============================================================================
# Section C: adversarial
# =============================================================================


async def _canary_samples(canary: dict, n: int) -> list[float]:
    lat: list[float] = []
    await play_moves(canary, n, lat)
    return lat


async def _flood_with_canary(
    url: str, kind: str, seconds: float, canary: dict
) -> tuple[list[float], dict]:
    """Run the attacker process for `seconds`; measure the canary meanwhile."""
    proc = await asyncio.create_subprocess_exec(
        sys.executable,
        ATTACKER,
        url,
        kind,
        str(seconds),
        cwd=BENCH_DIR,
        env=child_env(),
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        ready = await asyncio.wait_for(proc.stdout.readline(), 20)
        if ready.strip() != b"READY":
            raise RuntimeError(f"attacker did not start ({ready!r})")
        done = asyncio.ensure_future(proc.stdout.readline())
        samples: list[float] = []
        deadline = time.monotonic() + seconds + 20
        while not done.done() and time.monotonic() < deadline:
            await play_moves(canary, 1, samples)
        if (await asyncio.wait_for(done, 20)).strip() != b"DONE":
            raise RuntimeError("attacker did not finish")
        result = json.loads(await asyncio.wait_for(proc.stdout.readline(), 20))
        await asyncio.wait_for(proc.wait(), 10)
        return samples, result
    finally:
        if proc.returncode is None:
            proc.kill()
            await proc.wait()


async def bench_floods(ctx: Ctx) -> tuple[Table, dict]:
    server = ctx.servers["adv"]
    seconds = 0.3 if ctx.quick else 1.0
    t = Table(
        "floods",
        "Junk-frame floods vs a canary",
        "An attacker process pipelines junk frames on one socket (up to 64 unanswered) for a "
        "fixed time while a normal two-player canary game measures its move RTT. Everything "
        "shares one event loop, so the question is how much a flood degrades a real game "
        "(`dict` store).",
        ["Case", "Workload", "canary p50", "canary p99", "reject rate", "Notes"],
        ["l", "l", "r", "r", "r", "l"],
        [
            "Every junk frame is answered with an `error` and the attacker's socket stays open; "
            "the server never disconnects a merely-invalid message.",
            "The attacker runs in its own process (like a remote client) and sends uncompressed "
            "frames; the reject rate is replies received per second over the flood.",
        ],
    )
    raw: dict[str, Any] = {}
    canary = await setup_game(server.ws)
    try:
        base = Stats(await _canary_samples(canary, 100 if ctx.quick else 300))
        t.add(
            [
                "canary baseline",
                "no flood",
                fmt_dur(base.median),
                base.p99_cell(),
                "—",
                f"{base.n} canary moves",
            ],
            m_ms("canary baseline", base.median),
        )
        raw["canary_baseline"] = base.raw()
        scenarios = [
            ("malformed JSON", "malformed", "non-JSON text frames", "invalid_message"),
            ("schema-invalid", "schema", '{"type":"move","from":"Zz9",...}', "invalid_message"),
            ("out-of-turn", "out_of_turn", "seated player, not its turn", "wrong_turn"),
        ]
        for name, kind, workload, code in scenarios:
            try:
                samples, res = await _flood_with_canary(server.ws, kind, seconds, canary)
            except Exception as exc:
                t.add([name, workload, "—", "—", "—", f"FAILED: {type(exc).__name__}: {exc}"])
                continue
            d = Stats(samples)
            expected = res["codes"].get(code, 0) == res["replies"] == res["sent"]
            t.add(
                [
                    name,
                    f"{workload} · {seconds:g} s",
                    fmt_dur(d.median),
                    d.p99_cell(),
                    fmt_tput(res["rate"], f"{code}/s"),
                    f"{res['replies']:,} rejected; {d.n} canary moves; canary stayed up"
                    + ("" if expected else f"; UNEXPECTED replies {res['codes']}"),
                ],
                m_rate(name, res["rate"]),
            )
            raw[f"flood.{name}"] = {
                "during": d.raw(),
                "sent": res["sent"],
                "rejects": res["replies"],
                "reject_rate": res["rate"],
                "codes": res["codes"],
            }
    finally:
        await close_all(canary["w"], canary["b"])
    return t, raw


ADV_COLUMNS = ["Case", "Workload", "time to outcome", "Outcome", "Healthy after", "Notes"]
ADV_ALIGN = ["l", "l", "r", "l", "l", "l"]


async def _send_and_outcome(
    url: str, payload: str | bytes, clock_from_sent: bool = False, **connect_kw: Any
) -> dict:
    """Send one frame; report the reply or the close code, and time to it.

    The clock starts at `send()`; with `clock_from_sent` it starts once the
    whole frame has been handed to the socket instead, which keeps slow
    client-side work (compressing a 17 MiB bomb) out of the number. A close
    frame counts as soon as it is parsed: an oversized frame is refused on its
    header, the server stops reading, and the client's send stays blocked until
    uvicorn's close timeout (10 s) tears the TCP connection down, which is not
    the server's decision time.
    """
    ws = await ws_connect(url, **{**CONNECT_KW, **connect_kw})
    t0 = time.perf_counter_ns()
    sent_at: list[int] = []

    async def send() -> None:
        await ws.send(payload)
        sent_at.append(time.perf_counter_ns())

    async def close_frame() -> None:
        while ws.protocol.close_rcvd is None:
            await asyncio.sleep(0.001)

    send_t = asyncio.ensure_future(send())
    recv_t = asyncio.ensure_future(ws.recv())
    close_t = asyncio.ensure_future(close_frame())
    try:
        await asyncio.wait({recv_t, close_t}, timeout=30, return_when=asyncio.FIRST_COMPLETED)
        end = time.perf_counter_ns()
        closed = close_t.done() or (
            recv_t.done() and isinstance(recv_t.exception(), ConnectionClosed)
        )
        if closed:
            rcvd = ws.protocol.close_rcvd
            outcome = f"closed {rcvd.code if rcvd else ws.close_code}"
        elif recv_t.done() and recv_t.exception() is not None:
            outcome = type(recv_t.exception()).__name__
        elif recv_t.done():
            try:
                msg = json.loads(recv_t.result())
                kind = msg.get("type")
                outcome = f"error: {msg.get('code')}" if kind == "error" else str(kind)
            except ValueError:
                outcome = "non-JSON reply"
        else:
            outcome = "no reply (timeout)"
        start = sent_at[0] if clock_from_sent and sent_at and sent_at[0] <= end else t0
    finally:
        blocked = not send_t.done()
        for task in (send_t, recv_t, close_t):
            task.cancel()
        if blocked:
            ws.transport.abort()  # the server stopped reading mid-frame
        await asyncio.gather(send_t, recv_t, close_t, return_exceptions=True)
        if not blocked:
            await close_all(ws)
    return {"outcome": outcome, "dt_ns": end - start}


async def bench_oversized_and_nested(ctx: Ctx) -> tuple[Table, dict]:
    server = ctx.servers["adv"]
    t = Table(
        "oversized",
        "Oversized & deeply nested frames",
        "Malformed but attention-grabbing frames: a huge schema-valid field, a compression "
        "bomb, JSON nested past Python's recursion limit, and a binary frame. Each row records "
        "the outcome and whether the server was still healthy afterwards (`dict` store).",
        ADV_COLUMNS,
        ADV_ALIGN,
        [
            "Each row is the median of several fresh connections (n in Notes); the outcome must "
            "be the same every time or the row says MIXED.",
            "Size rows are sent uncompressed, so the frame's bytes are what crosses the wire. "
            "Time to outcome runs from `send()` to the reply or close frame, so the larger rows "
            "include the client building (masking) the frame; the > 16 MiB row is refused on its "
            "header, so it is almost all client-side. The compression bomb is timed from when its "
            "compressed frame was handed to the socket, excluding client-side compression.",
            "Deep nesting past ~1000 levels raises `RecursionError` inside `json.loads`, which the "
            "inner `except (ValueError, KeyError)` does **not** catch; it falls to the outer "
            "`except Exception`, so that one connection is closed with 1011 (the server survives).",
            "uvicorn's `ws_max_size` is 16 MiB, enforced on the decompressed size; a larger "
            "frame is dropped by the WebSocket layer with close 1009 before the app sees it.",
        ],
    )
    raw: dict[str, Any] = {}

    async def case(
        key: str, case_name: str, workload: str, payload: str | bytes, note: str = "", **kw: Any
    ) -> None:
        big = len(payload) >= 8 << 20
        reps = 2 if ctx.quick else (3 if big else 7)
        results = [await _send_and_outcome(server.ws, payload, **kw) for _ in range(reps)]
        outcomes = sorted({r["outcome"] for r in results})
        outcome = outcomes[0] if len(outcomes) == 1 else "MIXED: " + ", ".join(outcomes)
        st = Stats([r["dt_ns"] for r in results])
        healthy = await healthy_after(server)
        t.add(
            [
                case_name,
                workload,
                fmt_dur(st.median),
                outcome,
                "yes" if healthy else "NO",
                "; ".join(x for x in (note, f"n={st.n}") if x),
            ],
            m_ms(key, st.median),
        )
        raw[key] = {"outcome": outcome, "dt_ns": st.median, "stats": st.raw(), "healthy": healthy}

    sizes = [(64 * 1024, "64 KiB"), (1 << 20, "1 MiB")]
    if not ctx.quick:
        sizes += [(8 << 20, "8 MiB"), (17 << 20, "17 MiB")]
    for nbytes, label in sizes:
        over = " (> ws_max_size 16 MiB)" if nbytes > 16 << 20 else ""
        await case(
            f"oversized · {label}",
            "oversized frame",
            f"schema-valid, {label} field{over}",
            json.dumps({"type": "join_game", "gameId": "A" * nbytes}),
            compression=None,
        )
    if not ctx.quick:
        await case(
            "deflate bomb · 17 MiB",
            "compression bomb",
            "17 MiB of one byte, permessage-deflate (~17 KiB on the wire)",
            json.dumps({"type": "join_game", "gameId": "A" * (17 << 20)}),
            "limit applies after inflating",
            clock_from_sent=True,
        )
    for depth in [100, 1_000] if ctx.quick else [100, 1_000, 10_000, 100_000]:
        res_key = f"nesting · {depth}"
        await case(res_key, "deep nesting", f"{depth:,}-deep JSON array", "[" * depth + "]" * depth)
        if "1011" in raw[res_key]["outcome"]:
            t.rows[-1][-1] = "RecursionError → 1011; " + t.rows[-1][-1]
    await case(
        "binary frame",
        "binary frame",
        "non-text WS frame",
        b"\x00\x01\x02\x03binary",
        "handler catches KeyError",
    )
    return t, raw


async def bench_seat_contention(ctx: Ctx) -> tuple[Table, dict]:
    url = ctx.servers["adv"].ws
    t = Table(
        "seats",
        "Seat contention",
        "Concurrent claims on the same seat. The store ops run to completion without yielding, "
        "so races resolve to a single winner even under a burst (`dict` store).",
        ["Case", "Workload", "Result", "median", "max", "Notes"],
        ["l", "l", "l", "r", "r", "l"],
        [
            "`takeover=true` is last-writer-wins; every earlier socket for that seat is closed "
            "with application code 4001 so the client knows to stop reconnecting.",
        ],
    )
    raw: dict[str, Any] = {}
    reps = 2 if ctx.quick else 5

    # Seat race: one game, K sockets join at once -> exactly one seat.
    k_join = 20 if ctx.quick else 50
    races = [await _seat_race_once(url, k_join) for _ in range(reps)]
    lat = [dt for r in races for dt in r["latencies"]]
    ok = all(r["joined"] == 1 and r["full"] == k_join - 1 for r in races)
    st = Stats(lat)
    t.add(
        [
            "seat race",
            f"{k_join} joins, 1 free seat · ×{reps}",
            _uniform([f"{r['joined']} seated / {r['full']} game_full" for r in races]),
            fmt_dur(st.median),
            fmt_dur(st.max),
            "exactly one wins every time" if ok else "UNEXPECTED",
        ],
        m_ms("seat race", st.median),
    )
    raw["seat_race"] = {
        "joined": races[-1]["joined"],
        "full": races[-1]["full"],
        "k": k_join,
        "reps": reps,
        "all_ok": ok,
        "stats": st.raw(),
    }

    # Takeover storm: K rejoin the same seat with takeover:true -> one holds it.
    k_take = 15 if ctx.quick else 30
    storms = [await _takeover_storm_once(url, k_take) for _ in range(reps)]
    lat = [dt for s in storms for dt in s["latencies"]]
    ok = all(
        s["survivors"] == 1 and s["holder_ok"] and s["closed_4001"] == k_take - 1 for s in storms
    )
    st2 = Stats(lat)
    t.add(
        [
            "takeover storm",
            f"{k_take} rejoin(takeover) same seat · ×{reps}",
            _uniform(
                [f"{s['got_state']} game_state / {s['closed_4001']} closed 4001" for s in storms]
            ),
            fmt_dur(st2.median),
            fmt_dur(st2.max),
            "one holder confirmed every time" if ok else "UNEXPECTED survivors/holder",
        ],
        m_ms("takeover storm", st2.median),
    )
    last = storms[-1]
    raw["takeover_storm"] = {
        "got_state": last["got_state"],
        "closed_4001": last["closed_4001"],
        "survivors": last["survivors"],
        "holder_ok": last["holder_ok"],
        "k": k_take,
        "reps": reps,
        "all_ok": ok,
        "stats": st2.raw(),
    }

    # seat_in_use: takeover=false against a live seat with a distinct clientId.
    n_intrude = 5 if ctx.quick else 20
    game3 = await setup_game(url)
    codes, lat = [], []
    try:
        for i in range(n_intrude):
            intruder = await ws_connect(url, **CONNECT_KW)
            t0 = time.perf_counter_ns()
            await intruder.send(
                json.dumps(
                    {
                        "type": "rejoin_game",
                        "gameId": game3["gid"],
                        "color": "white",
                        "clientId": f"intruder-{i}",
                        "takeover": False,
                    }
                )
            )
            m = await recv_json(intruder)
            lat.append(time.perf_counter_ns() - t0)
            codes.append(str(m.get("code")))
            await close_all(intruder)
    finally:
        await close_all(game3["w"], game3["b"])
    st3 = Stats(lat)
    t.add(
        [
            "seat_in_use",
            f"rejoin(takeover=false) live seat · ×{n_intrude}",
            _uniform([f"error: {c}" for c in codes]),
            fmt_dur(st3.median),
            fmt_dur(st3.max),
            "auto-reconnect refused",
        ],
        m_ms("seat_in_use", st3.median),
    )
    raw["seat_in_use"] = {"code": codes[-1] if codes else None, "stats": st3.raw()}
    return t, raw


def _uniform(results: list[str]) -> str:
    """The result if every repetition agreed, else a MIXED summary."""
    distinct = sorted(set(results))
    return distinct[0] if len(distinct) == 1 else "MIXED: " + ", ".join(distinct)


async def _seat_race_once(url: str, k: int) -> dict:
    """One game with a free seat; k sockets send join_game at the same moment."""
    creator = await ws_connect(url, **CONNECT_KW)
    joiners: list[Any] = []
    try:
        await creator.send(json.dumps({"type": "create_game"}))
        gid = (await recv_json(creator))["gameId"]
        joiners = await asyncio.gather(*(ws_connect(url, **CONNECT_KW) for _ in range(k)))
        frame = json.dumps({"type": "join_game", "gameId": gid})

        async def try_join(ws: Any) -> tuple[str, float]:
            t0 = time.perf_counter_ns()
            await ws.send(frame)
            try:
                while True:
                    m = await recv_json(ws)
                    if m["type"] == "game_joined":
                        return "game_joined", time.perf_counter_ns() - t0
                    if m["type"] == "error":
                        return m["code"], time.perf_counter_ns() - t0
            except Exception as exc:
                return type(exc).__name__, time.perf_counter_ns() - t0

        results = await asyncio.gather(*(try_join(ws) for ws in joiners))
    finally:
        await close_all(creator, *joiners)
    return {
        "joined": sum(1 for o, _ in results if o == "game_joined"),
        "full": sum(1 for o, _ in results if o == "game_full"),
        "latencies": [dt for _, dt in results],
    }


async def _takeover_storm_once(url: str, k: int) -> dict:
    """k sockets rejoin one seat with takeover:true at once; exactly one must hold it."""
    game = await setup_game(url)
    stormers: list[Any] = []
    try:
        await close_all(game["white"])  # free the live socket; the seat stays claimed
        with contextlib.suppress(Exception):
            await asyncio.wait_for(game["black"].recv(), 3)  # presence(offline)
        stormers = await asyncio.gather(*(ws_connect(url, **CONNECT_KW) for _ in range(k)))

        async def storm_rejoin(ws: Any, idx: int) -> tuple[str, float]:
            frame = {
                "type": "rejoin_game",
                "gameId": game["gid"],
                "color": "white",
                "clientId": f"storm-{idx}",
                "takeover": True,
            }
            t0 = time.perf_counter_ns()
            await ws.send(json.dumps(frame))
            try:
                return (await recv_json(ws))["type"], time.perf_counter_ns() - t0
            except Exception as exc:
                return type(exc).__name__, time.perf_counter_ns() - t0

        storm = await asyncio.gather(*(storm_rejoin(ws, i) for i, ws in enumerate(stormers)))

        def replaced() -> int:
            return sum(1 for ws in stormers if ws.close_code == SEAT_REPLACED)

        for _ in range(300):  # settle: wait until every loser has seen its 4001
            if replaced() >= k - 1:
                break
            await asyncio.sleep(0.01)
        survivors = [ws for ws in stormers if ws.close_code is None]
        # The survivor (white) makes the first move and must see its own echo.
        holder_ok = False
        if len(survivors) == 1:
            try:
                await survivors[0].send(MOVE_FRAMES[0])
                await wait_own_echo(survivors[0], "white", timeout=5)
                holder_ok = True
            except Exception:
                holder_ok = False
        return {
            "got_state": sum(1 for o, _ in storm if o == "game_state"),
            "closed_4001": replaced(),
            "survivors": len(survivors),
            "holder_ok": holder_ok,
            "latencies": [dt for _, dt in storm],
        }
    finally:
        await close_all(game["black"], *stormers)


async def bench_churn(ctx: Ctx) -> tuple[Table, dict]:
    server = ctx.servers["adv"]
    n_cycles = 100 if ctx.quick else 1_500
    rss_before = server.rss_kb()
    t0 = time.perf_counter_ns()
    for _ in range(n_cycles):
        c = await ws_connect(server.ws, **CONNECT_KW)
        await c.send(json.dumps({"type": "create_game"}))
        await recv_json(c)
        await close_all(c)
    wall = (time.perf_counter_ns() - t0) / 1e9
    rss_after = server.rss_kb()
    rate = n_cycles / wall if wall else 0.0
    growth = (rss_after - rss_before) if (rss_before and rss_after) else None
    t = Table(
        "churn",
        "Connection churn & robustness",
        "Sustained connect/create/close cycles: does anything leak, and how fast can the "
        "relay recycle connections? `dict` store.",
        ["Case", "Workload", "throughput", "before", "after", "Notes"],
        ["l", "l", "r", "r", "r", "l"],
        [
            "Game records are retained deliberately (rejoin depends on them; modal.Dict expires "
            "them via a ~30-day TTL), so store growth under churn is expected, not a leak.",
            "A slow-consumer test was designed but dropped: the protocol's strict turn "
            "alternation means a stalled reader can be sent at most one move broadcast before the "
            "game halts waiting for its move, so it cannot be flooded into blocking the relay "
            "through moves — the scenario is not reachable deterministically here.",
        ],
    )
    t.add(
        [
            "connection churn",
            f"{n_cycles:,} sequential connect+create+close",
            fmt_tput(rate, "cycles/s"),
            fmt_bytes(rss_before * 1024) if rss_before else "—",
            fmt_bytes(rss_after * 1024) if rss_after else "—",
            (f"RSS +{fmt_bytes(growth * 1024)}; " if growth is not None else "")
            + "games kept by design",
        ],
        m_rate("connection churn", rate),
    )
    return t, {
        "cycles": n_cycles,
        "rate": rate,
        "rss_before_kb": rss_before,
        "rss_after_kb": rss_after,
    }


# =============================================================================
# Findings
# =============================================================================


def build_findings(raw: dict) -> list[str]:
    """Factual bullets, each backed by a number from this run; skipped when absent."""
    f: list[str] = []

    def stat(section: str, key: str, field: str = "median_ns") -> Any:
        node = raw.get(section, {}).get(key)
        return node.get(field) if isinstance(node, dict) else None

    acc, rej = stat("decode", "move"), stat("decode", "bad coordinate")
    if acc and rej and rej > acc:
        f.append(
            f"A rejected message costs more than a valid one: a bad-coordinate `move` takes "
            f"{fmt_dur(rej)} median to decode+validate vs {fmt_dur(acc)} for a valid `move`, "
            "consistent with the non-discriminated 11-member union trying every member first."
        )

    p0 = stat("store", "record_move.pickle.0")
    long_len = 5_000 if stat("store", "record_move.pickle.5000") else 1_000
    p_long = stat("store", f"record_move.pickle.{long_len}")
    if p0 and p_long:
        f.append(
            f"Under copy-on-access (the modal.Dict model), `record_move` grows with history: "
            f"{fmt_dur(p0)} at 0 moves vs {fmt_dur(p_long)} at {long_len:,} moves, because each "
            "move re-(un)pickles the whole record — the per-game O(n²) ARCHITECTURE.md calls out."
        )
    d0, d_long = stat("store", "record_move.dict.0"), stat("store", f"record_move.dict.{long_len}")
    if d0 and d_long:
        f.append(
            f"With a plain dict the same op stays flat: {fmt_dur(d0)} at 0 moves, "
            f"{fmt_dur(d_long)} at {long_len:,} (the record is shared by reference, never copied)."
        )

    conc = raw.get("conc", {})
    lat = next((conc[k] for k in ("latent:2.g50", "latent:2.g10") if k in conc), None)
    if lat:
        f.append(
            f"With a simulated 2 ms blocking store RPC, {lat['games']} concurrent games together "
            f"reach only {fmt_tput(lat['moves_per_s'], 'moves/s')}, against a modelled ceiling of "
            "1/(2×2 ms) = 250 moves/s: every game serializes behind the blocking get+set on the "
            "single event loop."
        )
        dict_same = conc.get(f"dict.g{lat['games']}")
        if dict_same:
            f.append(
                f"The same {lat['games']}-game load on the dict store reaches "
                f"{fmt_tput(dict_same['moves_per_s'], 'moves/s')}, so under the latent:2 model the "
                "store calls, not the relay, set the ceiling."
            )
    one, many = conc.get("dict.g1"), conc.get("dict.g200")
    if one and many and one.get("stats") and many.get("stats"):
        cpu = many.get("server_cpu_pct")
        f.append(
            f"At 200 concurrent games (dict store) the relay sustains "
            f"{fmt_tput(many['moves_per_s'], 'moves/s')} but the median move echo rises to "
            f"{fmt_dur(many['stats']['median_ns'])} (vs {fmt_dur(one['stats']['median_ns'])} "
            "for a lone game)"
            + (f", with the server process at {cpu:.0f}% of one core" if cpu is not None else "")
            + ": past the plateau, extra games queue on the single event loop."
        )

    small = stat("rejoin_live", "rejoin.100")
    big_len = next((n for n in (20_000, 5_000) if stat("rejoin_live", f"rejoin.{n}")), None)
    if small and big_len:
        pb = stat("rejoin_live", f"rejoin.{big_len}", "payload_bytes")
        f.append(
            "Rejoin latency scales with history, and histories are unbounded (no draw rules): "
            f"{fmt_dur(small)} at 100 moves vs {fmt_dur(stat('rejoin_live', f'rejoin.{big_len}'))} "
            f"at {big_len:,} moves" + (f" ({fmt_bytes(pb)} payload)." if pb else ".")
        )

    adv = raw.get("oversized", {})
    if any(k.startswith("nesting") and "1011" in str(v.get("outcome")) for k, v in adv.items()):
        f.append(
            "Deeply nested JSON (10,000 levels and up in this run) raises `RecursionError` in "
            "`json.loads`, which escapes the handler's `except (ValueError, KeyError)` and lands "
            "in the outer `except Exception`, closing that one connection with 1011; the server "
            "stays healthy."
        )
    if "1009" in str(adv.get("oversized · 17 MiB", {}).get("outcome")):
        bomb = "1009" in str(adv.get("deflate bomb · 17 MiB", {}).get("outcome"))
        f.append(
            "A frame over uvicorn's 16 MiB `ws_max_size` is refused by the WebSocket layer with "
            "close 1009 before the app runs"
            + (
                ", including a ~17 KiB permessage-deflate bomb that inflates past it"
                if bomb
                else ""
            )
            + "; smaller huge frames are decoded and rejected normally."
        )

    fl = raw.get("floods", {})
    base = fl.get("canary_baseline", {})
    mal = fl.get("flood.malformed JSON", {})
    if base.get("median_ns") and mal.get("during", {}).get("median_ns"):
        during = mal["during"]
        ratio = during["median_ns"] / base["median_ns"]
        effect = f"rose {ratio:.1f}×" if ratio >= 1.2 else "barely moved"
        f.append(
            f"One pipelined attacker socket sending malformed JSON was rejected at "
            f"~{fmt_tput(mal['reject_rate'], 'msg/s')}; meanwhile a canary game's median move RTT "
            f"{effect} ({fmt_dur(base['median_ns'])} → {fmt_dur(during['median_ns'])}, p99 "
            f"{fmt_dur(base.get('p99_ns'))} → {fmt_dur(during.get('p99_ns'))}) and it was never "
            "disconnected."
        )

    sr = raw.get("seat", {}).get("seat_race")
    if sr and sr.get("all_ok"):
        f.append(
            f"A {sr['k']}-way race for one seat, repeated {sr['reps']} times, resolved every time "
            f"to 1 seated and {sr['k'] - 1} `game_full`: the synchronous read-modify-write store "
            "op admits no interleaving."
        )
    elif sr:
        f.append(
            f"A {sr['k']}-way race for one seat did NOT always resolve to a single winner "
            f"(last run: {sr['joined']} seated, {sr['full']} `game_full`)."
        )
    ts = raw.get("seat", {}).get("takeover_storm")
    if ts and ts.get("all_ok"):
        f.append(
            f"A {ts['k']}-way `takeover` storm on one seat, repeated {ts['reps']} times, left a "
            f"single holder every time ({ts['k'] - 1} sockets closed with 4001, the holder "
            "confirmed by a live move)."
        )
    elif ts:
        f.append(
            f"A {ts['k']}-way `takeover` storm did NOT always leave a single confirmed holder "
            f"(last run: {ts['survivors']} survivors, {ts['closed_4001']} closed with 4001)."
        )
    return f


# =============================================================================
# Orchestration
# =============================================================================


@dataclass(frozen=True)
class Spec:
    key: str
    raw_key: str
    servers: tuple[str, ...]
    fn: Callable[[Ctx], Any]


SPECS = (
    Spec("decode", "decode", (), bench_decode_validate),
    Spec("store", "store", (), bench_store_ops),
    Spec("rejoin-payload", "rejoin_payload", (), bench_rejoin_payload),
    Spec("baselines", "baselines", ("dict",), bench_baselines),
    Spec("move-rtt", "move_rtt", ("dict",), bench_move_rtt),
    Spec("conc", "conc", ("dict",), bench_concurrency_dict),
    Spec("conc-stores", "conc", ("pickle", "latent:2"), bench_concurrency_stores),
    Spec("rejoin", "rejoin_live", ("adv",), bench_rejoin_live),
    Spec("floods", "floods", ("adv",), bench_floods),
    Spec("oversized", "oversized", ("adv",), bench_oversized_and_nested),
    Spec("seats", "seat", ("adv",), bench_seat_contention),
    Spec("churn", "churn", ("adv",), bench_churn),
)
SECTION_KEYS = tuple(s.key for s in SPECS)


def log(msg: str) -> None:
    print(f"[bench-server] {msg}", file=sys.stderr, flush=True)


def failed_section(spec: Spec, why: str) -> dict:
    return {
        "key": spec.key,
        "title": f"{spec.key} (failed)",
        "intro": why,
        "columns": ["Case"],
        "align": ["l"],
        "rows": [],
        "metrics": [],
        "notes": [],
    }


class Runner:
    def __init__(self, quick: bool, specs: list[Spec], logdir: str) -> None:
        self.quick = quick
        self.specs = specs
        self.logdir = logdir
        self.sections: list[dict] = []
        self.raw: dict[str, Any] = {}
        self.timings: dict[str, float] = {}

    async def run_one(self, spec: Spec, ctx: Ctx) -> None:
        t0 = time.perf_counter()
        try:
            if inspect.iscoroutinefunction(spec.fn):
                table, r = await asyncio.wait_for(spec.fn(ctx), SECTION_TIMEOUT)
            else:
                table, r = spec.fn(ctx)
            self.sections.append(table.to_dict())
            self.raw.setdefault(spec.raw_key, {}).update(r)
        except Exception as exc:
            self.sections.append(
                failed_section(spec, f"Section raised {type(exc).__name__}: {exc}")
            )
        self.timings[spec.key] = round(time.perf_counter() - t0, 3)
        log(f"{spec.key:<15} {self.timings[spec.key]:6.2f} s")

    def start_servers(self, names: list[str]) -> tuple[dict[str, LiveServer], dict[str, str]]:
        """Boot every needed server at once (they are idle until used)."""
        servers = {n: LiveServer(n, SERVER_MODELS[n], self.logdir) for n in names}
        up: dict[str, LiveServer] = {}
        failed: dict[str, str] = {}
        for s in servers.values():
            s.start()
        for n, s in servers.items():
            try:
                s.wait_ready()
                up[n] = s
            except Exception as exc:
                failed[n] = str(exc)
                s.stop()
        return up, failed

    async def run(self) -> None:
        for spec in self.specs:  # in-process first, with no servers competing for CPU
            if not spec.servers:
                await self.run_one(spec, Ctx(self.quick, {}))
        live = [s for s in self.specs if s.servers]
        if not live:
            return
        names = list(dict.fromkeys(n for s in live for n in s.servers))
        t0 = time.perf_counter()
        up, failed = self.start_servers(names)
        self.timings["server_startup"] = round(time.perf_counter() - t0, 3)
        log(f"{'server startup':<15} {self.timings['server_startup']:6.2f} s ({', '.join(names)})")
        try:
            for spec in live:
                missing = [n for n in spec.servers if n not in up]
                if missing:
                    why = "; ".join(f"{n}: {failed.get(n)}" for n in missing)
                    self.sections.append(failed_section(spec, f"Server failed to start: {why}"))
                    continue
                await self.run_one(spec, Ctx(self.quick, up))
        finally:
            for s in up.values():
                s.stop()


def build_meta(quick: bool, keys: list[str]) -> dict:
    import fastapi
    import pydantic
    import uvicorn

    return {
        "Python": platform.python_version(),
        "FastAPI": fastapi.__version__,
        "Pydantic": pydantic.__version__,
        "uvicorn": uvicorn.__version__,
        "websockets": websockets.__version__,
        "Mode": "quick" if quick else "full",
        "Sections": "all" if len(keys) == len(SECTION_KEYS) else ", ".join(keys),
        "Store models": (
            "dict (local dev), pickle (copy-on-access), latent:2 (simulated 2 ms blocking RPC/call)"
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Server benchmark runner")
    parser.add_argument("--out", required=True, help="output JSON path")
    parser.add_argument("--quick", action="store_true", help="tiny samples for a smoke run")
    parser.add_argument(
        "--only",
        help=f"comma-separated section keys to run (default: all): {', '.join(SECTION_KEYS)}",
    )
    args = parser.parse_args()
    keys = list(SECTION_KEYS)
    if args.only:
        keys = [k.strip() for k in args.only.split(",") if k.strip()]
        unknown = [k for k in keys if k not in SECTION_KEYS]
        if unknown or not keys:
            parser.error(f"unknown section key(s) {unknown}; choose from {', '.join(SECTION_KEYS)}")

    # A SIGTERM (e.g. an agent's timeout) unwinds through the finally blocks
    # that stop the servers; spawned processes also die with us via
    # BENCH_PARENT_PID (see bench_app.die_with_parent).
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))

    t_start = time.perf_counter()
    logdir = tempfile.mkdtemp(prefix="bench-server-")
    runner = Runner(args.quick, [s for s in SPECS if s.key in keys], logdir)
    try:
        asyncio.run(runner.run())
    finally:
        shutil.rmtree(logdir, ignore_errors=True)
    runner.timings["total"] = round(time.perf_counter() - t_start, 3)

    raw = {**runner.raw, "timings": runner.timings}
    doc = {
        "tier": "server",
        "title": "Server (FastAPI WebSocket relay)",
        "meta": build_meta(args.quick, keys),
        "sections": runner.sections,
        "findings": build_findings(raw),
        "raw": raw,
    }
    with open(args.out, "w") as fh:
        json.dump(doc, fh, indent=2, default=str)

    log("timings (s): " + ", ".join(f"{k} {v:.2f}" for k, v in runner.timings.items()))
    mode = "quick" if args.quick else "full"
    log(f"wrote {args.out} ({mode} mode, {runner.timings['total']:.1f} s)")


if __name__ == "__main__":
    main()
