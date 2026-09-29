# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Two independent projects, no root package.json: `client/` (React 19 + Vite + react-three-fiber, npm) and `server/` (FastAPI on Modal, uv). `README.md` is the single authoritative doc for rules, protocol, and architecture; `client/README.md` is untouched Vite boilerplate.

## Commands

Client (run from `client/`):
- `npm run lint` / `npm run build` (`tsc -b` is the only typecheck) / `npm run test` (vitest; `npx vitest run src/engine/board.test.ts` for one file)
- `npm run e2e` — Playwright boots uvicorn on :8000 and Vite on :5173 itself; do not start servers first. See `/run-3d-chess` for driving the app and screenshots.
- `npx prettier --write <file>` — `.prettierrc` is the style (single quotes, trailing commas, width 100). `npm run lint` runs `prettier --check .` after ESLint, so CI fails on unformatted files; `.prettierignore` skips the generated `src/types/schema.ts`.

Server (run from repo root): `uv run --project server pytest` (spawns a real uvicorn on a random port). `uv sync --extra test` in `server/` once first. Lint/format: `uv run --project server ruff check server` and `ruff format server`.

`/check` runs the full CI-equivalent locally, including the codegen gates below.

## Protocol types are generated and CI-gated

`server/schema.json` is the source of truth. After any edit, regenerate both files and commit them (`/regen-types`); CI fails on `git diff --exit-code` for either:
- `cd server && uv run datamodel-codegen --input schema.json --input-file-type jsonschema --output messages.py --output-model-type pydantic_v2.BaseModel --disable-timestamp`
- `cd client && npm run generate:types` → `src/types/schema.ts`

Client code imports wire types from `client/src/types/messages.ts` (hand-written re-exports), never from `schema.ts`.

## Invariants to preserve

- **Server** (`server/modal_app.py`): `modal.Dict` returns copies, so every store mutation is read-modify-write and must be written back **before any `await`**. That ordering is the entire concurrency-safety argument (single container, single event loop). It holds because the `modal.Dict` calls *block*, the store operations (`create_game`, `claim_seat`, `find_seat`, `record_move`) are plain `def`s that cannot contain `await`, and the handler never touches `store` directly (it only passes it to those functions). Keep new mutations in that section, never convert them to `async def`, never index the store from the handler, and never switch to the `.aio` variants. `test_store_ops.py` enforces the first two structurally.
- **Client**: board state is event-sourced from the message log (latest `game_state` snapshot + subsequent `move_made`) by the pure functions in `client/src/game/` (gated at 90% coverage like the engine). Never mutate the board directly; a local move is only sent, and the board updates when the server echoes `move_made`. `deriveHistory` returns its previous result while the move record is unchanged; keep that identity guarantee, the 3D board clears its selection whenever the board object changes.
- The server validates message shape and turn parity only; the rules engine lives in `client/src/engine/`, which has a 90% coverage threshold in vitest.
- `window.__r3fState`, published by the `Canvas onCreated` hook in `client/src/screens/GameScreen.tsx`, exists solely so e2e can project clicks. Removing it breaks the e2e suite.
- Three coordinate systems: engine 0-indexed `(x,y,z)`, wire/display strings like `Aa1`, and the Three.js scene. Conversions live in `client/src/engine/coords.ts`; keep scene math inside `client/src/three/`.

## Gotchas

- `npm run dev` with no `VITE_WS_URL` connects to the **production** Modal backend. For a local backend, export `VITE_WS_URL=ws://127.0.0.1:8000/ws` before starting Vite (it is inlined at startup).
- Seat color persists in `localStorage` keyed by game id, so a second tab of the same game takes over the seat (the first tab gets a "replaced" notice via close code 4001 and stops reconnecting). For two players use two browser contexts. The creator's color is random. The board only mounts once both players are seated.
- The e2e suite writes `playwright-report/` and traces only on CI (`reporter`/`retries` are CI-conditional in `playwright.config.ts`).
- Python is pinned `>=3.13,<3.14`; `datamodel-code-generator` is pinned exactly so generated output is byte-stable. Keep `uv.lock` tracked.

## Git

- Conventional Commits with scope: `feat(client):`, `fix(server):`, `test(e2e):`, `ci:`, `docs:`.
- Branch and open a PR to `main`; never push to `main` directly (a ruleset blocks it). Merging to `main` deploys to Modal via CI.
- PRs are **squash-merged** (`gh pr merge --squash --delete-branch`), so the PR title becomes the commit subject on `main`: make it a Conventional Commit. The PR description becomes the commit body: say what changed and why, notable decisions, and how it was verified. Per-commit messages on the branch don't survive, so don't rely on them.
- One session, one branch, one PR, scoped to one logical change (it is what gets reverted or blamed). If the work grows a second concern, don't widen this PR: if it's independent, do it in parallel on its own branch from fresh `main` (another session or worktree) without waiting for this one to merge; if it depends on this PR, wait for it to merge, then branch from `main`. Don't stack PRs on unmerged PRs.
- Several agents may run in parallel. Stay in your own area, and avoid editing `server/schema.json` while another PR does. Independent PRs can be open and green at the same time; they merge one at a time, each updated onto the latest `main` first.
- The ruleset requires the branch to be up to date with `main` and CI green on that head. To update, merge `main` into the branch (never rebase or force-push a pushed branch). Don't hand-merge generated files (`server/messages.py`, `client/src/types/schema.ts`) or lockfiles: take either side and regenerate (`/regen-types`, `npm ci` / `uv lock`), then re-run `/check`. A clean textual merge can still break the build, so trust CI on the updated head, not the absence of conflicts.
