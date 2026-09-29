# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Two independent projects, no root package.json: `client/` (React 19 + Vite + react-three-fiber, npm) and `server/` (FastAPI on Modal, uv). `README.md` is the single authoritative doc for rules, protocol, and architecture; `client/README.md` is untouched Vite boilerplate.

## Commands

Client (run from `client/`):
- `npm run lint` / `npm run build` (`tsc -b` is the only typecheck) / `npm run test` (vitest; `npx vitest run src/engine/board.test.ts` for one file)
- `npm run e2e` — Playwright boots uvicorn on :8000 and Vite on :5173 itself; do not start servers first. See `/run-3d-chess` for driving the app and screenshots.
- `node scripts/showcase.mjs [--stills] --out <dir>` — records the board playing a scripted game (MP4, or PNG stills of key moments; `--review` and `--interact` for contact sheets and pointer beats); needs a local backend and Vite already running (unlike e2e) and ffmpeg for video.
- `node scripts/showcase.mjs --orbit [--seat black] [--width 390 --height 844] --out <dir>` — a slow 360° orbit at five elevations plus a climb, to `orbit.mp4`, a contact sheet and a jitter report of the tower's centre and every label; `--stills` skips the video. Needs a backend and Vite running, like the showcase.
- `node scripts/pieces.mjs [--piece <type>] --out <dir>` — saves the piece gallery (`pieces.html`, dev only) as a PNG: every piece from the side, three-quarters and above, light and dark; needs only Vite running.
- `node bench/run.mjs [--quick] [--only client,server,browser] [--compare <dir>] [--repeat N] [--files engine --grep <case>]` (repo root) — the benchmark suite, each tier in turn, into `bench/RESULTS.md` (README "Benchmarks"). For a perf change: `cp -r bench/out /tmp/base` first, then rerun with `--compare /tmp/base`; iterate on one file or case with `npx vitest bench --config vitest.bench.config.ts bench/<file>.bench.ts -t <name>` in `client/`. The browser tier builds and serves the client and starts its own backend. Benchmark runs contend with anything else on the machine: run nothing else meanwhile. If the client tier stops on a fixture check, the engine's rules changed (run `npm run test`); `EXPECTED` in `client/bench/fixtures.ts` is only updated when a fixture changes on purpose.
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
- **The HUD** (`screens/TurnPill.tsx`, `CapturedPieces.tsx`, `MoveCard.tsx`, `MoveAnnouncer.tsx`, styled in `index.css`; README "HUD"): e2e and `showcase.mjs` read the game through its hooks, never its words: `turn-indicator`'s `data-turn`/`data-check`/`data-result`/`data-winner`, `seat`'s `data-seat`, `opponent-presence`'s `data-online` and `move-announcer`'s `data-last-move`/`data-move-count`. Keep them. The move box must stay the first Tab stop on the board screen and the announcer and the visually hidden move list are how a screen reader follows the game; never `display: none` them. The captured pieces under the pill must never cover the tower: the camera fit keeps their row clear (`hudTop`), and `e2e/hudFit.spec.ts` checks every HUD rect against every piece and label.
- **The camera's framing** (`three/FitCameraToBoard.tsx`, `three/cameraFit.ts`; README "Camera"): the view never slides: the camera only turns about the tower's centre and moves nearer or farther, and the centre stays at one point on screen. The fit and the lens shift come from the layout's `frameRings`, circles about the tower's axis, and are set when the view is fitted (opening, a window resize), never as the camera turns, climbs or zooms; the shift has no sideways part. Never centre on what the camera sees (the outline, the labels as placed), and never re-centre per pose: both slide the view under the player's hand.
- **The labels** (`three/scene/labelAnchors.ts`; README "The board"): the five level letters share one corner post (`letterCorner`: from low down the far end of the row facing the camera, a side of the tower's outline with no labels; past 55° up, until back under 45°, the one touching neither the files' edge nor the ranks') and change post together, only past a hysteresis band; no two labels overlap, no letter stands on the tower on screen at the side post, and the letters never line up with the files or ranks as one axis. Labels are depth-tested so only a piece hides one: never turn it off, and keep everything on the platforms (glass, border, rim) writing no depth and drawn before `LAYER.label`. Any change to the camera's fitting or to the labels must pass `cameraSweep.test.tsx`, `scene/labelSweep.test.ts` and `e2e/orbit.spec.ts`, and be reviewed with `node scripts/showcase.mjs --orbit` from both seats, desktop and phone: watch the continuous orbit video, not sampled poses, and read its jitter report.
- Three coordinate systems: engine 0-indexed `(x,y,z)`, wire/display strings like `Aa1`, and the Three.js scene. Conversions live in `client/src/engine/coords.ts`; keep scene math inside `client/src/three/`.
- **The board** (README "The board"): `Board.tsx` owns every interaction rule; the scene (`client/src/three/scene/`) only draws. Its grid, markers and effects render in the `board-decor` group, outside the clickable `board-grid` group, so decoration can never take a click. Board, `PieceMesh` and `GameScreen` import the scene's parts directly, and unit tests stand them in with `vi.mock` (see `Board.test.tsx`). Piece geometry (`client/src/three/pieces/`, README "Piece set") is built once and shared by every piece, as are the hit proxies in `PieceMesh.tsx`: never modify either in place. The canvas renders on demand, so a value read only in `useFrame` must `invalidate()` when it changes. Animations run on r3f's clock (never `setTimeout`) so `scripts/showcase.mjs`, which records on a virtual clock, captures them.

## Gotchas

- `npm run dev` with no `VITE_WS_URL` connects to the **production** Modal backend. For a local backend, export `VITE_WS_URL=ws://127.0.0.1:8000/ws` before starting Vite (it is inlined at startup).
- Seat color persists in `localStorage` keyed by game id, so a second tab of the same game takes over the seat (the first tab gets a "replaced" notice via close code 4001 and stops reconnecting). For two players use two browser contexts. The creator's color is random. The board only mounts once both players are seated.
- The e2e suite writes `playwright-report/` and traces only on CI (`reporter`/`retries` are CI-conditional in `playwright.config.ts`).
- Python is pinned `>=3.13,<3.14`; `datamodel-code-generator` is pinned exactly so generated output is byte-stable. Keep `uv.lock` tracked.

## Git

- Conventional Commits with scope: `feat(client):`, `fix(server):`, `test(e2e):`, `ci:`, `docs:`.
- Branch and open a PR to `main`; never push to `main` directly. Merging to `main` deploys to Modal via CI.
