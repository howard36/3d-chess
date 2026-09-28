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
(`client/src/engine/board.ts`); each army's pawns stand on a level of their own:

| Level | Rank 1    | Rank 2    | Rank 4    | Rank 5    |
| ----- | --------- | --------- | --------- | --------- |
| E     |           |           | u b q u b | r n k n r |
| D     |           |           | 5 pawns   | 5 pawns   |
| B     | 5 pawns   | 5 pawns   |           |           |
| A     | R N K N R | B U Q B U |           |           |

(files a→e left to right; upper case White, lower case Black). Black's army is White's
turned through the centre, `(x, y, z) → (4 − x, 4 − y, 4 − z)`. This is standard
Raumschach's setup (pieces on levels A/B rank 1, pawns on rank 2) with rank and level
exchanged. Every rule treats the two axes alike, so the game is Raumschach's move for move.

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
  target). A move can also be typed (`Bb1-Cb1`, `=Q` to promote) in the move box, which is
  how a keyboard-only or screen-reader player plays.
- **Camera.** The only camera control is turning the view about the board's centre: drag
  with the left mouse button or one finger. The wheel or a two-finger pinch zooms. There
  is no pan (right-drag, a two-finger drag and the arrow keys do nothing), so the orbit
  target never leaves the centre. The zoom runs from 0.7× to 1.5× the distance that fits
  the board in the window (`zoomRange` in `three/cameraFit.ts`); `FitCameraToBoard`
  recomputes the fit and the range whenever the window changes shape (a phone turned on
  its side) and opens the camera inside it, so a phone zooms over the same share of its
  view as a desktop. A design's `orbit.minDistance`/`maxDistance` only narrow the range,
  and its polar-angle limits bound the elevation (up to straight down). The controls
  (`three/CameraControls.tsx`) are three's own OrbitControls, registered as r3f's default
  controls, which `FitCameraToBoard`, the designs and `showcase.mjs` read.
- **Touch.** The game screen takes no text selection, long-press callout or double-tap
  zoom (iOS would otherwise select the whole page on a double tap), except in the move box
  and the move list (`.game-screen` in `client/src/index.css`); the canvas takes every
  touch itself (`touch-action: none`). When a mobile browser loses a finger's pointer-up,
  the controls would keep counting that finger and read the next one-finger drag as a
  pinch against it. `three/useTouchSafeControls.ts` checks the controls' pointers against
  the finger list of every touch event, and on a lost pointer capture, a blur or a hidden
  page, and drops the ones no finger accounts for, so a lone finger always turns the view
  (`e2e/touchCamera.spec.ts` loses a finger's pointer-up through real touch input).
- **Turn chip.** The chip at the top says whose move it is ("White to move — in check").
  Once the game is over it gives the result instead ("Checkmate · White wins",
  "Stalemate · Draw"); it carries `data-turn` while the game is on and `data-result` /
  `data-winner` after, for tests, `showcase.mjs` and designs' stylesheets.

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
   "Opponent: online/offline" from the latest presence message about the opponent.

Coordinates on the wire use the display notation described below (e.g. `"Aa1"`).

## Coordinate systems (three of them)

**1. Engine (internal):** 0-indexed `(x, y, z)` — `x` = file, `y` = rank (White moves
toward +y, "forward"), `z` = level (White promotes toward +z, "up").

**2. Display / wire:** `ZXY` strings — Level `A–E` (z), file `a–e` (x), rank `1–5` (y).
So internal `(0,0,0)` = `Aa1`, `(4,4,4)` = `Ee5`. Conversions live in
`client/src/engine/coords.ts`.

**3. Rendering (Three.js scene):** `toWorld()` in `client/src/three/layout.ts` maps an
engine coordinate to a world position, **oriented to the viewing player**. For White,
file → X, level → Y and rank → −Z, so level A is at the bottom and rank 1 nearest the
camera; for Black all three axes are mirrored (`v → 4 − v`), which is the symmetry the
starting position is built on, so each player sees their own army laid out identically,
at the bottom and nearest. The default camera sits at `[6.5, 5, 8.5]` (mostly on +Z, up
and to the right) looking at the cube's centre, so:

| Game concept                      | Engine axis | World axis | On screen (default camera, viewing player)   |
| --------------------------------- | ----------- | ---------- | -------------------------------------------- |
| File a–e                          | x           | X          | left → right (mirrored for Black)            |
| Level A–E (the game's "up")       | z           | Y          | bottom → top (own first level at the bottom) |
| Rank 1–5 (the player's "forward") | y           | −Z         | near → far (own first rank nearest)          |

So levels are **screen height** and ranks are **depth**, as in the tower layout.
Concretely, for White: the ten starting pawns (level B, ranks 1–2) are the
second-from-bottom horizontal layer of the cube, in the two slices nearest the camera,
right above White's pieces on level A; moving a pawn "forward" moves it away from the
viewer, "up" moves it up the screen. Black sees the mirror image. The player turns the
view freely about the cube's centre, so the default view is just a starting point. Only
positions are transformed; piece meshes are never mirrored. This is the classic (lattice) layout; a
design may lay the cells out differently (see Board designs — the tower layout spreads
the levels out as five separate boards).
The classic position math is in `three/layout.ts`, the others in
`three/designs/kit/layouts.ts`; the floor rings and the glide
lift in `three/Board.tsx` and `three/motion.ts` assume world-Y-up, and the camera lives in
`screens/GameScreen.tsx` (its starting direction), `three/cameraFit.ts` (its distance,
fitted to the window's shape so the whole cube is framed on a phone too, and the zoom
range around it) and `three/CameraControls.tsx` (turning and zooming). The engine and wire
formats are independent of rendering, and the e2e click helpers project through the live
camera.

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
nothing decorative can take a click. Every move but a teleport glides in a straight line
from square to square (`three/movePath.ts`); a knight arcs instead when the player sets
**Knight moves: Arc** at the foot of the style picker (also `?knight=arc|straight`,
remembered like the design), and the glide, the last-move line and a design's move effects
(`MoveFxProps.arc`) all follow that one path. Pointer events hit an invisible, still
stand-in fitted round each piece at rest and lifted (`PieceMesh`), never the moving body,
so a piece that rises under the pointer cannot slip out from under it; designs share a kit (`designs/kit/`) of layouts,
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

### Design settings

A design may let the player adjust parts of its look (`designs/settings.ts`). It declares
them as `Design.settings`, a list of `SettingSpec`s. Each has a stable `key` (the name
it is read by and stored under), a `label`, a `group` (the heading it is listed under), a
`default` and an optional one-line `hint`. There are three kinds:

- `toggle`, a boolean;
- `slider`, a number, with `min`, `max`, `step` and an optional `format(value)` for how it
  reads (else the number, to the step's decimals);
- `choice`, one of `options: { value, label }[]`.

```tsx
settings: [
  { kind: 'toggle', key: 'env.stars', label: 'Stars', group: 'World', default: true },
  { kind: 'slider', key: 'env.glow', label: 'Glow', group: 'World', default: 1,
    min: 0, max: 2, step: 0.1, format: (v) => `${v.toFixed(1)}×`, hint: 'The sky’s light.' },
],
```

Anything under the Canvas reads a setting with `useDesignSetting<T>(key)` (or all of them
with `useDesignSettings()`) and re-renders when it changes. The canvas renders on demand, so
a value read only inside `useFrame` also needs `useEffect(() => invalidate(), [value])`.
The choices are kept per design in this browser (`localStorage`, `design-settings:<id>`,
only the values that differ from the defaults). They are never game state and never sent
to the opponent. A stored value that no longer fits its setting (a renamed option, a
narrower range, a changed kind) is dropped. Renaming a key forgets the players' choice for
it.

When the current design has settings, a gear appears beside the style picker, in the game
and on the start screen, styled with the design's `--hud-*` and `--button-*` variables. It
opens a small panel over the top right of the board (`screens/DesignSettings.tsx`):

- groups are listed in the order they first appear, and each group's settings as declared;
- toggles are switches, and sliders show their formatted value;
- a choice is a row of buttons, or a drop-down beyond four options;
- hints appear in small muted text;
- "Reset to defaults" shows how many settings are changed, and the gear carries a dot
  while any are.

Every change applies at once. The panel is not modal: the board stays in play and
clicking it leaves the panel open. Escape, the gear, or its close button closes the panel,
and so does a click anywhere else. It scrolls on its own on a small screen, and no pointer
or wheel event on it reaches the board's camera.

### Clarity kit

Round-2 designs build on a shared **clarity kit** (`designs/kit/`), whose rules come from
play-testing: the player must read the whole position at a glance, from any angle and
either seat. `designs/kit-demo/` uses every part with neutral styling and is the template
to copy (hidden from the picker; open it with `?design=kit-demo`).

- **Compact tower** (`clarityTower` in `kit/layouts.ts`): five continuous platforms, A at
  the bottom, with a level gap of 1.35 cell pitches (the classic tower's is 1.9), so the
  stack stays close to a cube and diagonals look natural; seen from a low camera (18°)
  turned 16° off the players' axis, so the view looks *between* the levels and ranks do not
  stack into columns. `BoardLayout.orbit` limits the camera (6°–89.9° elevation) so it
  never dips under the bottom platform; at the top it looks straight down, like a 2D board
  with the levels nested under it (the file and rank labels move to the top platform's
  edges once the bottom one's would land on the platforms above it).
  Its click boxes are thin slabs on each square (`BoardLayout.hitHeight`), so a click lands
  on the square whose floor is under the pointer. Pieces are drawn at `Design.pieceScale`
  (0.8 in the demo) to fit the gap. `towerFrame(layout)` measures any tower layout (pitch,
  gap, platform heights) for the parts below.
- **Level identity**: Board tells each piece body its `level`, so a design can mark which
  platform a piece stands on (`LevelFootprint`, a ring in the level's colour), and gives the
  Grid a `focus` (`{ selected, hovered }` levels); `focusLevelOf(focus)` picks the one to
  emphasise, hover first. `LevelPlates` and `SmartLabels` take it as `focusLevel` and ease
  that level's edge and letter up (150 ms, no pulsing). `hud.readout` shows the cell under
  the pointer under the turn indicator ("Cc4 · White Bishop"). Hover is found from the
  pointer's ray against the floors and pieces (`three/hover.ts`) for designs with
  `hoverDestinations` or `hud.readout`.
- **Platforms** (`LevelPlates`, `kit/plates.tsx`): one see-through slab per level, a faint
  two-tone checker coloured by x + y + z (so a bishop keeps its colour through the levels),
  a crisp perimeter edge and nothing else; optional per-level tints colour-code the levels.
  `ContactShadow` goes in a design's PieceBody, under the piece, to show which platform it
  stands on. It and `LevelFootprint` carry `FLOOR_DECAL` (`kit/motion.tsx`), so `Topple`
  hides them while a mated king lies on its side instead of standing them up with it; spread
  it onto a design's own base discs as `userData`. A group tagged `ON_FLOOR` instead stays
  on the floor while `Lift` raises the piece (pinned in the same frame, so a base ring
  neither rides up nor trails behind); `Lift` owns that group's height, so offset its
  children. While a move glides, `useGlide()` tells the piece body the levels it leaves and
  lands on and the glide's eased progress, so a base in the level colour can change colour on
  the way rather than wearing the destination's from the start. `frameGeometry` builds the perimeter
  frame for designs drawing their own plates.
- **Markers** (`kit/markers.tsx`): flat on the platform where a piece stands, never floating
  in the cell. `FloorMarker` draws an inset rounded square, corner brackets, a ring or a
  dot; `capture` adds a tint and four ticks to the same shape (inward on a square; on a
  ring, which widens to 0.42 of a pitch so it shows round the victim's base, outward to the
  corners), and `hovered` brightens it (Board passes it to designs with
  `hoverDestinations`). `LastMoveLine` (`kit/line.tsx`) joins the centres of the last move's
  squares with a thin tube of real geometry, straight (or along a knight's arc: pass
  `LastMoveMarkerProps.arc`), with no arrowhead: the destination's marker says where the
  move ended. The line is depth-tested, so the piece standing on the destination would hide
  its last stretch, and a line coming down onto it (from behind it, straight down, or over
  a knight's arc) would seem to end at the piece's head, above the square. The stretch
  hidden inside that piece's column (`PIECE_COLUMN`) therefore shows through it, fainter
  (`throughPiece`, a share of the line's opacity; 0 turns it off), so the line always
  reaches the centre of the destination's floor. A calm flow runs along
  it from source to destination (a soft pulse, drifting dashes, or a row of beads:
  `pattern`), with `color`, `radius`, `flowSpeed`, `pulse`, `outline` and `drawInMs` to style
  it; `tracePath` and `tubeData` (`kit/markerGeometry.ts`) build a design's own line on the
  same path. Board keys the LastMove marker by move and passes `fresh` (the move
  arrived live), so an entrance plays once per move and never on a reload or rejoin.
  `clarityMarkers({ pitch, … })` returns a design's whole marker set. Designs set
  `cellFills` to `null` to draw no cell volumes.
- **Labels** (`SmartLabels`, `kit/smartLabels.tsx`): files and ranks follow the camera to the
  two edges of the bottom platform nearest it (the top platform's, seen from high above),
  and each level letter sits beside its own
  platform at the corner furthest left on screen, with hysteresis and a short crossfade as
  the camera orbits; the placement is a pure function (`kit/labelAnchors.ts`).
- **Layers** (`kit/layers.ts`): every see-through part writes no depth and draws in a fixed
  order (platforms, edges, shadows, markers, the last-move line, labels), so platforms never
  hide or tint a marker, and pieces under several platforms keep their colour.
- **Optional parts**: `LevelGrid` (`kit/grid.tsx`) draws hairlines between each level's
  squares, colour-coded per level, antialiased at any distance and optionally fading with it;
  `levelRamp` (`kit/colors.ts`) returns five evenly spaced colours for the levels, one
  lightness and chroma along an OKLCH hue ramp, never white or grey; `LevelBand`
  (`kit/plates.tsx`) builds a thin band of the level's colour into a piece's foot, beside
  the flat `LevelFootprint`.
- **Lift**: `hoverLift: true` raises a piece under the pointer (0.08) and the selected one
  (0.2) and holds it still; `hoverLift: { hover, selected, bob }` sets the heights and opts
  into a bob while held (the round-2 designs use `SELECTION_BOB`). Leave it off to express
  hover and selection in the piece body.

`showcase.mjs --review` photographs a design for a clarity review: the opening, a selected
piece with quiet and capture destinations (and the pointer on a destination and on a piece),
the last move's line and a check, each from 13 camera poses, top-down included (or
`--poses "az,el;…"`), and
from both seats, laid out as contact sheets (usage at the top of the script; one to three
minutes). `--stills-fast` takes `--stills`' pictures without drawing the frames between
them, several times faster. `--interact` records the pointer at work instead of a game:
hover and unhover, selecting, hovering a quiet and a capture destination, switching straight
to another piece, and deselecting, to `<design>-interact.mp4` plus a still per beat.

### Piece set

Every design can draw the same **Staunton set** (`client/src/three/pieces/`), modelled like
a fine tournament set: turned profiles with a weighted base, collar rings and a clear
hierarchy of heights (pawn 0.52, rook 0.60, knight 0.72, bishop 0.75, unicorn 0.79, queen
0.825 and king 0.87), and heads that name each piece from the side, from three-quarters and
from directly above, in carved relief rather than paint: the rook's six merlons on a
corbelled turret round a hollow; the knight carved as the classic Staunton knight (one
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
Pieces stand base-at-`y = 0`, face
`+x` (Board turns the knight), and fit the envelope the layouts assume (radius 0.27 at most;
`pieceScale` applies as before). Each piece is split into **parts** a design paints
separately:

- `body`: everything turned or carved that is not one of the parts below;
- `collar`: the ring (or rings) where the stem meets the head;
- `accent`: the details that identify the piece (knight's eyes, bishop's cut, the lines
  in the unicorn's twist, queen's pearls, king's cross, rook's crenel sills and hollow);
  pawns have none. The relief names every piece on its own, so an accent may be painted
  like the body;
- `foot`: a thin band at the very bottom (`FOOT_HEIGHT`, 0.04), for the colour of the level
  the piece stands on (`PieceBodyProps.level`).

```tsx
import { ChessPiece } from '../../pieces';

// A part without its own material is painted (and drawn in one mesh) with the body
<ChessPiece type={type} parts={{ body: ivory, accent: walnut, foot: levelColour[level] }} />
```

Parts that share a material are merged once and drawn as one mesh, so a piece costs one to
four draw calls. Materials may be shared objects (the cheap way: one per army and state) or
JSX elements; anything that fades or recolours one piece must clone first. The geometry is
built once per quality and shared: `pieceSet('low' | 'medium' | 'high')` (medium, the
default, keeps every piece within about 5k triangles; each piece is built the first time
it is drawn, the sculpted knight in a few hundred milliseconds, and Classic warms the set
while the browser is idle with `preloadPieceSet()`).
`buildPieceSet({ quality, segments, profiles, radius })` makes a variant: `segments` turns
every shell with that many sides (a handful gives a cut-gem look), `profiles` replaces any
of the turned profiles in `PROFILES`, and `radius(r, y, type)` reshapes them all (e.g.
slimmer stems). `partsGeometry(set, type, parts)` hands back merged geometry for a design
that draws its own meshes or shaders, and `pieceTop(set, type)` a piece's height. The
round-1 geometry (`three/pieceGeometry.ts`, `StauntonParts` in `designs/classic/pieces.tsx`)
is kept unchanged for the designs built on it.

To look at the set, open `http://127.0.0.1:5173/pieces.html` while Vite runs (a dev-only page,
left out of the build), or save it as a PNG; it needs no backend:

```bash
cd client && node scripts/pieces.mjs --out /tmp/pieces                  # the set: side, three-quarter, top; light and dark
cd client && node scripts/pieces.mjs --design atelier --out /tmp/pieces # a design's own PieceBody
cd client && node scripts/pieces.mjs --piece knight --out /tmp/pieces   # one piece from 8 sides at two heights
cd client && node scripts/pieces.mjs --silhouette --out /tmp/pieces     # every piece in solid black: 8 sides, low, top
```

`--quality low|medium|high` and `--cell <px>` (the size of each picture) apply to all of
them. The silhouette sheet is the legibility test: every piece must be nameable from its
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
