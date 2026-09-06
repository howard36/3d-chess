# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Two independent projects, no root package.json: `client/` (React 19 + Vite + react-three-fiber, npm) and `server/` (FastAPI on Modal, uv). `README.md` is the single authoritative doc for rules, protocol, and architecture; `client/README.md` is untouched Vite boilerplate.

## Commands

Client (run from `client/`):
- `npm run lint` / `npm run build` (`tsc -b` is the only typecheck) / `npm run test` (vitest; `npx vitest run src/engine/board.test.ts` for one file)
- `npm run e2e` — Playwright boots uvicorn on :8000 and Vite on :5173 itself; do not start servers first. See `/run-3d-chess` for driving the app and screenshots.
- `npx prettier --write <file>` — `.prettierrc` is the intended style (single quotes, trailing commas, width 100); it is not wired into ESLint.

Server (run from repo root): `uv run --project server pytest` (spawns a real uvicorn on a random port). `uv sync --extra test` in `server/` once first. Lint/format: `uv run --project server ruff check server` and `ruff format server`.

`/check` runs the full CI-equivalent locally, including the codegen gates below.

## Protocol types are generated and CI-gated

`server/schema.json` is the source of truth. After any edit, regenerate both files and commit them (`/regen-types`); CI fails on `git diff --exit-code` for either:
- `cd server && uv run datamodel-codegen --input schema.json --input-file-type jsonschema --output messages.py --output-model-type pydantic_v2.BaseModel --disable-timestamp`
- `cd client && npm run generate:types` → `src/types/schema.ts`

Client code imports wire types from `client/src/types/messages.ts` (hand-written re-exports), never from `schema.ts`.

## Invariants to preserve

- **Server** (`server/modal_app.py`): `modal.Dict` returns copies, so every store mutation is read-modify-write and must be written back **before any `await`**. That ordering is the entire concurrency-safety argument (single container, single event loop).
- **Client**: board state is event-sourced from the message log (latest `game_state` snapshot + subsequent `move_made`). Never mutate the board directly; a local move is only sent, and the board updates when the server echoes `move_made`.
- The server validates message shape and turn parity only; the rules engine lives in `client/src/engine/`, which has a 90% coverage threshold in vitest.
- `window.__r3fState`, published by the `Canvas onCreated` hook in `client/src/screens/GameScreen.tsx`, exists solely so e2e can project clicks. Removing it breaks the e2e suite.
- Three coordinate systems: engine 0-indexed `(x,y,z)`, wire/display strings like `Aa1`, and the Three.js scene. Conversions live in `client/src/engine/coords.ts`; keep scene math inside `client/src/three/`.

## Gotchas

- `npm run dev` with no `VITE_WS_URL` connects to the **production** Modal backend. For a local backend, export `VITE_WS_URL=ws://127.0.0.1:8000/ws` before starting Vite (it is inlined at startup).
- Seat color persists in `localStorage` keyed by game id, so use two browser contexts, not two tabs. The creator's color is random. The board only mounts once both players are seated.
- Vitest prints `<meshStandardMaterial /> is using incorrect casing` warnings; that is pre-existing noise, not a failure.
- Python is pinned `>=3.13,<3.14`; `datamodel-code-generator` is pinned exactly so generated output is byte-stable. Keep `uv.lock` tracked.

## Git

- Conventional Commits with scope: `feat(client):`, `fix(server):`, `test(e2e):`, `ci:`, `docs:`.
- Branch and open a PR to `main`; never push to `main` directly. Merging to `main` deploys to Modal via CI.
