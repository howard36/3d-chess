# 3D Chess Online Multiplayer

A web app for playing 3D chess on a 5×5×5 board (the standard pieces plus the Unicorn,
which moves along space diagonals) with a friend over a shareable link. React + Three.js
frontend, small Python WebSocket relay on Modal.

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
(`client/src/engine/board.ts`); each army's pawns stand on a level of their own:

| Level | Rank 1    | Rank 2    | Rank 4    | Rank 5    |
| ----- | --------- | --------- | --------- | --------- |
| E     |           |           | u b q u b | r n k n r |
| D     |           |           | 5 pawns   | 5 pawns   |
| B     | 5 pawns   | 5 pawns   |           |           |
| A     | R N K N R | B U Q B U |           |           |

(files a→e left to right; upper case White, lower case Black). Black's army is White's
turned through the centre, `(x, y, z) → (4 − x, 4 − y, 4 − z)`. This is the traditional
5×5×5 set-up (pieces on rank 1 of levels A and B, pawns on rank 2) with rank and level
exchanged. Every rule treats the two axes alike, so move for move it is the same game.

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
  the press), never on pointer-down, so a drag or pinch that starts over the cube only
  moves the camera. With a piece selected, clicking an opposing piece it can take plays
  the capture (the piece fills its cell, so it would otherwise hide the cell's click
  target). On a touch screen, where the pieces are narrower than a fingertip, a tap that
  hits nothing the player can act on goes to the nearest thing they can (an own piece, the
  held piece, a destination or capture) within 22 px of its outline, a destination winning
  a near tie with another piece (`three/tapAssist.ts`, measured by `useTapAssist`); a tap
  with nothing in reach puts the selection down, and a mouse is never assisted. A move can
  also be typed (`Bb1-Cb1`, `=Q` to promote) in the move box, which is how a keyboard-only
  or screen-reader player plays: it is the first thing Tab reaches on the board screen, and
  appears when it does (see HUD).
- **Camera.** The only camera control is turning the view about the board's centre: drag
  with the left mouse button or one finger. The wheel or a two-finger pinch zooms. There
  is no pan (right-drag, a two-finger drag and the arrow keys do nothing), so the orbit
  target never leaves the centre. The zoom runs from 0.7× to 1.5× the distance that fits
  the board in the window (`zoomRange` in `three/cameraFit.ts`); `FitCameraToBoard`
  recomputes the fit and the range whenever the window changes shape (a phone turned on
  its side) and opens the camera inside it, so a phone zooms over the same share of its
  view as a desktop. What the fit frames is the same from every side: circles about the
  tower's axis round its platforms, its tallest pieces and every label wherever it can
  stand (the layout's `frameRings`, `towerFrameRings` in `three/scene/labelAnchors.ts`; the
  letters' rings only where their post can stand: anywhere but the front from low down,
  behind the tower from high up). It centres them
  between the band kept for the HUD's top pill and the captured pieces under it (82 px; 56
  in a short window, where they stand beside the tower: `hudTop`) and the bottom of the
  window (or a band kept clear above it, `bottomInset`, which only the landing page's
  preview asks for: see Landing page), by a lens shift (a view offset, `three/viewOffset.ts`) rather than a pan. A
  circle about the axis looks the same whichever way the camera has turned, so the shift
  is only ever vertical. It is set with the fit (on opening and when the window changes
  shape) and then left alone: turning, climbing and zooming never move the tower's centre
  on screen, so the camera only turns about it and moves nearer or farther, and the view
  never slides under the player's hand. (Centring the outline as seen, a diamond one
  moment and a square the next, slid the view sideways as it turned; re-centring the rings
  at every elevation slid it up and down, by over 100 px on a desktop, as it climbed.) The
  distance is fitted at the opening elevation, so from high up on a diagonal a wide window
  can cut the tower's nearest corner a little; zooming out shows it all. The layout's `orbit.minDistance` only narrows the range, and its
  polar-angle limits bound the elevation (from 14° below the horizon, to look up at the
  sky, to straight down). The controls (`three/CameraControls.tsx`) are three's own
  OrbitControls, registered as r3f's default controls, which `FitCameraToBoard`, the
  scene and `showcase.mjs` read. The canvas draws at the screen's pixel ratio up to 2x,
  within a budget of 4.5 million pixels (`three/pixelBudget.ts`), so a large
  high-density window costs no more than it needs.
- **Touch.** The game screen takes no text selection, long-press callout or double-tap
  zoom (iOS would otherwise select the whole page on a double tap), except in the move box
  (`.game-screen` in `client/src/index.css`); the canvas takes every
  touch itself (`touch-action: none`). When a mobile browser loses a finger's pointer-up,
  the controls would keep counting that finger and read the next one-finger drag as a
  pinch against it. `three/useTouchSafeControls.ts` checks the controls' pointers against
  the finger list of every touch event, and on a lost pointer capture, a blur or a hidden
  page, and drops the ones no finger accounts for, so a lone finger always turns the view
  (`e2e/touchCamera.spec.ts` loses a finger's pointer-up through real touch input).
- **HUD.** Quiet by default: a glass **turn pill** at the top centre (across the row, to a
  12 px gutter, on a phone held upright), and nothing else unless something needs saying.
  The pill's left half is the player and its right half the opponent, each with a small stone in its army's
  material (porcelain, charcoal); the half of the side to move is lit, its stone ringed in
  light ("Your move" / "Their move"), red with a CHECK badge in check. An opponent with no
  live connection shows as an outlined stone and "Offline"; a connected one is not marked.
  Once the game is over the pill gives the result from the player's side ("Checkmate · you
  win"). Under the pill hang the **captured pieces** (`screens/CapturedPieces.tsx`, from
  `GameHistory.captured` and `game/material.ts`): each side's haul under its own half, a
  silhouette per kind of piece taken (the promotion dialog's, `screens/PieceGlyph.tsx`) in
  the taken army's material with a count, and "+N" on the side ahead on material; one
  above the other at the top left in a short window. The camera fit keeps their row clear
  from the first move (`hudTop`), so a capture never moves the board, and a screen
  reader reads them as a sentence per side, never announced. Under them, only while they
  apply: "Reconnecting…" (the pill and the captures dim), the latest error and the
  frozen-record notice. The **move card** is never shown as a panel: it stays in the page out
  of sight, its list of moves for screen readers and its field to type a move (`Bb1-Cb1`),
  which is the first Tab stop on the board screen. The field appears while it has keyboard
  focus, at the bottom left (across the bottom in a window no wider than 13:9, at the bottom
  right in a short one), and Escape puts it away. A visually hidden live region announces
  every move as it lands ("White bishop Ad2 takes pawn on Dd5. Check. Your move.",
  `game/announce.ts`). The parts are `screens/TurnPill.tsx`,
  `CapturedPieces.tsx`, `MoveCard.tsx` and `MoveAnnouncer.tsx`, styled in `index.css`. For
  tests and tools the pill carries `data-turn`, `data-check`, `data-result` and
  `data-winner`; `data-testid="seat"` its `data-seat`; `opponent-presence` its
  `data-online`; `captured-pieces` each haul as `data-side` (`me`, `them`); and
  `move-announcer` the latest move as `data-last-move` (`Bb1-Cb1`, `=U` for a promotion)
  and `data-move-count`.
- **Landing page.** The start screen at `/` (`screens/StartScreen.tsx`) fills the window
  with a live preview (`screens/LandingPreview.tsx`): the real `Board`, drawn without its
  labels (`labels={false}`) and framed on the tower alone (`towerBodyRings`), plays a
  scripted 17-ply game ending in White's mate (`game/demo.ts`, the game `showcase.mjs`
  records) as a log of `move_made` messages through `deriveHistory`, like a live game,
  then fades under a veil and plays it again, while `three/AutoOrbit.tsx` turns the camera
  round the tower at a fixed elevation, a full turn every two passes
  (`three/landingView.ts`). The demo's clock is r3f's. The title and a tagline stand
  above the tower and "Start a game" below it, in bands the fit keeps clear (`hudTopBand`
  and `bottomBand`; a window 480 px tall or less sets the text in a column at the left
  instead). Under the button one line shows, first that applies: the create's error
  ("Couldn't start a game: …", `role="alert"`), the connection's state, "Checkmate ·
  White wins" while the demo's mate stands, or a few facts. The button is not disabled
  while the socket connects (the create is queued), only while it is answered ("Creating
  game…"). The canvas is `aria-hidden` and takes no pointer, and a visually hidden
  sentence says what it shows. A pause button at the top right ("Pause preview",
  `aria-pressed`, the second Tab stop after the start button) stops the demo, the turn and
  the drawing (the canvas draws no frames while paused). Under `prefers-reduced-motion`
  the preview is a still of the final position, the king left standing, and there is no
  pause button. In development `?t=<seconds>` starts the demo that far in.

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
   than `game_full`, so a tab whose `game_joined` was lost can simply repeat its join; it is
   answered with `game_joined` then a `game_state` snapshot (as a rejoin would be), not a
   second `game_start`.
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
   the opponent as offline (an outlined stone) from the latest presence message about them.

Coordinates on the wire use the display notation described below (e.g. `"Aa1"`).

## Coordinate systems (three of them)

**1. Engine (internal):** 0-indexed `(x, y, z)` — `x` = file, `y` = rank (White moves
toward +y, "forward"), `z` = level (White promotes toward +z, "up").

**2. Display / wire:** `ZXY` strings — Level `A–E` (z), file `a–e` (x), rank `1–5` (y).
So internal `(0,0,0)` = `Aa1`, `(4,4,4)` = `Ee5`. Conversions live in
`client/src/engine/coords.ts`.

**3. Rendering (Three.js scene):** the board is a tower of five glass levels, A at the
bottom. `toWorld()` (from `towerLayout()` in `client/src/three/layout.ts`) maps an engine
coordinate to a world position **oriented to the viewing player**. For White, file → X,
level → Y and rank → −Z, so level A is at the bottom and rank 1 nearest the camera; for
Black, files and ranks are turned about (`v → 4 − v`) and levels stay, so Black walks
round the tower rather than seeing it upside down: each player's first rank is nearest,
White's army at the bottom of the tower and Black's at the top. The camera opens 18° above
the horizon, turned 16° to the player's right (`layout.viewDirection`), looking at the
tower's centre, so:

| Game concept                      | Engine axis | World axis | On screen (opening view, viewing player) |
| --------------------------------- | ----------- | ---------- | ---------------------------------------- |
| File a–e                          | x           | X          | left → right (right → left for Black)    |
| Level A–E (the game's "up")       | z           | Y          | bottom → top, for both players           |
| Rank 1–5 (the player's "forward") | y           | −Z         | near → far (own first rank nearest)      |

So levels are **screen height** and ranks are **depth**. Concretely, for White: the ten
starting pawns (level B, ranks 1–2) stand on the second level from the bottom, in the two
rows nearest the camera, right above White's pieces on level A; moving a pawn "forward"
moves it away from the viewer, "up" moves it to the level above. The player turns the view
freely about the tower's centre, so the opening view is just a starting point. Only
positions are transformed; piece meshes are never mirrored (Board turns each knight to
face the opponent). The levels are 1.35 cell pitches apart (`TOWER_DEFAULTS`), and
`towerFrame(layout)` measures a layout's pitch, gap and platform heights. The scene
assumes world-Y-up; the camera lives in `screens/GameScreen.tsx` (its starting
direction), `three/cameraFit.ts` (its distance, fitted to the window's shape so the whole
tower is framed on a phone too, and the zoom range around it) and
`three/CameraControls.tsx` (turning and zooming). The engine and wire formats are
independent of rendering, and the e2e click helpers project through the live camera.

## The board

The tower of five glass levels floats in a garden at night. Each level is a sheet of clear
glass edged in its own colour (cyan, azure, periwinkle, orchid and rose, A to E), with the
3D checker on it (dark where x + y + z is even, so a bishop keeps its colour through the
levels) divided by hairlines of the level's colour. Porcelain and charcoal Staunton pieces
(see Piece set) stand on the glass, each with a thin band of its level's colour round its
foot. Far out, a colossal chessboard drawn in faint light carries twelve giant pieces
outlined in white neon, which sink into the tower's shade as they near it on screen, so
nothing competes with the board; overhead are stars and chess constellations for a camera
that looks up. Files and ranks label the two edges of the bottom platform nearest the
camera (the top one's, seen from high above). The five level letters share one corner post
(`letterCorner` in `three/scene/labelAnchors.ts`), each just outside its own platform's
corner, out along the corner's diagonal, a little above its platform. From low and middling
heights the post is a side of the tower's outline that carries no labels: the far end of
the row facing the camera (the files at either seat's opening view, so the near-left
post), and the letters make one column up the side of the tower, A at the bottom, clear of
it and as large as the files. Climbing past 55° they move to the post diagonally across
from where the files and ranks meet, a short line along its diagonal seen from above, each
letter beside its own ring, and dipping under 45° they come back: one crossfade of all
five, never a flicker in between. Never in line with the files or the ranks. The edges,
and with them the letters' post, change only 5° past the point where two edges tie (from
low down also where the files and the ranks face the camera equally), with a short
crossfade (the five letters together); held longer, from high up the letters would stand
at the tower's side level with the row running away from the camera on the other side,
reading as its labels. Near a square view from 35° to 75° that row runs up the screen like
every corner post, and the letters stand across the tower from it. Every label is
depth-tested, so a piece in front of one hides it; the glass, its border and its rim write
no depth and are drawn before the labels, so they never hide or tint one.
`scene/labelSweep.test.ts` checks every label at every pose the orbit reaches, from both
seats, and that at the side post no letter stands on the tower on screen.

Play is marked in light on the glass: a thin gold circle round each square the selected
piece can reach (fuller under the pointer), red round a capture (four arcs turning slowly round the victim), a mint line from the last
move's source to its destination, and a king in check turns red among four clusters of dark obsidian blades. A
piece under the pointer lifts a little; the selected piece lifts higher and holds still in
a column of cool light. A move glides in a straight line from square to square, a knight's
too (`MoveGlide` in `three/moveAnimation.tsx`). A captured piece burns away; at mate the king
topples and a pulse of light spreads across his own level at an even speed (`scene/fx.tsx`), and the result card appears as he
strikes the floor (`onToppled` in `three/pieceMotion.tsx`) while his bounce and the pulse
play on behind it.

How the code is split:

- `three/Board.tsx` owns every interaction rule: selecting and deselecting, legal
  destinations, click-to-capture, hover (from the pointer's ray against the floors and
  pieces, `three/hover.ts`) and the move glide (`three/moveAnimation.tsx`). Its 125
  invisible click targets are thin slabs on each square's floor (`layout.hitHeight`), so a
  click lands on the square whose floor is under the pointer. It renders the grid, markers
  and effects in the `board-decor` group, outside the clickable `board-grid` group, so
  decoration can never take a click. The last move's line and entrance are keyed by move
  and play only for a move that arrived live, never on a reload or rejoin.
- `three/PieceMesh.tsx` places a piece. Pointer events hit an invisible, still stand-in
  fitted round the piece at rest and lifted, never the moving body, so a piece that rises
  under the pointer cannot slip out from under it. `three/pieceMotion.tsx` holds the timed
  `Lift`, the `Topple` of a mated king, the decoration that stays on the glass while its
  piece lifts (`ON_FLOOR`), and `useGlide()`, which tells a piece body the levels its glide
  leaves and lands on, so its foot band changes colour on the way.
- `three/scene/` draws everything else: the garden and sky (`stage.tsx`, `heavens.tsx`),
  the levels and labels (`plates.tsx`, `grid.tsx`, `smartLabels.tsx`), the piece bodies
  (`pieces.tsx`), the marks of play (`markers.tsx`, `line.tsx`, `selection.tsx`,
  `blades.tsx`) and the capture and mate (`fx.tsx`). `palette.ts` holds the colours, the
  layout and the sizes they share. Every see-through part writes no depth and draws in a
  fixed order (`layers.ts`), so the glass never hides or tints a marker or a label.
  Board, PieceMesh and GameScreen import these parts directly; unit tests stand them in
  with `vi.mock`.

All motion runs on r3f's clock, and the canvas renders on demand.

### Recording the board

`client/scripts/showcase.mjs` records the board playing a scripted game (captures, a
check, a queen trade, a mate) to an MP4, or saves stills of the key moments with
`--stills`. It needs the app running against a local backend (see Development) and drives
the page on a virtual clock, so a slow software renderer still yields a smooth, full-rate
video:

```bash
cd client && node scripts/showcase.mjs --out /tmp/showcase   # ffmpeg on PATH
```

`--review` photographs the board for a legibility check: the opening, a selected piece
with quiet and capture destinations (and the pointer on a destination and on a piece), the
last move's line and a check, each from 13 camera poses, top-down included (or
`--poses "az,el;…"`), and from both seats, laid out as contact sheets (one to three
minutes). `--stills-fast` takes `--stills`' pictures without drawing the frames between
them, several times faster. `--interact` records the pointer at work instead of a game:
hover and unhover, selecting, hovering a quiet and a capture destination, switching
straight to another piece, and deselecting, to `interact.mp4` plus a still per beat.
`--orbit` turns the camera slowly all the
way round at five elevations from -14° to 89.9° and climbs from -14° to overhead and back,
to `orbit.mp4` and a contact sheet, and prints a jitter report: how far the tower's centre
moved on screen, the worst frame-to-frame lurch of any label, where the level letters
changed post, and a flag for every discontinuity, letter out of line, overlap or letters
reading as one axis with the files or ranks (`--seat black`, `--width`/`--height` for a
phone). Usage is at the top of the script.

### Piece set

The pieces are a **Staunton set** (`client/src/three/pieces/`), modelled like
a fine tournament set: turned profiles with a weighted base, collar rings and a clear
hierarchy of heights (pawn 0.52, rook 0.60, knight 0.72, bishop 0.75, unicorn 0.79, queen
0.825 and king 0.87), and heads that name each piece from the side, from three-quarters and
from directly above, in carved relief rather than paint: the rook's six merlons on a
corbelled turret round a hollow; the knight carved as the traditional Staunton knight (one
arched head-and-neck profile bowed forward and down, a full chest, the face falling steeply
to a deep, blunt muzzle, given thickness and sculpted with leaf ears pricked forward and
splayed apart, a carved eye under its brow, flared nostrils, an open mouth and a narrow
mane of locks laid in herringbone, meshed from a signed-distance field); the bishop's tall
mitre with its bold slanted cut, on a bead, and its ball; the unicorn's horn with a
two-start twist carved into it, to a blunted tip; the queen's open tulip crown, its rim
drawn up into eight pointed tines with pearls, round a ball finial; and the king's
fluted bucket crown, a low dome behind its rim, under a slim cross pattée taller than
wide, with arms both ways, so it reads as a cross from every side and as a plus from
above. Every piece can be told apart by silhouette alone.
Pieces stand base-at-`y = 0`, face `+x` (Board turns the knight), and fit within a radius
of 0.27; the board draws them at 0.8 scale (`PIECE_SCALE` in `scene/palette.ts`), so the
king stands clear of the level above. Each piece is split into **parts**, painted
separately:

- `body`: everything turned or carved that is not one of the parts below;
- `collar`: the ring (or rings) where the stem meets the head;
- `accent`: the details that identify the piece (knight's eyes, bishop's cut, the lines
  in the unicorn's twist, queen's pearls, king's cross, rook's crenel sills and hollow);
  pawns have none. The relief names every piece on its own;
- `foot`: a thin band at the very bottom (`FOOT_HEIGHT`, 0.04), in the colour of the level
  the piece stands on.

The geometry is built once per quality and shared by every piece: `pieceSet('low' |
'medium' | 'high')` (medium, the default, keeps every piece within about 5k triangles; each
piece is built the first time it is drawn, the sculpted knight in a few hundred
milliseconds, and the board warms the set while the browser is idle with
`preloadPieceSet()`). `partsGeometry(set, type, parts)` hands back a piece's parts merged
into one geometry, and `pieceTop(set, type)` its height. `scene/pieces.tsx` draws each
piece in one draw call with one small shader: every vertex carries its part, and the
ambient occlusion baked beside it (`scene/occlusion.ts`).

To look at the set, open `http://127.0.0.1:5173/pieces.html` while Vite runs (a dev-only page,
left out of the build), or save it as a PNG; it needs no backend:

```bash
cd client && node scripts/pieces.mjs --out /tmp/pieces                  # the set: side, three-quarter, top; light and dark
cd client && node scripts/pieces.mjs --piece knight --out /tmp/pieces   # one piece from 8 sides at two heights
cd client && node scripts/pieces.mjs --silhouette --out /tmp/pieces     # every piece in solid black: 8 sides, low, top
```

`--cell <px>` sets the size of each picture, and `--quality low|medium|high` the mesh
density of the silhouette sheet. The silhouette sheet is the legibility test: every piece must be nameable from its
outline alone, from any side (from directly above an outline is only the base, so its last
column shows the relief in one plain material instead).

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
