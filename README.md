# 3D Chess Online Multiplayer

A web app for playing a 5×5×5 3D chess variant (Raumschach-style: standard pieces plus the
Unicorn) with a friend over a shareable link. React + Three.js frontend, small Python
WebSocket relay on Modal.

This README is the current, authoritative documentation.

## Game rules

Played on a 5×5×5 grid. Squares are addressed as level `A–E` (bottom→top in game terms),
file `a–e`, rank `1–5`. White starts at low ranks/levels and moves toward higher ones
("forward" = +rank, "up" = +level); Black is mirrored.

Movement (deltas over file/rank/level; sliders repeat the step and cannot pass through
pieces):

- **Rook** — ±n along exactly one axis.
- **Bishop** — ±n along exactly two axes (planar diagonals).
- **Unicorn** — ±n along all three axes (space diagonals).
- **Queen** — Rook + Bishop + Unicorn. **King** — any Queen direction, one step.
- **Knight** — (±2, ±1, 0) in any axis order; jumps over pieces.
- **Pawn** — no double first move, no en passant. Non-capture: one step forward *or* one
  step up (player's choice). Capture, relative to White: forward-up (0,+1,+1),
  forward-left/right (∓1,+1,0), up-left/right (∓1,0,+1). Promotes **only** on squares
  where both rank and level are maximal (White: rank 5 on level E) or minimal (Black:
  rank 1 on level A), to Q/R/B/N/U (the UI currently auto-selects Queen).

No castling. Check, checkmate, and stalemate work as in standard chess and are detected
by the client engine. The starting position is defined in `Board.setupStartingPosition()`
(`client/src/engine/board.ts`): White's back ranks on rank 1 are R N K N R (level A) and
B U Q B U (level B), with ten pawns on rank 2 across levels A+B; Black mirrors this on
ranks 4–5 / levels E+D, with its second back rank ordered U B Q U B.

## Scope and trust assumptions

This is a hobby project for games among friends. The design leans on that deliberately:

- **Very few active players.** A single Modal container (`max_containers=1`) handles all
  games. In-memory per-container state is fine; there is no horizontal scaling story, on
  purpose.
- **All clients are trusted and run the expected code.** The full rules engine lives in the
  browser; the server validates only message shape and turn order, **not move legality**.
  A modified client could submit illegal moves or claim the opponent's seat (rejoining a
  seat requires only the game id and a color, no secret). Those are non-goals here — the
  threat model is "my friends", not "the internet".
- **Games are ephemeral.** Move history is stored in a `modal.Dict` so games survive
  container restarts and page reloads, but records expire after ~30 days of inactivity and
  nothing else is persisted. No accounts, no history, no matchmaking.

If the project ever outgrows these assumptions, the first things to revisit are:
server-side move validation and a per-seat secret for rejoin.

## Architecture

```
client (React 19 + Vite + @react-three/fiber)          server (FastAPI on Modal)
┌────────────────────────────────────────────┐          ┌──────────────────────────────┐
│ engine/   full rules: move gen, check,     │   WS     │ modal_app.py                 │
│           mate, stalemate                  │◄────────►│  - validates shape + turn    │
│ hooks/useGameSocket  append-only message   │  JSON    │  - appends moves to durable  │
│           log over one WebSocket           │          │    game record (modal.Dict)  │
│ screens/  derive ALL state from the log    │          │  - relays to live sockets    │
│ three/    render board, raycast clicks     │          │  - replays history on rejoin │
└────────────────────────────────────────────┘          └──────────────────────────────┘
```

Key decisions:

- **Event-sourced client state.** The client never mutates a board directly. It keeps the
  ordered log of received messages and derives everything (board, turn, phase, game over)
  by replaying moves from the fixed starting position. A local move is only *sent*; the
  board updates when the server's `move_made` echo arrives. This keeps both clients in
  lockstep and makes rejoin trivial.
- **Server = relay + durable move log.** Per game the server stores `{seats, moves}` in a
  `modal.Dict` (durable) and keeps live sockets in a plain in-process dict (ephemeral).
  A disconnect detaches the socket but leaves the game record intact; `rejoin_game`
  reclaims a seat and receives the full history in a `game_state` message.
  Last-connection-wins on rejoin, so a refreshed tab can't be locked out by its own
  half-open predecessor.
- **Concurrency model.** One container, one event loop, cooperative scheduling. Because
  `modal.Dict` returns deserialized copies, every mutation is read-modify-write and is
  written back **before any `await`** — that ordering is what makes concurrent handlers
  safe, so preserve it when editing `modal_app.py`.
- **Seat persistence on the client.** The assigned color is stored in
  `localStorage` (`client/src/lib/playerRole.ts`) keyed by game id, and is used to
  auto-`rejoin_game` on page load **and** after any mid-session drop: the socket hook
  reconnects with capped exponential backoff, each freshly opened socket bumps a session
  counter, and the game screen re-claims its seat once per session. The client derives
  moves from the **latest** `game_state` snapshot plus the `move_made` messages after it,
  so a reconnect's replayed history never double-counts moves already in the log. Moves
  queued while disconnected are dropped rather than delivered into a game that may have
  advanced (the board never showed them — the player just moves again).

## Protocol

The WebSocket message schema lives in **`server/schema.json`** — that file is the source of
truth, including the enumerated error codes. Both sides' models are generated from it, and
CI fails if either generated file is stale:

```bash
# Python models (server/messages.py); datamodel-code-generator is pinned in
# server/pyproject.toml's test extra so output is byte-stable
cd server && uv run datamodel-codegen --input schema.json --input-file-type jsonschema \
  --output messages.py --output-model-type pydantic_v2.BaseModel --disable-timestamp

# TypeScript types (client/src/types/schema.ts)
cd client && npm run generate:types
```

App code imports the TypeScript types via the thin re-export layer
`client/src/types/messages.ts`, never from the generated file directly.

Message flow, happy path:

1. Creator: `create_game` → `game_created {gameId, color}` (creator's color is random).
2. Joiner opens `/game/:gameId`, sends `join_game` → both players get `game_start {color}`.
3. Moves: `move {from, to, promotion?}` → server checks turn parity → `move_made` to both.
4. Reload/rejoin: `rejoin_game {gameId, color}` → `game_state {color, started, moves}`.

Coordinates on the wire use the display notation described below (e.g. `"Aa1"`).

## Coordinate systems (three of them)

**1. Engine (internal):** 0-indexed `(x, y, z)` — `x` = file, `y` = rank (White moves
toward +y, "forward"), `z` = level (White promotes toward +z, "up").

**2. Display / wire:** `ZXY` strings — Level `A–E` (z), file `a–e` (x), rank `1–5` (y).
So internal `(0,0,0)` = `Aa1`, `(4,4,4)` = `Ee5`. Conversions live in
`client/src/engine/coords.ts`.

**3. Rendering (Three.js scene):** `client/src/three/Board.tsx` maps engine axes to scene
axes **identically** — engine `x→scene x`, `y→scene y`, `z→scene z`. Because Three.js
screen-up is +y and the default camera looks down the −z axis from `[0, 0, 5]`, that means:

| Game concept                    | Engine axis | On screen (default camera)     |
| ------------------------------- | ----------- | ------------------------------ |
| File a–e                        | x           | left → right                   |
| Rank 1–5 (White's "forward")    | y           | bottom → top                   |
| Level A–E (the game's "up")     | z           | far → near (toward the viewer) |

So the game's "vertical" (levels) is rendered as **depth**, and the game's "forward"
(ranks) is rendered as **screen height**. Concretely: White's ten starting pawns (rank 2,
levels A+B) appear as the second-from-bottom horizontal slab of the cube, in the two
slices farthest from the camera; moving a pawn "up a level" moves it toward the viewer,
not up the screen. Both players get the same default orientation (there is no camera flip
for Black — Black's pieces start at the top of the screen), and OrbitControls allows free
rotation, so the default orientation is just a starting point. This axis mapping is a
deliberate simplification; if it's ever changed (e.g. to make levels vertical), only the
scene-position math in `three/Board.tsx` should change — the engine and wire formats are
independent of rendering.

## Repository layout

```
client/          React app (Vite). Engine in src/engine, UI in src/screens + src/three.
client/e2e/      Playwright tests; boots the real server and Vite (see playwright.config.ts).
server/          FastAPI app + Modal deployment (modal_app.py), schema, generated models, pytest suite.
```

## Development

Prereqs: Node (version in `.nvmrc`), [uv](https://docs.astral.sh/uv/) for Python.

```bash
# Frontend (uses the deployed Modal backend by default)
cd client && npm ci && npm run dev

# Local backend instead of Modal (no Modal account needed)
cd server && uv run --extra test uvicorn modal_app:create_web_app --factory --port 8000
# then point the client at it:
cd client && VITE_WS_URL=ws://127.0.0.1:8000/ws npm run dev

# Tests
cd client && npm run test          # unit/component (Vitest)
cd client && npm run e2e           # Playwright; starts server + Vite itself
uv run --project server pytest     # server tests (spawns a real uvicorn)

# Deploy backend manually (not normally needed — CI deploys on merge to main)
cd server && modal deploy modal_app.py
```

CI (GitHub Actions) runs server tests, client lint/build/test, and the E2E suite on every
push/PR to `main`. On a push to `main` — and only once those three pass — it also deploys
the backend to Modal and polls `/health` to confirm the new version is serving, so the
deployed app always matches `main`. Authentication comes from the `MODAL_TOKEN_ID` and
`MODAL_TOKEN_SECRET` repo secrets.

## Known limitations (accepted for this project's scope)

- Pawn promotion auto-selects Queen; the engine and protocol support underpromotion but
  there is no picker UI.
- The server doesn't detect checkmate/stalemate; game-over is decided independently by
  each client.
- A WebSocket session is bounded by the Modal function timeout (1 hour). The client
  auto-reconnects and rejoins when that (or any drop) severs the socket, so the
  interruption is a brief "Reconnecting…" rather than a frozen game.
- The server records any shape-valid, turn-correct move without checking legality. The
  client replays history defensively — an unplayable record freezes the board at the last
  good position with an explanation instead of crashing — but cannot repair the record.
- No resign or draw offer: games end only by checkmate or stalemate.
- No spectators: a game has exactly two seats.
