"""Store models and a uvicorn factory for the server benchmarks.

Production keeps game records in a `modal.Dict`: every call is a blocking
network RPC that (de)serializes the value, so `record_move` reads and rewrites
the whole record (every move so far) on each move. Local dev passes a plain
dict, which has neither cost. The models here sit between the two:

- `dict`:        plain dict (what `create_web_app()` uses locally).
- `pickle`:      copy-on-read/write; every get/contains/set pickles or
                 unpickles, like modal.Dict's serialization, with no latency.
- `latent:<ms>`: `pickle` plus a blocking `time.sleep` per call, a MODEL of
                 modal.Dict's synchronous RPC with an assumed latency. The real
                 latency is not measured here.

Run under uvicorn with the model named in BENCH_STORE, from server/:

    BENCH_STORE=latent:2 python -m uvicorn bench_app:create_bench_app --factory \\
        --app-dir bench --port 8000

This module stays import-light (modal_app is imported inside the factory) so
the flood attacker process can reuse `die_with_parent` without paying for
FastAPI/Modal imports.
"""

from __future__ import annotations

import ctypes
import os
import pickle
import signal
import sys
import time
from typing import Any

_MISSING = object()
_PR_SET_PDEATHSIG = 1


def die_with_parent() -> None:
    """Have the kernel SIGTERM this process when the benchmark runner exits.

    The runner exports BENCH_PARENT_PID to every process it spawns, so a runner
    killed mid-run (e.g. by an agent's timeout) never leaves servers behind.
    Linux only; a no-op elsewhere or when the variable is unset.
    """
    parent = os.environ.get("BENCH_PARENT_PID")
    if not parent or not sys.platform.startswith("linux"):
        return
    try:
        ctypes.CDLL(None, use_errno=True).prctl(_PR_SET_PDEATHSIG, signal.SIGTERM)
    except (OSError, AttributeError):
        return
    if os.getppid() != int(parent):
        os._exit(1)  # the runner died before the death signal was armed


class PickleStore:
    """A store that hands out copies, like modal.Dict, optionally with latency.

    Implements only what modal_app's store operations use: `get`, `in`,
    item assignment (and item access for completeness).
    """

    def __init__(self, latency_ms: float = 0.0) -> None:
        self._data: dict[str, bytes] = {}
        self._latency_s = latency_ms / 1000.0
        self.calls = 0

    def _rpc(self) -> None:
        self.calls += 1
        if self._latency_s:
            time.sleep(self._latency_s)  # blocking, like modal.Dict's sync wrappers

    def get(self, key: str, default: Any = None) -> Any:
        self._rpc()
        blob = self._data.get(key, _MISSING)
        return default if blob is _MISSING else pickle.loads(blob)

    def __getitem__(self, key: str) -> Any:
        self._rpc()
        return pickle.loads(self._data[key])

    def __contains__(self, key: object) -> bool:
        self._rpc()
        return key in self._data

    def __setitem__(self, key: str, value: Any) -> None:
        self._rpc()
        self._data[key] = pickle.dumps(value, protocol=pickle.HIGHEST_PROTOCOL)

    def __len__(self) -> int:
        return len(self._data)

    # Benchmark-only helpers, never called by modal_app: they bypass the
    # modelled RPC so a timed loop can reset a record between samples.
    def raw_put(self, key: str, blob: bytes) -> None:
        self._data[key] = blob

    def raw_blob(self, key: str) -> bytes:
        return self._data[key]


def make_store(spec: str) -> Any:
    """Build a store from a model name: `dict`, `pickle` or `latent:<ms>`."""
    if spec == "dict":
        return {}
    if spec == "pickle":
        return PickleStore()
    if spec.startswith("latent:"):
        return PickleStore(latency_ms=float(spec.split(":", 1)[1]))
    raise ValueError(f"unknown store model {spec!r}")


def create_bench_app():
    """uvicorn --factory entry point; the store model comes from BENCH_STORE."""
    from modal_app import create_web_app

    die_with_parent()
    return create_web_app(store=make_store(os.environ.get("BENCH_STORE", "dict")))
