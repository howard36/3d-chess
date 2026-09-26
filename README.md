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
- **Pawn** — no double first move, no en passant. Non-capture: one step forward _or_ one
  step up (player's choice). Capture, relative to White: forward-up (0,+1,+1),
  forward-left/right (∓1,+1,0), up-left/right (∓1,0,+1). Promotes **only** on squares
  where both rank and level are maximal (White: rank 5 on level E) or minimal (Black:
  rank 1 on level A), to Q/R/B/N/U (the player picks from a prompt).

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
│ game/     derive ALL state from the log    │          │  - relays to live sockets    │
│ screens/  wire that state to the UI        │          │  - replays history on rejoin │
│ three/    render board, raycast clicks     │          │                              │
└────────────────────────────────────────────┘          └──────────────────────────────┘
```

Key decisions:

- **Event-sourced client state.** The client never mutates a board directly. It keeps the
  ordered log of received messages and derives everything (board, turn, phase, game over)
  by replaying moves from the fixed starting position. The derivation is pure code in
  `client/src/game/` (`history.ts` replays the record, `session.ts` reads the seat,
  presence and errors); `GameScreen` only wires its output to the UI. A local move is
  only _sent_; the board updates when the server's `move_made` echo arrives. This keeps
  both clients in lockstep and makes rejoin trivial. The replay hands back the same
  result object while the move record is unchanged, so a presence or error message
  neither replays the game nor resets the 3D board (which would drop the player's
  selection).
- **Server = relay + durable move log.** Per game the server stores `{seats, moves}` (plus
  `claimants`, which client id claimed each seat) in a `modal.Dict` (durable) and keeps
  live sockets in a plain in-process dict (ephemeral).
  A disconnect detaches the socket but leaves the game record intact; `rejoin_game`
  reclaims a seat and receives the full history in a `game_state` message.
  Last-connection-wins on rejoin, so a refreshed tab can't be locked out by its own
  half-open predecessor; an automatic reconnect is the exception (see Protocol).
- **Concurrency model.** One container, one event loop, cooperative scheduling. Because
  `modal.Dict` returns deserialized copies, every mutation is read-modify-write and is
  written back **before any `await`** — that ordering is what makes concurrent handlers
  safe. Two rules keep it true, and `test_store_ops.py` asserts both: the store operations
  in `modal_app.py` (`create_game`, `claim_seat`, `find_seat`, `record_move`) are
  synchronous functions, so nothing inside them can yield to the event loop; and the
  WebSocket handler never reads or writes the store itself, only passes it to those
  operations. `modal.Dict`'s calls block; never switch to the `.aio` variants.
- **Seat persistence on the client.** The assigned color is stored in
  `localStorage` (`client/src/lib/playerRole.ts`) keyed by game id, and is used to
  auto-`rejoin_game` on page load **and** after any mid-session drop: the socket hook
  reconnects with capped exponential backoff, each freshly opened socket bumps a session
  counter, and the game screen re-claims its seat once per session. The client derives
  moves from the **latest** `game_state` snapshot plus the `move_made` messages after it,
  so a reconnect's replayed history never double-counts moves already in the log. Moves
  queued while disconnected are dropped rather than delivered into a game that may have
  advanced (the board never showed them — the player just moves again). The board takes
  no input on a fresh socket until its rejoin is answered: before that it shows the
  position from before the drop, and a move made against it could be recorded but
  unplayable. A `create_game` or `join_game` whose answer is lost to a drop is sent again
  on the next socket. Leaving a game's page (for the start screen, or straight for
  another game's page through history) resets the socket session.
- **Tab identity.** Each tab picks a random `clientId` (`client/src/lib/clientId.ts`,
  kept in `sessionStorage`, so it survives a reload but is not shared with other tabs)
  and sends it with `create_game`, `join_game` and `rejoin_game`.
- **Input.** The board acts on a click (primary button, released within a few pixels of
  the press), never on pointer-down, so a drag, right-drag or pinch that starts over the
  cube only turns the view. With a piece selected, clicking an opposing piece it can take
  plays the capture (the piece fills its cell, so it would otherwise hide the cell's click
  target). A move can also be typed (`Ab2-Ab3`, `=Q` to promote) in the move box, which is
  how a keyboard-only or screen-reader player plays.

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
2. Joiner opens `/game/:gameId`, sends `join_game {gameId, clientId?}` → the joiner gets
   `game_joined {color}` (its seat, confirmed before anything is broadcast, so a drop right
   after is still rejoinable), then both players get `game_start {color}`. A `join_game`
   from the client id that already claimed a seat in the game gets that seat again rather
   than `game_full`, so a tab whose `game_joined` was lost can simply repeat its join.
3. Moves: `move {from, to, promotion?}` → server checks turn parity → `move_made` to both.
4. Reload/rejoin: `rejoin_game {gameId, color, clientId?, takeover?}` →
   `game_state {color, started, moves}`.
   If another socket already held that seat, the server closes it with WebSocket close
   code **4001 `seat_replaced`** (last connection wins). The client treats that code as
   "stop reconnecting": it shows a _this game is open in another tab_ notice with a button
   that rejoins and takes the seat back, instead of retrying and evicting the newer tab in
   turn. Any other close is a network fault and is retried with backoff.
   The client sends `takeover: false` on an automatic reconnect (and `true`, the default,
   on page load and "Play here"). With `takeover: false` the server refuses with error
   `seat_in_use` if the seat is held by a live socket of a _different_ client id, so a tab
   that was offline while the player moved to another tab does not take the seat back
   unasked; it shows the same notice instead. Its own half-open predecessor (same client
   id) it still replaces.
5. Presence: after a join or rejoin the server sends each player
   `presence {color: <opponent>, online}` for the opponent's current state, and tells the
   opponent the player is online; when a player's live socket drops it tells the opponent
   `online: false`. A replaced socket's late disconnect is not a departure. The client shows
   "Opponent: online/offline" from the latest presence message about the opponent.

Coordinates on the wire use the display notation described below (e.g. `"Aa1"`).

## Coordinate systems (three of them)

**1. Engine (internal):** 0-indexed `(x, y, z)` — `x` = file, `y` = rank (White moves
toward +y, "forward"), `z` = level (White promotes toward +z, "up").

**2. Display / wire:** `ZXY` strings — Level `A–E` (z), file `a–e` (x), rank `1–5` (y).
So internal `(0,0,0)` = `Aa1`, `(4,4,4)` = `Ee5`. Conversions live in
`client/src/engine/coords.ts`.

**3. Rendering (Three.js scene):** `toWorld()` in `client/src/three/layout.ts` maps an
engine coordinate to a world position, **oriented to the viewing player**. For White the
engine axes map straight onto world axes, with the level axis negated so that level A is
nearest the camera; for Black all three axes are mirrored (`v → 4 − v`), which is the
symmetry the starting position is built on, so each player sees their own army laid out
identically and their own levels nearest. The default camera sits at `[6.5, 5, 8.5]`
(mostly on +Z, up and to the right) looking at the cube's centre, so:

| Game concept                      | Engine axis | World axis | On screen (default camera, viewing player) |
| --------------------------------- | ----------- | ---------- | ------------------------------------------ |
| File a–e                          | x           | X          | left → right (mirrored for Black)          |
| Rank 1–5 (the player's "forward") | y           | Y          | bottom → top (own back rank at the bottom) |
| Level A–E (the game's "up")       | z           | −Z         | near → far (own levels nearest the camera) |

So the game's "vertical" (levels) is rendered as **depth**, and the game's "forward"
(ranks) as **screen height**. Concretely, for White: the ten starting pawns (rank 2,
levels A+B) are the second-from-bottom horizontal row of the cube, in the two slices
nearest the camera; moving a pawn "up a level" moves it away from the viewer, not up the
screen. Black sees the mirror image, with Black's pawns nearest. OrbitControls allows free
rotation, so the default view is just a starting point. Only positions are transformed;
piece meshes are never mirrored. This is the classic (lattice) layout; a design may lay
the cells out differently (see Board designs — the tower layout makes levels vertical).
The classic position math is in `three/layout.ts`, the others in
`three/designs/kit/layouts.ts`; the floor rings and the glide
lift in `three/Board.tsx` and `three/motion.ts` assume world-Y-up, and the camera lives in
`screens/GameScreen.tsx` (its starting direction) and `three/cameraFit.ts` (its distance,
fitted to the window's shape so the whole cube is framed on a phone too). The engine and wire formats are independent of rendering, and
the e2e click helpers project through the live camera.

## Board designs

The look of the game is a swappable **design** (`client/src/three/designs/`). The board
style picker (top right, in game and on the start screen) switches between them; the
choice is cosmetic, per browser (`localStorage`), and never sent to the opponent. A
`?design=<id>` in any address selects and remembers one, so a shared link can carry a
look. Classic is bundled; every other design is its own lazily loaded chunk.

A design (`designs/types.ts`) is data plus components: a **layout** (where the 125 cells
sit: the classic *lattice* above, or a *tower* of five stacked boards with levels going
up, Raumschach style — Black walks around the tower rather than seeing it upside down),
the **stage** (background, lights, atmosphere, post-processing), the visible **grid**,
the **piece bodies**, the **markers** (legal move, capture, selection, last move, check),
the **motion** of a move (`hop`, `bounce`, `slide`, `teleport`), optional move, capture
and mate **effects**, and the **HUD** styling as CSS variables (`--hud-*`, `--turn-*`,
`--modal-*`, `--page-*`; every one falls back to the classic look). `Board.tsx` keeps all
interaction rules and renders a design's decoration outside its clickable group, so
nothing decorative can take a click; designs share a kit (`designs/kit/`) of layouts,
bloom, particles, confetti, labels and procedural textures. Adding one means a folder
with an `index.tsx` default-exporting a `Design`, plus an entry in `designs/registry.ts`.

To compare designs, `client/scripts/showcase.mjs` records one playing a scripted game
(captures, a check, a queen trade, a mate) to an MP4, or saves stills of the key moments
with `--stills`. It needs the app running against a local backend (see Development) and
drives the page on a virtual clock, so a slow software renderer still yields a smooth,
full-rate video:

```bash
cd client && node scripts/showcase.mjs --design royal --out /tmp/showcase   # ffmpeg on PATH
```

## Repository layout

```
client/          React app (Vite). Engine in src/engine, log-derived game state in src/game,
                 UI in src/screens + src/three.
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

# Deploy backend manually (not normally needed — CI deploys on merge to main).
# GITHUB_SHA is what /health reports; without it the image says "dev".
cd server && GITHUB_SHA=$(git rev-parse HEAD) uv run --extra deploy modal deploy modal_app.py
# Try a change without touching production: a separate app name AND a separate game
# store (GAMES_STORE names the modal.Dict; the default is production's). Stop it after.
cd server && GAMES_STORE=3d-chess-games-staging uv run --extra deploy \
  modal deploy modal_app.py --name 3d-chess-backend-staging
cd server && uv run --extra deploy modal app stop 3d-chess-backend-staging -y
```

CI (GitHub Actions) runs server tests, client lint (ESLint + Prettier check), build, and
unit tests, and the E2E suite on every push/PR to `main`; on an E2E failure the Playwright
HTML report and trace are uploaded as a workflow artifact. On a push to `main` — and only
once those three jobs pass — it also deploys the backend to Modal. The deploy bakes the
commit SHA into the image as `APP_VERSION`, and the job polls `/health` until it reports
that SHA, so a deploy that never starts serving fails the job rather than passing on the
previous (already healthy) deployment. The production image is built with
`Image.uv_sync` from `server/uv.lock`, so it runs exactly the dependency versions the
tests ran against. Authentication comes from the `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET`
repo secrets. The frontend is deployed separately by Cloudflare Pages' GitHub
integration (configured in Cloudflare, not in this repo); it shows up as the "Cloudflare
Pages" check on pull requests.

## Known limitations (accepted for this project's scope)

- The server doesn't detect checkmate/stalemate; game-over is decided independently by
  each client.
- A WebSocket session is bounded by the Modal function timeout (1 hour). The client
  auto-reconnects and rejoins when that (or any drop) severs the socket, so the
  interruption is a brief "Reconnecting…" rather than a frozen game.
- One seat, one live tab. Opening your own game in a second tab of the same browser moves
  the seat to that tab; the first tab is told so and can take it back, but the two never
  play simultaneously.
- Modal's edge rejects binary WebSocket frames before they reach the app; the local
  uvicorn backend answers them with an `invalid_message` error instead. The client only
  ever sends text.
- The server records any shape-valid, turn-correct move without checking legality. The
  client replays history defensively — a record it cannot apply, or one that leaves a
  position it cannot evaluate (a captured king), freezes the board at the last good
  position with an explanation instead of crashing — but it cannot repair the record.
- No resign or draw offer: games end only by checkmate or stalemate.
- No spectators: a game has exactly two seats.
