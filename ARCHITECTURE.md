# 3D Chess: architecture

A web app for playing 3D chess on a 5×5×5 board (the standard pieces plus the Unicorn,
which moves along space diagonals) with a friend over a shareable link, or against the
computer at three levels. React + Three.js frontend, small Python WebSocket relay on Modal;
the computer player runs in the browser.

This is the current, authoritative documentation of the rules, protocol and design
(`README.md` is the short page for people).

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
by the client engine, and so do chess's other two automatic draws: the same position (the
same pieces on the same squares, the same side to move) standing for the third time, and
fifty moves by each side (a hundred plies) with no capture and no pawn move
(`engine/draws.ts`). A mate stands even on the move that would also complete either. The
replay (`game/history.ts`) keeps the positions since the last capture or pawn move
(`GameHistory.sinceIrreversible`, each a Zobrist hash of the pieces and the side to move,
`positionHash`, updated move by move with `hashAfter`), the only stretch in which one can stand again, and its length less one is the fifty-move
count. The starting position is defined in
`Board.setupStartingPosition()`
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

The players can also end a game themselves. Either may resign at any moment, on their move or
not (the opponent wins), or offer a draw, which the opponent accepts or declines. A draw can be
offered once a move, by either side, and an offer stands until it is answered or a move is
played (by either side: playing on cancels it). An ending on the board comes first: a mate or
an automatic draw stands even if a resignation or an agreement follows it. The computer accepts
a draw only when it stands clearly worse (see Playing the computer).

A player may also ask to take back their last move, and the reply to it if one has been made,
in a game under way: the opponent accepts or declines, and the request is made and lapses
just as a draw offer is (once a move, cancelled by a move). Against the computer the move is
taken back at once.

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
  container restarts and page reloads, but records expire after 7 days of inactivity (no reads or writes) and
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
  `client/src/game/` (`history.ts` replays the record, `ending.ts` reads a resignation or
  an agreed draw and the draw offer and take-back request standing, `session.ts` the seat, presence and errors,
  `invitation.ts` what a guest's invitation says); `GameScreen` only
  wires its output to the UI (the lobby before the game, `GameView` once it has begun). A
  local move is only _sent_; the board updates when the server's `move_made` echo arrives. This keeps
  both clients in lockstep and makes rejoin trivial. The replay hands back the same
  result object while the move record is unchanged, so a presence or error message
  neither replays the game nor resets the 3D board (which would drop the player's
  selection).
- **Server = relay + durable move log.** Per game the server stores `{seats, moves}` (plus
  `claimants`, which client id claimed each seat, and once there are any, `ending`, a
  resignation or an agreed draw, `drawOffer`, the latest draw offer, `takebackRequest`,
  the latest request to take back a move, and `rematch`, the latest offer of a rematch) in a `modal.Dict`
  (durable) and keeps live sockets in a plain in-process dict (ephemeral).
  A disconnect detaches the socket but leaves the game record intact; `rejoin_game`
  reclaims a seat and receives the full history in a `game_state` message.
  Last-connection-wins on rejoin, so a refreshed tab can't be locked out by its own
  half-open predecessor; an automatic reconnect is the exception (see Protocol).
- **Concurrency model.** One container, one event loop, cooperative scheduling. Because
  `modal.Dict` returns deserialized copies, every mutation is read-modify-write and is
  written back **before any `await`** — that ordering is what makes concurrent handlers
  safe. Two rules keep it true, and `test_store_ops.py` asserts both (and that nothing uses
  `modal.Dict`'s awaiting `.aio` calls): the store operations
  in `modal_app.py` (`create_game`, `claim_seat`, `taken_seats`, `find_seat`, `record_move`,
  `resign`, `offer_draw`, `accept_draw`, `decline_draw`, `request_takeback`, `accept_takeback`,
  `decline_takeback`, `offer_rematch`, `accept_rematch`, `decline_rematch`) are
  synchronous functions, so nothing inside them can yield to the event loop; and the
  WebSocket handler never reads or writes the store itself, only passes it to those
  operations. `modal.Dict`'s calls block; never switch to the `.aio` variants. Without a
  `modal.Dict` (the tests, e2e's backend, local runs) the store is a `CopyingStore`, which
  pickles on every read and write as `modal.Dict` does, so a store operation that forgets
  its write-back fails the tests.
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
  on the next socket. Leaving a game's page (for the landing page or the side choice, or
  straight for another game's page through history) resets the socket session; the move
  from the side choice at `/new` to the new game's page keeps it, since it holds the
  creator's `game_created`.
- **The page's first socket.** The built page opens its socket before the app has loaded:
  an inline script at the top of `index.html` (`client/src/lib/earlySocket.ts`, injected by
  `vite.config.ts`'s build-only `early-socket` plugin) opens it and, on `/game/:id`, sends
  the first request the game screen would (`rejoin_game` with the seat stored for the game,
  else `look_game`), keeping the replies. `useGameSocket` adopts it on its first mount as
  session 1, its messages in its first render, and records what each session has sent, so
  the screen doesn't ask again. A reopened game's record and a guest's invitation no longer
  wait for the entry, React's first commit and the scene chunk's evaluation before the first
  round trip starts. The dev server keeps the app's own socket: StrictMode mounts the hook
  twice, closing the adopted socket, which would rejoin the seat a second time.
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
  appears when it does, or stays in sight throughout when there is no 3D board (see HUD).
- **Camera.** The only camera control is turning the view about the board's centre: drag
  with the left mouse button or one finger. The wheel or a two-finger pinch zooms. There
  is no pan (right-drag, a two-finger drag and the arrow keys do nothing), so the orbit
  target never leaves the centre. The zoom runs from 0.7× to 1.5× the distance that fits
  the board in the window (`zoomRange` in `three/cameraFit.ts`); `FitCameraToBoard`
  recomputes the fit and the range whenever the window changes shape (a phone turned on
  its side), so a phone zooms over the same share of its view as a desktop. The camera
  opens at the fit, and a resize keeps the player's zoom and turn: it stands at the same
  multiple of the new fit as it did of the old one (within the new range), so the tower
  keeps its share of the window rather than snapping back to the fitted view. What the fit frames is the same from every side: circles about the
  tower's axis round its platforms, its tallest pieces and every label wherever it can
  stand (the layout's `frameRings`, `towerFrameRings` in `three/scene/labelAnchors.ts`; the
  letters' rings only where their post can stand: anywhere but the front from low down,
  behind the tower from high up). The tower's centre (the orbit target, a fixed point of
  the tower: the middle of the stack with the top level's pieces, about a quarter of a
  level's gap above level C) stands on screen by a lens shift (a view offset,
  `three/viewOffset.ts`) rather than a pan, set from the window alone: 3% of the rings'
  height (`CENTRE_LIFT`) above the middle of the room between the HUD's top pill (56 px)
  and the bottom of the window. The band under the pill kept for the captured pieces (84 px
  in all; 56 in a short window, where they stand beside the tower: `hudTop`) is kept clear
  but, mostly empty, not balanced against. A circle about the axis looks the
  same whichever way the camera has turned, so the shift is only ever vertical. It is set
  with the fit (on opening and when the window changes shape) and then left alone: turning,
  climbing and zooming never move the tower's centre on screen, so the camera only turns
  about it and moves nearer or farther, and the view never slides under the player's hand.
  No one point centres every view: seen from low down the tower reaches further below its
  centre than above it (the bottom platform's near edge is close to the camera), so it sits
  low, and from overhead or from under it, high. Most of a game is played from low down
  (10–35° up), and a shape in the exact middle reads as low, so the lift leans the balance
  their way: from them the tower stands 2–3% of the room below the middle, from overhead
  and from under it at most about 6% above it (`cameraSweep.test.tsx` checks it as drawn). The distance fits the rings in the room about
  the centre with 5% to spare at the opening, and inside it from every elevation the orbit
  reaches (`sweep`, `orbitSweep`), so the tower and its labels never cross the HUD's band
  or the window's edges however far the view climbs or dips. It is always fitted from the
  opening, however far the view has climbed when the window changes shape, so a resized
  window is framed exactly as a fresh load at that size (and its centre stands where a
  fresh load's does, whatever the zoom). (Centring the rings as seen from
  the opening put the centre 50 px higher in a 720 px window and ran the tower's top level
  under the pill as the view climbed; the middle of the room below the band left the views
  the game is played from 40–60 px low in a 900 px window; fitting from the elevation of the moment made
  the tower's size and place depend on the angle the player was at when the window changed;
  centring the outline as seen, a diamond one moment and a square the next, slid the view
  sideways as it turned; re-centring the rings at every elevation slid it up and down, by
  over 100 px on a desktop, as it climbed.) The landing page's preview, which only turns
  about the axis at one elevation, centres its rings as seen from there instead, in the
  room its menu leaves (`centre: 'rings'`, `leftInset` and the bands: see Landing page); the tutorial centres them as seen from the opening in the room its card leaves,
  kept in it from there and from below (`centre: 'opening'`, `leftInset`: see The
  tutorial). The two bands never take more than three quarters of the window. The layout's `orbit.minDistance` only narrows the range, and its
  polar-angle limits bound the elevation (from 14° below the horizon, to look up at the
  sky, to straight down). The controls (`three/CameraControls.tsx`) are three's own
  OrbitControls, registered as r3f's default controls, which `FitCameraToBoard`, the
  scene and `showcase.mjs` read. In the game's entrance (see The board) the camera starts
  2.4 times the fitted distance out on the opening line of sight (1.3 times on a rejoin; none when the lobby hands over, the camera already at rest there)
  and dollies in to exactly the fitted distance, with the fit's lens shift, so the tower's
  centre holds its place on screen throughout; the controls take no input until it lands,
  and it lands where a load without an entrance starts (`FitCameraToBoard` leaves the
  fitted distance on the camera, `userData.fitDistance`). The canvas draws at the screen's pixel ratio up to 2x,
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
- **HUD.** Quiet by default: a glass **turn pill** at the top centre (across the row on a phone held upright,
  between the corners at the left and right), a quiet "How to play" at the top right ("?"
  in a narrow window), the move history once the game is over (below), and nothing else
  unless something needs saying. There is no way home while the game is on: the player
  stays in it. Once it is over a quiet "Home" with a house (`screens/House.tsx`) stands at
  the top left (the start page; the house alone in a circle in a narrow window or a short
  one, where the pill stands beside it). Home leaves the game as it is: its address brings
  the player back to the seat.
  The pill's left half is the player and its right half the opponent, each with a small stone in its army's
  material (porcelain, charcoal); the half of the side to move is lit, its stone ringed in
  light ("Your move" / "Their move"); check is shown on the board, not here. An opponent with no
  live connection shows as an outlined stone and "Offline"; a connected one is not marked.
  Once the game is over the pill gives the result from the player's side ("Checkmate · you
  win", "White resigned · you lose", "Repetition · draw", "50-move rule · draw", "Draw
  agreed"), and the result card says "You win", "You lose" or "Draw" with how ("by
  checkmate", "White resigned", "by stalemate", "by repetition", "by the 50-move rule", "by
  agreement"); `data-result` is `checkmate`, `resignation`, `stalemate`, `repetition`,
  `fifty-moves` or `agreement`, and the board takes no more input. The card's call to
  action, which has the focus, is "Rematch", with "Review" (an outlined pill: the game's
  review, see below) quieter under it (`Rematch` in `screens/EndGameModal.tsx`), against the
  computer and a friend alike; the way home is the HUD's, not the card's. A
  rematch is a new game with the colours swapped. Against the computer it starts at once,
  at the same level (`ComputerGameScreen`'s `onRematch`, made as the side choice makes a
  game; the computer sits down as its page opens). Against a friend it is offered and
  answered like a draw: the button follows the offer, one element throughout so the focus
  stays on it: "Rematch offered" (waiting, not pressed) while the player's own stands,
  "Accept rematch" with "Decline" under it for the opponent's, and "Review" (plain, the
  card's one button), under "Rematch declined", once the player's own was declined. Accepted, both
  players' pages open the new game at once (the seat stored as a joined one is, the router's
  state asking for the whole entrance); a finished game opened after its rematch began says
  "Join rematch" instead. The rematch's buttons stand below the tower once the card is put
  away (`RematchBar`), side by side (and once declined, "Review" until the review has
  begun, then the refusal alone); there the review is begun by a step through the record;
  `rematch-announcer` says an offer and a refusal. With the card put away the screen is the
  review's: the board, the record and the rematch. The pill and the captured pieces step
  out of sight (still in the page, visually hidden, for a screen reader and the hooks
  below) and the way to the tutorial goes; the way home stays. In a window no wider than
  13:9, where the steps take the top row, the way home stands with the rematch in one row
  below the tower (`.hud-end`), at its left, the rematch in its middle while there is room;
  the steps then have the top row's whole width (to 400 px), so the move shown between
  them and each side's marks fit on one line on a 360 px phone.
  While the game is on, a
  flag in a circle stands under the way to the tutorial at the right (`screens/GameActions.tsx`,
  `.hud-game`, in one column with the move history, which takes its place once the game is over, `.hud-side`: below the HUD's band, but in every window shape where the window is empty
  beside the tower, which `hudFit.spec.ts` checks with the rest of the HUD). It opens a small
  menu, "Offer draw" and "Resign"; "Resign" asks once more ("Resign?", the focus on Cancel,
  a click hard on the heels of the one that asked ignored), so a stray click never ends a
  game. Under the flag hang, while they apply: the player's own offer ("Draw offered",
  waiting), its refusal ("Draw declined", until the next move), or the opponent's offer
  with Accept and Decline. Under the flag, a curved arrow in a circle of its own takes back
  the player's last move and the reply to it ("Take back move" against the computer, at once;
  "Ask to take back move" against a friend, disabled until the player has a move to take back
  and once asked this move): its request hangs under it as a draw offer does ("Take-back
  requested", "Take-back declined", or the opponent's "Take-back requested" with Accept and
  Decline). One line at most hangs there (a narrow window has room beside the tower for no
  more): a question for the player first, the take-back's before the draw's, then the
  player's own take-back and draw. Nothing there takes the focus; polite live regions
  (`draw-announcer`, `takeback-announcer`) say each offer and request, and the move
  announcer the result ("Black resigned. You win.", "Draw agreed.") and a move taken back
  ("Move taken back. Your move."). The flag and the arrow are disabled while the connection is down or not yet
  back in the game, and a resignation or offer queued meanwhile is dropped, like a move. Under the pill hang the **captured pieces** (`screens/CapturedPieces.tsx`, from
  `GameHistory.captured` and `game/material.ts`): each side's haul under its own half, a
  silhouette per kind of piece taken (the promotion dialog's, `screens/PieceGlyph.tsx`) in the taken army's material with a count when more than one, and "+N" on the side ahead on material (in pawns, to the tenth:
  queen 11.2, knight and bishop 3.1, rook 2.8, unicorn 1.2, measured for this board by
  self-play, not 2D chess's: see Piece values); one above the other at the top left in a short window. The camera fit keeps their row clear
  from the first move (`hudTop`), so a capture never moves the board, and a screen
  reader reads them as a sentence per side, never announced. Under them, only while they
  apply: "Reconnecting…" (the pill and the captures dim), the refusal that still stands and the
  frozen-record notice. A refusal stands from when it arrives until "✕" or a later answer
  (a move made, a seat taken or rejoined, an invitation answered) ends it, and only one this
  page asked for counts: what the log held when the page mounted (the side choice's, on the
  way from `/new`) is not its own (`selectStandingError` in `game/session.ts`). A join or a
  rejoin is likewise judged by the answers since it was sent (`refusedSince`), never by an
  earlier request's. The **move card** is never shown as a panel: it stays in the page out
  of sight, its field to type a move (`Bb1-Cb1`), which is the first Tab stop on the board
  screen. The field appears while it has keyboard
  focus, at the bottom left (across the bottom in a window no wider than 13:9, at the bottom
  right in a short one, over the move history where they meet), and Escape puts it away; with
  no 3D board (its chunk failed, or the browser has no WebGL) it stays in sight and Escape does
  not hide it. A visually hidden live region announces
  every move as it lands ("White bishop Ad2 takes pawn on Dd5. Check. Your move.",
  `game/announce.ts`).
  The **move history** (`screens/MoveHistory.tsx`) stays out of sight while the game is on,
  so nothing beside the tower competes with the board: the record is in the page only as
  words for a screen reader (visually hidden, nothing to press), and ← → Home End step
  nowhere. It comes into sight with the result card (after a mate's fall, as the card
  does), and from then on is the record in
  numbered pairs ("1. ♙Cb1 ♙Cd5"), every move a button that shows the board as it
  stood after it, over four steps: the start (move 0), back, on and the latest, and ← → Home
  End while focus is not in a field.
  The record writes a move as chess does, with the piece's icon for its letter
  (`game/notation.ts`, worked out by the replay from the position before each move,
  `GameHistory.notation`; `screens/MoveText.tsx` draws it): the icon (a pawn's too: a letter
  would read as a level, B for both bishop and level B), "x" for a capture, the destination,
  "=" and the icon of what a pawn became, and "+" for check or "#" for mate (♘xBb3+,
  ♙Ed5=♕, ♕Ee5#); each icon is cut to its ink and stands on the baseline as tall as the
  capitals, as a letter would, a piece whose top is thinner than the letters' stem (the
  queen's pearl, the unicorn's horn) up to a tenth taller so that it looks as tall, and the squares keep the font's own figures (a
  tabular "1" stands alone in a digit's width), the moves' numbers alone tabular so
  they line up. Where another piece of the same kind and side could make the same move
  (a pinned one does not count), the whole starting square comes first, joined by "x" or,
  for a move that takes nothing, "–" (♙Cd2xCc3, ♙Cc2–Cc3): never a part of the square,
  which beside a level-file-rank square reads as one. A screen reader hears the move in
  words ("Pawn Cd2 takes Cc3, check"); a record past one the replay could not play keeps
  the wire's form (`Bb1–Cb1`), and the move box takes only the wire's form (`Bb1-Cb1`).
  Where the window leaves room beside the tower it is a
  narrow glass panel at the right under "How to play" and the flag, in one column with them
  (`.hud-side`), so an offer hanging under the flag pushes the list down and the list gives up
  height to fit (the list scrolls, the move shown kept in view, the latest as moves land),
  wider once the game is over in a window over 480 px tall (240 px, so a reviewed move that
  names its starting square, takes, checks and is marked fits its column). A move longer
  than its column takes the room it needs and Black's goes under it, never cut off
  (`e2e/hudFit.spec.ts` checks every move whole); in a window no wider than 13:9 only the steps show,
  in a row: under the tower behind the result card, and once it is put away in the pill's
  place at the top (the HUD's band, which the fitted board stays below, so the steps never
  cover the tower and never stand over the rematch), the move shown between them
  ("7… ♗xBa1+"), which opens the list under them, four rows of moves tall and each side's
  marks on one line, so it covers little of the tower. Beside the tower, the card put
  away, the panel moves up into the corner the way to the tutorial leaves. Closed, the list is
  visually hidden, never `display: none`: it is how a screen reader reads the record, and
  a polite status says where the board stands as the player steps. A reopened game's list
  comes in two renders: the blocks in view (the last, the move shown's) with the record, the
  rest a deferred render later, so thousands of buttons never hold up the record; rows out of
  the list's view are not laid out (`content-visibility`). On a touch screen the steps are a
  fingertip wide, and beside the tower the four steps share the panel's width. Away from the live
  position (`screens/useReview.ts`) the board shows the earlier one, its last-move line,
  check and captured pieces, and takes no input (no selection, no move; the move box says
  "Go to the latest move first."); the move shown is lit in the list; the way back
  ("Latest") looks like the other steps. The pill, the announcer and their hooks follow the game throughout,
  and a game ended by a resignation or an agreed draw is stepped through like one ended on
  the board, the board taking no input at its end either. (While the result card is up,
  nothing steps: it is a dialog.)
  **The review** is one thing, looking back and the engine's marks together, against a
  friend or the computer alike (`screens/useAnalysis.ts`): the result card's **"Review"**
  puts the card away, opens the list (in a narrow window too) with the focus on the move
  shown, and begins it; with the card put away, the first step through the record begins it.
  It never begins on its own (it would cost a phone's battery), and there is no other button
  for it. Each position from the start on is searched in the computer's workers, several at
  once and handed out from the start (see Playing the computer), and the position a game
  ended in on the board (a mate, a draw) needs none. Should a search fail, or the search's
  code fail to load, the review stops short and says so ("Review stopped", with "Retry",
  which goes on from the positions already found). As each is done its moves are marked, a glyph after
  the move in the list, "?!" an inaccuracy, "?" a mistake and "??" a blunder (pale blue,
  orange and red, but the glyph says which; a screen reader hears the grade), and the list's
  top shows each side's marks counted by grade (its stone, then "?! 2 ? 0 ?? 1"), a
  thin bar under them filling as the review goes. Where the move shown is marked, the board
  draws the better move beside it (see The board) and the panel names it under the list
  ("Best ♙Cc2", beside a stroke of the line's amber); an unmarked move shows nothing
  more. In a window no wider than 13:9 the mark stands beside the move shown between the
  steps, and the review's top and the better move's name come with the list. The review
  lasts for the page's life; leaving the page, or another record, stops the work
  (`game/analysis.ts` grades each move: see Playing the computer).
  The earlier positions are replayed only while the player looks back (`game/review.ts`),
  never on a move landing. One step
  glides like a move (back, in reverse), a jump snaps (see The board); with reduced motion
  nothing glides. The parts are `screens/TurnPill.tsx`,
  `CapturedPieces.tsx`, `MoveCard.tsx`, `MoveHistory.tsx` and `MoveAnnouncer.tsx`, styled in
  `index.css`. For
  tests and tools the pill carries `data-turn`, `data-check`, `data-result` and
  `data-winner`; `data-testid="seat"` its `data-seat`; `opponent-presence` its
  `data-online`; `captured-pieces` each haul as `data-side` (`me`, `them`);
  `move-announcer` the latest move as `data-last-move` (`Bb1-Cb1`, `=U` for a promotion)
  and `data-move-count`; `move-history` the ply the board shows as `data-viewing-ply`
  (the live ply at the live position), with `data-review` away from it and `data-hidden`
  while the game is on, `data-analysis` (`running`, `done`, `stopped`) once the review is asked for
  (`analyse`, the button) and `data-best` the better move where the move shown is marked
  (`Bc1-Cc2`, named in `best-move`); each move marked carries `data-grade` (`inaccuracy`,
  `mistake`, `blunder`), and `.hud-counts` each side's counts as `data-count` by grade; `game-actions` is the flag's corner, with `take-back` (the arrow),
  and `draw-pending`, `draw-declined`, `draw-offer`, `takeback-pending`, `takeback-declined`
  and `takeback-offer` in it while they show; `rematch` holds the result's buttons (with
  `data-bar` below the tower), its call to action `rematch-go` with `data-state` (`none`,
  `mine`, `theirs`, `declined`, `begun`), and `rematch-declined` the note. The browser tab follows the pill: while it is the seated player's
  move in a game under way (a friend's or the computer's), in view or not, the title is
  "● Your move · 3D Chess" and the icon is `public/favicon-turn.svg` (the favicon, the
  tower's five levels, with a gold dot); the page's own come back on the opponent's move,
  at the end of the game (a resignation or an agreed draw included) and when the page goes (`hooks/useTabSignal.ts`, which also
  carries the host's "Opponent joined"; no frames, no timers). In the game's entrance
  the pill and the captured pieces fade in last, settling down onto their place as the last pawns form (`--intro-hud`), and the
  canvas's wrapper carries `data-intro` (`playing`, then `done`), which e2e's
  `waitForBoard` waits for; the move box stays the first Tab stop throughout. The started game's page is `screens/GameView.tsx`, which `GameScreen` renders with
  everything it derives from the log; its 3D board, `screens/GameCanvas.tsx` (loaded
  lazily), publishes `window.__r3fState` from its `Canvas onCreated` and takes it down when
  it unmounts, which e2e reads to project clicks (the lobby's canvas never does).
- **Landing page.** The start screen at `/` (`screens/StartScreen.tsx`) fills the window
  with a live preview (`screens/LandingPreview.tsx`): the real `Board`, drawn without its
  labels (`labels={false}`) and framed on the tower alone (`towerBodyRings`), plays five
  games the computer played against itself on Hard, each to mate (`game/demo.ts`: chosen
  from a hundred for something happening all the way through and a mate rather than a
  long chase), in an order drawn afresh for each visit and then round again (about 20
  minutes), a move every 1.8 s, each as a log of `move_made` messages through
  `deriveHistory`, like a live game, fading under a veil into the next, while
  `three/AutoOrbit.tsx` turns the camera round the tower at a fixed elevation, a full turn
  every 150 s (`three/landingView.ts`). The demo's clock is r3f's. (`showcase.mjs` records
  the 17-ply game that was the demo before, `game/shortGame.ts`, which tests use too.)
  The preview is framed by its lens, not its distance (`three/landingLens.ts`): each of
  the page's three layouts (an upright phone, an upright tablet, a wide window:
  `landingLayoutOf`) holds the camera at one distance, the game's fit's at a window of
  that layout (390x700, a phone's browser with its bars showing; 820x1180; 1440x900),
  and every window zooms the lens instead, to the field of view the fit's distance would
  have needed (between about 31° and 50° on common windows; the fit's is 36°). A zoom
  scales the picture evenly and changes nothing else, so every window of a layout sees a
  scaled crop of one picture of the scene: the page shows that picture
  (`screens/LandingPicture.tsx`, `public/landing/<layout>.avif` and `.webp`, larger than
  any common window of the layout and fading into the night at its edges, the fade drawn
  into the picture) from its first render, placed by the window's lens (`picturePlacement`,
  plain arithmetic with the fit's numbers baked, from the window's size as the page first
  renders, nothing measured: the start page is the entry), and the built page's head starts
  the AVIF downloading before the entry has run (`preloadLandingPicture`, on `/` alone; written
  in after `<meta name="viewport">`, since before it a phone's window reads 980 px wide and the
  script would fetch the tablet's picture: `vite.config.test.ts`). The built page also places
  the picture from an inline script after `#root` (`screens/earlyPicture.ts`; the phone
  layout alone, as a desktop's first click measured slower), so a phone paints it as it
  arrives, before the entry; `LandingPicture` takes that very element in as
  its own in its first commit (while its layout's file fits the window), and
  `earlyPicture.test.tsx` holds the two markups equal.
  Each layout's picture comes at two densities, picked by the screen's (`srcset`): 1x, and
  `@2x` as fine as the preview's canvas draws on a finer screen (the pixel budget's); AVIF
  of 16–44 KB at 1x and 37–73 KB at 2x, colour at half resolution (4:2:0: full
  resolution, 4:4:4, cost 12–15% more for no difference to see at the size shown, and is a
  profile not every AVIF decoder takes). The preview opens on exactly the picture's moment (the opening position
  from the turn's first angle) and fades in over it in 0.3 s once its first frame is
  drawn, nothing moving until it has, and the picture goes. The preview builds its scene (the garden and the board, the most work the page does) in a transition after its canvas is made (`Yielding` in `LandingPreview.tsx`), and links the scene's programs once it is in: React yields to input while it renders, so a click in the first second is answered at once instead of waiting on the build. A click on the way out while the preview is still coming in takes it down in the click's own task (`StartScreen`), so its build, its programs' linking and its first frame never run ahead of the next page; the picture it stands behind stays. `landingLens.test.ts`
  recomputes the baked numbers from the fit and fails when the rings, the opening view
  or the bands change: bake them again and re-render the pictures
  (`scripts/landing-pictures.mjs`, through the dev-only `landing-pictures.html`). The
  menu stands in a column at
  the left, set in from the window's edge by a gutter (6% of the width, 24–112 px), over a
  dark fade that clears just past the tower's edge: the title on two lines ("3D" in the
  level colours, then a short rule in them), the two ways to play as tiles side by side,
  and "How to play" under them. The fit keeps the tower in the room right of the column
  (`leftBand`: with `centre: 'rings'` the rings are centred and fitted in the room right of
  the band, which is kept even where the tower centred in the window would clear it). The
  bands come from the window alone (`screens/landingLayout.ts`, `LANDING_BANDS`, which
  mirrors index.css's sizes and imports nothing from three.js, the start page being the
  entry). A window as tall as it is wide or taller sets the title above the tower and the
  tiles under it (`hudTopBand`, `bottomBand`); an upright one 600 px wide or more, a
  tablet, sets the title and the tiles side by side in a band along the bottom. The two
  tiles are alike in weight: dark glass in a rim of the five level colours (a ring of its
  own, masked to the border, which turns while the pointer is on it), both on a diagonal
  from sky blue, glowing at the top left, to a warmer rose at the bottom right (under the
  pointer the glows brighten and a sheen sweeps across once), two pieces facing each
  other in a box of dark blue glass fitted to them (White's porcelain knight facing Black's charcoal
  knight, or facing the computer's robot in the same charcoal; the robot's box is a little wider, so both
  pairs have the same room round them) and the name, whose size follows the tile's width (container units, 13–17 px; up to 18 in an upright tablet) so "Play the computer" keeps to
  one line in all but the narrowest phones. "Play a friend" creates nothing: it opens the
  side choice at `/new` (see The lobby). "Play the computer" opens the side choice
  against the computer at `/computer` (see Playing the computer). "How to play", a quieter
  outlined button, opens the tutorial (see The tutorial); nothing else is written on the
  page. The canvas is `aria-hidden` and takes no pointer, and a visually hidden sentence
  says what it shows. The three buttons are the page's only controls: the preview always
  plays (it has no pause), except under `prefers-reduced-motion`, where the picture is all
  the page shows (the preview's chunk, and three.js with it, never load), with still rims;
  should the chunk fail to load, the picture stays too. In development `?t=<seconds>`
  starts the demo that far in.
- **No page.** Any other address (`/games`, `/game/` with no id) is the catch-all route's
  `screens/NotFound.tsx`: "Nothing here" in the lobby's heading type in the middle of the
  page's night, and a Home button under it, with no card round the two. It is in the entry
  and loads no scene.
- **Words centred by their capitals.** A label in a box (a button, the turn pill, a menu
  item, the offer's words, the share link) is centred as it looks, whatever font draws it
  (`.caps` in `index.css`): it is a block trimmed to its capitals (`text-box: trim-both cap
  alphabetic`, which applies to blocks only, so a button's words are a span of their own),
  the capitals' fraction of a pixel set over them, so it stands `round(1cap, 1px)` tall with
  its baseline on a whole pixel. A box that centres one grows a pixel where its height and
  the capitals' differ in parity (`calc(H + var(--caps-odd))`, every H even; a browser
  without `cap`, `round()` or `mod()` gets plain values for the three variables under
  `@supports`, not boxes shrunk to their words), and so does an icon
  beside it (the pill's stones, the waiting dot): the browser rounds boxes and baselines to
  the pixel each on its own, and a centring that lands on a half rounds them apart. An arrow
  beside words is `screens/Arrow.tsx`, as tall as their capitals with its ink centred on
  them (a text arrow sits at the font's own height, lower); the start page's tiles centre
  theirs on the badge. A count beside a piece's glyph stands on the glyph's ground (y = 21
  of its 24), as the captured pieces' and the tutorial's do. `e2e/review.spec.ts` measures
  the review's counts and highlight this way.
- **Buttons.** Every button is one of a few kinds, each with one style wherever it stands
  (`index.css`; a context's class only places it): a choice among several is a glass tile
  in its rim (`.landing-mode`, `.lobby-glass`: the ways to play, the sides, the levels);
  a screen's main action is the pill of starlight (`screens/PlayButton.tsx`); a secondary
  action is an outlined pill (`.button-secondary`, a size down as `.button-small`: "How to
  play" on the start page, "Play here", Retry, the tutorial's Next, the result's Review); a word that goes back
  or cancels is a quiet link (`.button-link`: "← Home", a game's "Home" once it is over, "How to play" in a
  game, Cancel, Start over, the result's Decline); a glyph alone is `.button-icon` (the result card's and an error's ✕). The
  pill wears the turning rim of the level colours (`rim`) only where it stands alone on the scene and urges a
  game on: "Join game", the way on from a game taken or gone, the result's "Rematch" (and its
  answers; plain once it turns to "Review"). In a card of
  the rimmed glass ("Copy link") it is plain, one rim to an object, and the 404 page's
  Home goes without. A rimmed card holds more than one thing: a heading and one button
  stand on the page alone. Every turning rim, the pill's and the tiles', is painted by
  `screens/turningRim.ts` on the animation frames, each colour placed by its distance round
  the control (`screens/rim.ts`), so it moves at one pace along long sides, short sides and
  corners alike; at rest it puts sky and rose where the stylesheet's straight gradient does
  (the pill's ends, the tiles' top left and bottom right corners). Focus the page moves by itself (a page's one action on
  arrival, a dialog's button, the promotion's first piece) goes through `lib/focus.ts`
  (`autoFocusRef`, `focusFromCode`, never `autoFocus`): browsers ring any focus a script
  moves before a pointer has pressed, so it is marked `data-quiet-focus` and wears no ring
  until the player presses a key; for a player already on the keyboard it rings at once.
  A page's first Tab stop is its main action, the first where there are several: the page
  focuses it quietly as it opens (White on the side choice, Easy among the levels, Next in
  the tutorial, the pill on a page that has one), and the first Tab shows the ring there
  instead of moving on. The board screen's first stop stays the move box.

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

1. Creator: `create_game {color?, clientId?}` → `game_created {gameId, color}` (the side the creator
   asked for, or a random one if the request names none; the client always names one,
   deciding Random itself so the lobby's coin can land on it).
2. Joiner opens `/game/:gameId`. The invitation first asks `look_game {gameId}` →
   `game_info {gameId, seats}` (the seats already taken; it binds nothing), so it can say
   which side the player will take, or that the game is full or gone (`invalid_game`),
   before they accept. Accepting sends `join_game {gameId, clientId?}` → the joiner gets
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
   turn. Any other close is a network fault and is retried with backoff; a waiting retry
   runs at once when the window comes back `online` or the page is shown again.
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
6. Resigning and draws: `resign` → `game_ended {result: "resignation", winner}` to both;
   `offer_draw` → `draw_offered {by, ply}` to both (`ply`, the number of moves played when it
   was made); the opponent's `accept_draw` → `game_ended {result: "agreement"}`, or
   `decline_draw` → `draw_declined {by, ply}` (`by` the side declining). The record keeps
   them (`ending`; `drawOffer`, the latest offer, `{by, ply, declined?}`), and a `game_state`
   carries both, so a reload or rejoin finds the game ended, or the offer still standing. An
   offer stands only while its `ply` is still the number of moves, so a move cancels it with
   no message of its own, and a client reads the same whichever of a move and an offer made
   at the same moment reaches it first (`game/ending.ts`). Only a seated player of a game
   with both seats taken may send them (`game_not_started` otherwise); after an ending the
   server refuses every move, resignation and offer with `game_over`; an offer while one has
   already been made since the last move, or an answer with no standing offer of the
   opponent's to answer, gets `invalid_draw`.
7. Taking a move back: `request_takeback` → `takeback_requested {by, ply}` to both, refused
   with `invalid_takeback` unless the sender has a move on the record and has not asked this
   move (or had a request declined); the opponent's `decline_takeback` →
   `takeback_declined {by, ply}`, or `accept_takeback` → the record loses the requester's last
   move and any reply to it, along with the draw offer and the request (each names a ply the
   game can reach again), and each connected player gets a `game_state` of the game as it
   now stands, from which the client replays the record afresh (`game/history.ts`). The
   record keeps the latest request (`takebackRequest`, `{by, ply, declined?}`), which a
   `game_state` carries, and it stands and lapses as a draw offer does (`game/ending.ts`,
   `selectTakebackRequest`); the same refusals apply (`game_not_started`, `game_over`).
8. A rematch, once the game is over: `offer_rematch` → `rematch_offered {by}` to both; the
   opponent's `decline_rematch` → `rematch_declined {by}` (the side declining), or
   `accept_rematch` (or an `offer_rematch` of their own: both asked) → a new game with both
   seats taken, each player in the other colour (each tab's claim going with its player),
   and `rematch_started {gameId}` to both, whose pages store the seat and rejoin it there. The
   record keeps the latest offer (`rematch`, `{by, declined?, gameId?}`), which a
   `game_state` carries, so a player who comes back to the finished game finds the offer
   standing or the new game's id (`selectRematch` in `game/ending.ts`). It names no ply and
   stands until answered. The server takes it once both seats are taken, ended or not (a
   mate or a draw on the board is the clients' to see; the app offers it only once the game
   is over), and refuses with `invalid_rematch` an offer while the sender's own stands or
   after it was declined (the opponent may still offer one), an answer with no offer of the
   opponent's standing, and anything once the rematch has begun.

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
assumes world-Y-up; the camera lives in `screens/GameCanvas.tsx` (its starting
direction), `three/cameraFit.ts` (its distance, fitted to the window's shape so the whole
tower is framed on a phone too, and the zoom range around it) and
`three/CameraControls.tsx` (turning and zooming). The engine and wire formats are
independent of rendering, and the e2e click helpers project through the live camera.

## The board

The tower of five glass levels floats in a garden at night. Each level is a sheet of clear
glass edged in its own colour (rose, orchid, violet, blue and sky, A to E: the red end at
the base, the sky at the top, as every gradient of them in the interface runs sky to rose,
left to right and top to bottom; one Okhsv saturation, so all five look equally vivid), with the
3D checker on it (dark where x + y + z is even, so a bishop keeps its colour through the
levels) divided by hairlines of the level's colour. Porcelain and charcoal Staunton pieces
(see Piece set) stand on the glass, each with a thin band of its level's colour round its
foot. Far out, a colossal chessboard drawn in faint light carries twelve giant pieces
outlined in white neon, which sink into the tower's shade as they near it on screen, so
nothing competes with the board; overhead are stars and chess constellations for a camera
that looks up (see The garden). The garden changes only with the view, so while the camera rests it is drawn
from a copy of itself taken on the first frame at rest (`scene/backdropCache.tsx`), and a
move or a selection redraws the tower over it. Files and ranks label the two edges of the bottom platform nearest the
camera (the top one's, seen from high above). The five level letters, each in its platform's edge colour, share one corner post
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
move's source to its destination (in a finished game's review, where the move shown is
marked, a still amber line beside it, the better move, from a small circle to a circle
just outside a piece's ring: `Better` in `scene/markers.tsx`, drawn by the last move's own
programs, so it links none and asks for no frames), and a king in check turns red among four clusters of dark obsidian blades,
with a thin, dim red line running to him from each piece giving check (`Board.checkers()` in
the engine), drawn in from the checker as the check strikes, a soft glow of bright red
travelling along it to him, so a check from another level, or one the moving piece uncovered
(a double check), shows where it comes from. At mate the lines stay and their glow stops.
They are drawn by the last move's line and shimmer programs, so they link none. The
marks look the same from every angle, and a destination takes the pointer and the click on its
circle alone (`MARK_RADIUS`), so a square's empty corners reach a circle beneath. While the pointer is on a level (a square of it, a piece
or a destination), the other levels step back: their glass, edges and marks give up a share of
their light (60%, `STEP_BACK` in `three/scene/focus.ts`), and their
pieces take a light haze (both armies lose the same share of their contrast against the night)
while the level's own pieces stand forward a little. Holding a piece
steps nothing back: its moves to other levels count as much as those on its own. A
piece under the pointer lifts a little; the selected piece lifts higher and holds still in
a column of cool light. A move glides, the piece rigid, along the straight line
between the squares, easing out of its square and into the next and taking longer the
farther it goes (`three/glide.ts`, played by `MoveGlide` in `three/moveAnimation.tsx`); a
piece the player held up stays up while its move goes to the server and settles onto its
square on the way. What brought the shown position is decided once each time its move count
changes (`Board.tsx`, `arrival`): a later position glides its last move in; in the game's
review (`review`, the move history: see HUD) only a step of one move glides, forward as a
move lands or back with the undone move's piece gliding home in reverse (a piece it had
taken standing again, `Reveal`, once the glide has left its square), and a jump of
several moves either way, like a position from history, is simply there. As the attacker
reaches its victim, the victim's outline flashes and a small ring of light spreads on the
glass at its foot; it is knocked over away from the
attacker, burning away as it falls (`CaptureFx` in `scene/fx.tsx`). A king put in check
rocks on his foot as the check lands, and a piece the player taps but cannot pick up shakes
its head (`Jolt` in `three/pieceMotion.tsx`); with reduced motion none of this plays. At mate the king
is knocked over by the mating piece's arrival (`Topple` and `KNOCK_FALL` in
`three/pieceMotion.tsx`): the knock tips him back onto the rim of his base, away from the
piece that mated him, fast at first, then slowing almost to a stop at the edge of his
balance, where he hangs for a moment before gravity takes him over (a rigid body on its
rim, simulated; the knock gives barely enough to reach his tipping point). He is turned
aside if straight away would take him off his platform (`three/mate.ts`). As he strikes the floor a pulse of light spreads across his
level (`scene/fx.tsx`), the obsidian blades round him sink into the glass and are gone, and
the winning army hops in a wave out from him. The result card follows `onToppled` after a
hold on the final board (`screens/useEndCard.ts`), in the middle of
the screen. It can be closed (its close button, Escape, a click outside it) to turn and
zoom the final position, with the rematch left below the tower. From history he simply falls. The knock lands
85 ms before the mating piece comes to rest (its glide eases in so slowly that it looks
landed by then), the pulse spreads at 4.5 world units a second, the wave sets off 370 ms
after the king strikes and travels at 15, and the card follows 1.3 s after the strike
(`lib/mate.ts`).

**The entrance.** Opening the game plays a short entrance, just under 4 seconds when the
game starts while the page is open and 1.3 when the page opens on a game already under
way (a reload, a rejoin), and about 3.1 after the lobby (the `lobby` variant: see The
lobby). The night fades up (except after the lobby, whose last picture is the entrance's
first, level A already standing) and the camera closes in (see Camera; after the lobby
it is already at rest there, the lobby having brought it) while the tower
draws itself in light, level by level from A up, each overlapping the next.
A level's edge grows out of its four corners along its sides to meet in their middles,
a white-hot tip at each front; its hairlines run in across it from both ends, the outer
ones first; its glass floods in from the edge to the middle; and every line settles
from a little brighter to its own light. As the tower finishes the armies form, and the labels
settle in just after, the letters from A. The armies form both at once and each piece with its mirror image
through the centre: the back ranks from the royal pair outward, then the pawns, so the
two sides close in on the empty level C. Each piece rises from its foot behind a thin
line of white light over about half a second, the capture's burn run the other way, what
it leaves behind glowing with its level's light before it cools to its glaze, while a
flash of that light and a ring spread on the glass at its foot. The pill fades in last.
The board takes no input until it is over. With reduced motion the scene only fades in
(150 ms). The timings are pure functions in `three/intro/timeline.ts`; the clock is
advanced on r3f's clock by `three/intro/IntroDirector.tsx`, which moves the camera, and
each part reads it in its own frames (the levels' `uBuild`, the pieces' `uForm`, the
labels' fade). Anything drawn outside the game (no `IntroContext`) is simply there: a
level drawn alone (`<Levels focusLevel={null} levels={[0]} />`) is whole. `GameView` can
hold the entrance at its first frame (`introPaused`) and reports the canvas's first
drawn frame (`onFirstFrame`), which the lobby's handover uses (see The lobby).

How the code is split:

- `three/Board.tsx` owns every interaction rule: selecting and deselecting, legal
  destinations, click-to-capture, hover (from the pointer's ray against the floors and
  pieces, `three/hover.ts`) and the move glide (`three/moveAnimation.tsx`). Its 125
  invisible click targets are thin slabs on each square's floor (`layout.hitHeight`), so a
  click lands on the square whose floor is under the pointer. It renders the grid, markers
  and effects in the `board-decor` group, outside the clickable `board-grid` group, so
  decoration can never take a click. The last move's line and entrance are keyed by move
  and play only for a move that arrived live, never on a reconnect. A page that opens on
  a game under way (a reload, a rejoin) forms the position before the last move in its
  entrance, taking no input, and a beat after its last piece has formed (`replayAt` in
  `three/intro/timeline.ts`) plays that move as it would have landed live: its glide, its
  line, a capture's effect, then a check or a mate (`three/replay.ts`). A move that lands
  meanwhile shows as it lands; with reduced motion the position is simply there.
- `three/PieceMesh.tsx` places a piece. Pointer events hit an invisible, still stand-in
  fitted round the piece at rest and lifted, never the moving body, so a piece that rises
  under the pointer cannot slip out from under it. `three/pieceMotion.tsx` holds the timed
  `Lift`, the `Topple` of a mated king, the decoration that stays on the glass while its
  piece lifts (`ON_FLOOR`), and `useGlide()`, which tells a piece body the levels its glide
  leaves and lands on, so its foot band changes colour on the way.
- `three/scene/` draws everything else: the garden and sky (`stage.tsx`, `heavens.tsx` and
  the parts named in The garden),
  the levels and labels (`plates.tsx`, `grid.tsx`, `smartLabels.tsx`), the piece bodies
  (`pieces.tsx`), the marks of play (`markers.tsx`, `line.tsx`, `selection.tsx`,
  `blades.tsx`) and the capture and mate (`fx.tsx`). `three/intro/` times the entrance. `palette.ts` holds the colours, the
  layout and the sizes they share. Every see-through part writes no depth and draws in a
  fixed order (`layers.ts`), so the glass never hides or tints a marker or a label.
  Board, PieceMesh and GameCanvas import these parts directly; unit tests stand them in
  with `vi.mock`.

All motion runs on r3f's clock, and the canvas renders on demand. The game's and the
lobby's canvases send a new frame to the GPU only after the GPU has finished the previous
one (`three/framePacer.tsx`, a WebGL fence after each frame). Until then the canvas skips
the frame and asks for the next one, and the motion keeps stepping every display frame.
Without this, a GPU slower than the display (a phone's, or software rendering) received a
frame every display frame and fell further behind: in the browser bench a move appeared
over two seconds after it was made, and the board's start-up during a join waited behind
the lobby's queued frames. Under a stepped clock (the showcase's `window.__vclock`) every
frame is drawn.

### The garden

Everything round the tower is background: dim, cool and colourless near it, and sunk into
the tower's shade on screen (`scene/mask.ts`: a distance field to the tower's outline that
darkens the garden near it; from a low camera it reaches less far below the tower than
above or beside it, so the plain under the pieces stays readable). `Stage` (`stage.tsx`)
mounts it in four areas, each handed the board's turn for the seat, the shade's caster and
the lobby's dimming (`gardenDetail.ts`):

- **The sky** (`heavens.tsx`, `skyDetail.tsx`): a field of stars of real spread of
  brightness and colour, spent only where a camera can look (1° to 36° up; `skyStars.ts`,
  with a gold-and-blue double among the doubles), a faint Milky Way leaning out of the haze
  (`skyMilkyWay.tsx`), airglow and mist banks in the sky's colour (`skyColor.ts`, one chunk
  shared with the plain's far veil so the two meet with no step), and the chess
  constellations drawn as a chart draws them, each line whole from star to star
  (`skyChart.ts`, placed by `skyPlace.ts`, two programs for all of it in `skyShaders.ts`).
  Two asterisms have no lines: the tower's echo (five stars climbing in the levels' colours)
  and the eight queens as a faint board of dots with the queens' squares left dark.
- **The colossal board** (`boardGround.ts`, `boardDetail.tsx`, `boardFallen.ts`): a framed
  board of faint light, its dark squares given an even polish, and the twelve sculptures in
  white neon tube. Every stroke is a capsule drawn per pixel (`neonStrokes.ts`), so a line is
  one even tube however it bends: no spurs, no breaks. Turned pieces show their outline to
  the viewer, the same from every side, with rings fitted to it; what is not the same from
  every side stands fixed in the world: the bishop's cut, the unicorn's spiral, and the
  knights, outlined by their real silhouette from wherever the camera is
  (`sculptureStrokes.ts`, `knightSilhouette.ts`), so nothing mirrors as the view turns.
  Each sculpture lights the stone round its foot with a broad, even disc lying on the ground
  (`sculptureGlow.tsx`); past the board's edge lie a few fallen giants. A figure the camera
  has passed and stands behind is not drawn: it is shown or hidden whole, and changes only
  on a frame when none of it is on screen (`gardenSides.ts`, through `gardenWhole`).
- **The court** (`court.tsx`, `courtLayout.ts`): the near ground round the tower's foot,
  the quietest part: polished slabs seen only as a change of sheen, two whole rings of
  light with spokes pointing the knight's eight ways, and stepping stones a knight's jump
  apart.
- **The horizon** (`horizon.tsx`, `horizonGround.ts`, `horizonSkyline.ts`): the plain is a
  disc nearly as wide as the sky, thickening into the sky's own colour, so it meets the
  night at a level horizon with no edge; two ranges of hills, a few crags among them a chess
  piece's silhouette; mist and a few far lights; on White's side a far rook's tower with one warm window lit
  (dark once a game is won), and on Black's another game's tower, five plates of light in
  the levels' colours, square from the side.

Rare events (`shootingStar.tsx`, `skyEvents.tsx`: a constellation tracing itself, a
satellite, paired meteors; `horizonEvents.tsx`: a lighthouse's sweep) never wake the
canvas: each starts only on a frame already being drawn while the player turns the view,
keeps frames coming only while it lasts, runs on r3f's clock, and is drawn at no light
from the first frame so no program links when it comes. On the game's page and in the start
page's preview the garden's programs (all the scene's) are linked before that first frame, the
page free meanwhile
(`linkBeforeFirstFrame` in `rendererSetup.ts`, `linkAhead` in `scene/programs.ts`: handed
to the GPU at once, a fence polled between tasks, the uniforms read back while it is idle),
and the warm-up of the marks of play links its programs the same way. Every garden
material follows the backdrop cache's rules (CLAUDE.md "Performance"): opaque list below
`BACKDROP_END`, no depth, and nothing that changes but a uniform, a matrix or a
visibility. The ground is one shader drawn in four parts (`PARTS` in `stage.tsx`), each
compiled with only its own detail, and the work that can be is done per vertex, since
software rendering runs both sides of every branch.

The dev-only sculpture viewer (`sculptures.html`, `src/dev/SculptureViewer.tsx`) shows one
sculpture up close; `node scripts/sculptures.mjs --target a4 --out <dir>` saves a sheet of
it from several sides (or `--orbit 2` for a turn round it), with Vite running.

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
phone). `--intro` records the game's entrance from its first frame (`--seat black`,
`--rejoin` for the short one, `--reduced`), to `intro-<seat>.mp4`, stills at `--at
"s,s,…"` seconds and a contact sheet. `--lobby` records the way into a game against the
computer on one page, from the side choice's first frame through the pick
(`--side white|black|random`), the level (`--level`), the computer's arrival and the handover to the end
of the game's entrance, to `lobby-<side>.mp4` and a contact sheet of a still every `--every`
seconds, each with its time, the page and the lobby's beat: look at it for a black or
repeated frame, or a beat that starts before the last has finished (it needs only Vite).
Usage is at the top of the script.

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
mitre with its bold slanted cut, on a bead, and its ball; the unicorn's horn
wound with a raised spiral, three turns of a bead with a groove carved under it, to a
blunted tip; the queen's open tulip crown, its rim
drawn up into eight pointed tines with pearls, round a ball finial; and the king's
fluted bucket crown, a low dome behind its rim, under a slim cross pattée taller than
wide, with arms both ways, so it reads as a cross from every side and as a plus from
above. Every piece can be told apart by silhouette alone.
Pieces stand base-at-`y = 0`, face `+x` (Board turns the knight), and fit within a radius of 0.27 (the knight's muzzle reaches a little past it); the board draws them at 0.8 scale (`PIECE_SCALE` in `scene/palette.ts`), so the
king stands clear of the level above. Each piece is split into **parts**, painted
separately:

- `body`: everything turned or carved that is not one of the parts below;
- `collar`: the ring (or rings) where the stem meets the head;
- `accent`: the details that identify the piece (knight's mane and eyes, bishop's cut, the unicorn's spiral bead, queen's pearls, king's cross, rook's crenel sills and hollow);
  pawns have none. The relief names every piece on its own;
- `foot`: a thin band at the very bottom (`FOOT_HEIGHT`, 0.04), in the colour of the level
  the piece stands on.

The game draws the medium set, `pieceSet()`, built once and shared by every piece (it keeps
every piece within about 5k triangles; each piece is built the first time it is drawn, and
the board builds and bakes the set while the browser is idle with `preloadBakedSet()`, one
piece per idle callback, or per 50 ms timer where there is none: Safari and iOS). Its
knight is not sculpted in the browser: its head, mane and eyes (a few hundred
milliseconds of sculpting and decimating) ship precomputed, byte for byte, in
`pieces/knight.medium.ts`. The gallery, the benches and the tests reach the other
qualities through `sculptedPieceSet('low' | 'medium' | 'high')` (`pieces/sculpted.ts`),
which sculpts their knights; the game's build holds none of that code. The medium set's baked occlusion (below) ships the same way, in
`scene/occlusion.medium.ts`. After changing a piece's shape (anything in `three/pieces/`,
or the bake in `scene/occlusion.ts`), run `npm run bake:pieces` in `client/`;
`knightData.test.ts` and `occlusionData.test.ts` fail while either file is stale, and
`golden.test.ts` pins the medium and low sets' geometry by hash (the medium set as built
and as drawn). `partsGeometry(set, type, parts)` hands back a piece's parts merged into one
geometry, and `pieceTop(set, type)` its height. `scene/pieces.tsx` draws each piece in one
draw call with one small shader: every vertex carries its part, and the
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

## The lobby

Everything before the first move happens in the lobby: level A's glass alone in the night
garden (the game's `Stage`, its sculptures dimmed behind the kings through `Stage`'s
`dim`, and a platform that draws itself on the entrance's build clock) with the kings on
its middle rank, each king on the middle of its own square (`SEAT_SPACING`, one square
apart at every window size), White's seat on the left and Black's on the right. A taken seat shows its
king in its army's material; a free seat is the king drawn in neon, like the garden's
sculptures (`three/lobby/LobbyKing.tsx`); filling, the material forms from the foot up as
the neon gives way, and the player's own king stands on the glass in the game's column of light. The
lobby is a layout route (`screens/lobby/LobbyLayout.tsx`) round `/new` and
`/game/:gameId` (and `/computer`, `/computer/:gameId`), so its one canvas stays up from the side choice to the game's first
frame. The screens declare what it shows with `useLobbyView`
(`screens/lobby/lobbyContext.ts`: a beat, `choose`, `wait`, `invited`, `arrive` or
`leave`, the taken seats, the player's seat and an optional caption, or
`null` to take it away), and `three/lobby/LobbyScene.tsx` moves from one picture to the
next on r3f's clock. The scene writes the kings' places on screen as
`--seat-<seat>-x` and `--seat-<seat>-front` (the near edge of its foot) with
`--king-height` on the layout; the page's buttons and labels hang off them and are sized
by the king. The page's heading at the top carries the story from one step to the next, and the
cards under the kings carry only what to do. Timings and framing are pure functions in
`three/lobby/lobbyMotion.ts` (the kings stand 1.25 times the game's pieces; narrower than
9:10 they stand smaller and further out; the camera draws back, never the kings apart,
until the row fits the width).

- **The entrance** (`LOBBY_ENTRANCE` in `lobbyMotion.ts`), when the lobby is first shown,
  about 2.4 s and calm: the picture fades up from the page (0.9 s) while the camera settles
  in from a little further out and higher, easing out (`entranceFrom`, `settlePose`); the
  glass draws itself over 1.4 s; each king forms from the foot out of nothing, with no
  outline first (a free seat's outline comes up instead), White's, the coin's and Black's a
  beat apart (from 0.6 s). No king can be hovered or picked until it has formed; a pointer
  already resting on one hovers it then. On the side choice the heading rises as the glass
  draws, and "← Home" and each button come in (hidden and unpressable until then) once its
  king has formed (CSS, held until the scene's first frame sets `data-scene` on the layout,
  or 1.5 s).
- **Choosing a side** (`/new`, `screens/lobby/ChooseSide.tsx`). "Choose your side" over
  three kings, porcelain, one split porcelain and charcoal for Random, and charcoal, with a
  button under each named only "White", "Random" or "Black" (sized with the kings as
  they stand on screen, `--king-height`: word, height and width all scale, from 15 px text
  in a 92 by 46 px button under a phone's small kings to 200 by 60 px with 20 px text under
  a large screen's, never under 44 px tall, each hanging a little under its king's foot,
  `--seat-<seat>-front`), and nothing under the heading. The page is in the home page's
  language: the headings in its display type (heavy and tight, over the short rule of the
  level colours that stands under its title), and the buttons and cards of its tiles'
  glass (`.lobby-glass`, shared with `.landing-mode`). A side button wears the tiles'
  rim in full, as they do, and their glow and sheen when pointed at (on it or on its king),
  focused or chosen, its rim turning while pointed at. A king lifts under a mouse (on it or its button) or its
  button's focus, as if picked up, and clicking either picks; a tap leaves no hover behind.
  A pick is final: `create_game {color}` goes out at once (and again on the next socket if
  its answer is lost), and the heading turns to "You play Black" (or "Leaving it to
  chance…"), with nothing under it. The chosen king is set down on its square (its height
  is one eased value, a little quicker down), a small ring of light runs out to the
  square's edge (`placeRing`) and its column of light comes on, while the two not chosen
  fade where they stand (`LOBBY_TIMING.fade`, 0.7 s, easing out; blended over the glass,
  drawn after it, `FADING_ORDER`), with no outline: the free seat's outline rises from its
  foot only as the invitation comes (`veiled`, `seatOpening`, the neon's `uReveal`). Random
  is decided in the client: the side kings cross from solid to their outlines as they fade,
  and the split king is thrown like a coin, lands on that face in the middle, and slides
  along the glass into its seat's outline, where the seat's king takes over with the same
  ring and light; the Random button fades as the coin sets off from the middle
  (`onGlide`). Every chosen king stays on the glass until the game starts. The page moves
  to `/game/:id` (`replace`, so Back from the invitation leads to the landing page) once
  both the answer and the moment are over (`onSettled`, `LOBBY_TIMING.settle`: 0.3 s after
  the pick or the coin's rest, while the others still fade, so the pick, the camera's
  move and the card run as one). A
  refusal puts the kings back with "Couldn't start a game: …". The invitation's "Play a
  friend" leads here.
- **The host** (`GameScreen`'s `wait` beat and `InviteCard` in
  `screens/lobby/LobbyCards.tsx`). The heading stays "You play Black", now with a
  breathing dot and "Waiting for your friend…" under it. The card under the kings, of
  the tiles' glass in their rim: "Invite
  a friend", the link (`lib/gameLink.ts`, plain, without its scheme, on one line and
  cut off at its end when long, its box only as wide as the link), and one "Copy
  link" pill of starlight, plain in the card's rim (only where the clipboard can be
  written); nothing else. A copy turns the button to
  "Copied ✓" (and is said, "Link copied"); only a failed one is written: "Couldn't copy.
  Select the link." The neon seat breathes (for its
  first minute, calmer after half of it), and the camera holds still. In a short, wide
  window (a phone on its side: `cardBeside`, at most 500 px high and 13:10 or wider) the
  card docks at the right and the kings and heading stand in the room left of it.
- **The guest** (the `invited` beat and `InvitationCard`). A page with no stored seat asks
  `look_game` once per socket until answered, and `game/invitation.ts` reads the answer.
  With a seat free the heading reads "You're invited to play" with the side's stone and
  name, and under the scene, where the host's card stands, there is only "Join game"
  ("Joining…" once pressed), the button alone with no glass round it. Until the
  look is answered nothing is said; a wait on the server is only mentioned once it has
  lasted 1.5 s (`useDelayed`, `SLOW_SERVER_MS`): "Connecting to server…" or "Reconnecting to
  server…", the same words and delay as the side choice's bottom line;
  joining fills the guest's king at once,
  before the server answers, on the glass and not yet in its light. The scene is framed as
  the host's wait, the kings a little higher over "Join game" (the view's `card`), and the
  click eases it down to the arrival's framing, as the game's start does on the host's page. A game with both seats taken, or
  none, says "This game is taken" or "No game here" as the page's heading, with "Play a
  friend" alone where "Join game" would stand. A page
  with a stored seat shows no lobby, only "Returning to your game…", until its rejoin is
  answered.
- **The handover.** When the game starts on a page that showed the lobby, `arrive`: the
  free seat fills, a ring of light spreads across the glass from it, and the caption takes
  the heading's place, one line: "Opponent joined" for the host, "You play White" (or
  Black) for the guest. Meanwhile `GameView` mounts under the lobby, held
  on its first frame (`introPaused`), and reports that frame; if it never comes,
  `FIRST_FRAME_WAIT_MS` (4 s) lets the lobby go anyway. Once both kings are filled, and no sooner
  than a fresh fill would take from the start (so a guest's king filled on the click keeps
  the same beat) (`together`, shared as a `KingPair`), a king not yet in its light gets its
  column `arriveLight` (0.4 s) later, so it follows the new king going solid and the ring
  rather than competing with them (on the guest's page both columns come on at once), and
  at `arriveLift` (0.65 s) both lift together on both pages. Then `leave`: both rise on up in their columns of light and are taken up
  into them from the foot (`uGone`), level A's glass stays, and the camera comes to rest on
  exactly the game's first-frame pose (`gameOpening`: the fitted distance on the opening
  line of sight from the player's seat, with the fit's lens shift) while the sculptures
  come back up to the game's brightness. It is two motions, one under the other (`leavePose`, 2 s): the camera eases gently off the
  lobby's view and draws back (`leavePull`: in the log of the distance, its speed ramping up
  over the first two-fifths, even through the middle, and easing to rest over the last
  three-tenths), while the glass barely turns at first, gathers speed gradually, and spins
  hard into place in the second half (`leaveSpin`: fastest three-quarters of the way, then
  brought to rest), sliding down the picture to its place as the camera's look rises from it
  to the tower's centre on the same curve. The camera turns round the tower only a little
  (+16°, the same for either seat), and only while the garden is black: the lobby's garden
  and its caption ease off to black together from the moment the lobby starts leaving, over
  about 0.8 s (`leaveVeil`, a black veil drawn over the garden and under the glass and the
  kings; the caption follows it through `--leave-ink`, and the garden keeps the kings' shade
  until it is dark), stays black past halfway, long enough that
  the lobby's garden and the game's never read as one place seen from two sides, and in the
  dark becomes the game's (laid out for the player's seat, in the game's light), which fades
  up already in place as the glass spins into place. So the garden never turns on screen;
  the glass and the kings turn half a turn under the camera (`LEAVE_GLASS_TURN`), so the
  glass spins -164° on screen for either seat and, being square, ends just as the game's
  level A stands. As the camera settles its last
  hair's breadth (`leaveReveal`), the game's entrance starts its `lobby` variant
  (`onReveal`; `three/intro/timeline.ts`) under the lobby's canvas, which fades off it
  (`leaveFade`, then `onLeft`): the entrance keeps to the moment the lobby shows
  (`lobbyHandover`) until the lobby has gone. Level A stands from the start
  (`levels.built`), nothing fades up, the camera stands still, and B to E build on up from
  A as the armies form, in about 3.1 s. A host whose tab is
  hidden when the guest arrives gets the title "● Opponent joined · 3D Chess" until they
  look (over "Your move", see HUD), and the arrival waits for them (a hidden tab draws no
  frames). A page that opens on a game
  already under way skips the lobby and plays the short entrance.

Under `prefers-reduced-motion` the seat does not breathe, the
coin lands without its flight and each beat takes a fraction of a second. The lobby's
canvas never publishes `window.__r3fState`, so e2e's click projection always reads the
game's; `waitForBoard` waits for `data-intro="done"`, by which time the lobby has gone.
`e2e/createGame.spec.ts` walks the way in, and `startGame(browser, { side })` in
`e2e/helpers/game.ts` picks a side (White by default). Its pages ask for reduced
motion unless given `motion: 'full'`: played in full on two software-rendered pages,
the way in alone takes most of a minute on a busy CI runner.

Known limitations: a page decides host or guest from the stored seat alone, so with
browser storage refused the creator is invited to the other seat of their own game, and
"Join game" is refused with "Already in a game" (the connection already holds the
seat). And a guest whose join was recorded but whose answer was lost, who then reloads
before any seat was stored, is told "This game is taken": the look sees both seats taken,
although a join from that tab would get its own seat back through its client id. (Without
the reload the join is re-sent on the next socket and recovers the seat.)

## Playing the computer

"Play the computer" on the landing page opens `/computer`: the side choice of The lobby
(`ChooseSide` with `computer`), the first of two steps. The second is the computer's
level, Easy, Medium or Hard; choosing it makes the game on the spot, in the browser,
under a fresh lower-case id (a server game's id is upper case). No server is asked, so it
plays offline.

**The way in** tells one story, each beat starting once the last has visibly finished:

1. _Choose your side._ The pick plays out as against a friend: the chosen king set down
   in its ring and its column of light, the others fading (or the coin thrown and landed,
   "Leaving it to chance…").
2. _Choose difficulty._ Once the chosen king is set down (`onSettled`, as a friend's game
   moves on to its invitation), the page is an invitation (the `invited` beat, with no
   card: the camera holds the side choice's framing): the computer's seat across from the
   player's opens, its outline drawn up from the foot and breathing, and Easy, Medium and Hard in a row under
   the kings, where the side's buttons were (`.lobby-levels`, rising in turn; Easy, the first, has the focus, so the first
   Tab stops on it): three tiles like the home page's, each
   the computer's robot (`screens/BotGlyph.tsx`, the home page's) beside its strength, one bar to three in the colours of the tower's levels from the top down (sky, violet, rose), and the level's
   name (a phone on its side sets them shorter, the robot beside the name).
3. _The computer arrives._ A level fills the computer's king at once (its seat taken)
   while the level chosen holds a moment, the others fade and the page's words go
   (`[data-out]`); as the levels' fade ends (their
   `animationend`; at once under reduced motion) the page moves on to `/computer/<id>`,
   which opens straight on the arrival: the ring spreads across the glass and "Computer ·
   Hard" takes the heading's place; then, as for a friend, both columns of light, the
   lift, and the game's entrance.

The lobby's stage is never taken down on the way (each page's picture stays until the
next shows its own over it), so nothing goes black and nothing plays its entrance twice.
`node client/scripts/showcase.mjs --lobby` records all of it, frame by frame (see
Recording the board).

**The game page** (`screens/ComputerGameScreen.tsx`, a chunk of its own,
`screens/computerGameChunk.ts`, asked for as the side choice shows) is the ordinary
`GameScreen` with a `computer` prop, over a stand-in for the socket: `useComputerGame`
(`hooks/useComputerGame.ts`) implements `GameSocket` and answers the screen's messages as
the server would (`game/computerGame.ts`: `rejoin_game` with a `game_state`, `move` with a
`move_made` after checking the move against the rules engine, `resign` and `offer_draw` as
the server does, the refusals the server gives), so the board is event-sourced from the log
exactly as in a game between two people.
The game (side, level, whether the computer has sat down, the move record, the ending and
the latest draw offer) is kept in
`localStorage` after every move (`3dchess:computer:<id>`, and in memory where storage is
refused), so a reload comes back to it. The stand-in's log opens with the game as it
stands, as a rejoin's answer would (and a game not yet begun has the computer sit down at
once), so the page holds its seat from its first render. It plays the arrival only when it
was opened from its side choice (`markArriving`, in memory: a reload or a visit from
history opens on the game itself, with its own entrance). The pill calls
the opponent "Computer", and "Rematch" starts the next game at once (see HUD). A page for a game
this browser does not hold says "No game here", with "Play the computer".

**The computer's move.** Whenever the record leaves the computer to move, the hook asks
`ai/computer.ts`, which runs the search in a module worker (`ai/worker.ts`), so the board
keeps turning and animating while it thinks; where a worker cannot be had the search is
imported and run on the page. Its move arrives as a `move_made` after a human pause
(`thinkTime` in `ai/levels.ts`, counted from the question, the search's own time
included): about half a second for a forced move, under a second for an obvious one (a
recapture, or one far better than anything else), brisker in the first eight plies, and
otherwise 0.65–1.35 times 1, 1.4 or 1.7 s by level. Should the search fail, the computer
plays a legal move all the same.

**A draw offered to the computer.** The computer never offers one. Offered one, it drops any
move it was thinking over and weighs up the position (`assess` in `ai/computer.ts`,
`assessPosition` in `ai/choose.ts`, in the same worker: a plain search of up to 0.4 s with
Hard's depth, without any level's misjudgements or blind spots), then answers after a beat
(`DRAW_ANSWER_MS`, 0.9 s from the offer, its thinking included). It accepts only when it
stands clearly worse, at 150 centipawns or more down by its own reckoning (`ACCEPTS_DRAW_AT`
in `game/computerGame.ts`), the same at every level; otherwise, or if it could not weigh
the position up, it declines and plays on. A move the player makes before the answer
cancels the offer.

**Taking a move back.** Against the computer the arrow under the flag asks nothing: it takes
back the player's last move and the computer's reply if it has made one (`takeBack` in
`game/computerGame.ts`, through `useComputerGame`'s `takeBack`), so the player is to move in
the position before their move. The stand-in answers with a `game_state` of the game as it
now stands, as the server does for a take-back granted, and the draw offer goes with the
moves. Taken back while the computer thinks, its answer to the move taken back never lands
(the worker still finishes that search before it starts on the next). Playing Black, the
computer's opening move stays; once the game is over (a mate, a draw, a resignation) there
is nothing to take back.

**The engine** (`client/src/ai/`) is separate from the rules engine, built for speed:
`position.ts` keeps the board as 125 bytes, cells numbered as `engine/board.ts` numbers
them, with occupancy bitsets per side, moves packed into integers, make/unmake in place and
Zobrist hashing (`position.test.ts` checks every move list against the rules engine over
thousands of positions of random games). `search.ts` is iterative-deepening alpha-beta
(principal variation search) with a transposition table, quiescence search, null-move
pruning, late-move reductions, check extensions, futility pruning, and killer and history
ordering. It plays by the draws too: a position standing for the third time scores as a
draw, and so does one repeated inside the line searched (it can always be repeated once
more), only positions since the last capture or pawn move being compared; and a hundred plies
without either draw unless the position is mate. A lead counts for up to a quarter less as
those plies run out, so a side ahead makes progress rather than drift into the draw, and a
side behind takes a repetition when it is offered. `evaluate.ts` scores material at its own
values (queen 9.8, knight 3.2, bishop 2.95, rook 2.45, unicorn 1.4, which play with the
terms that follow; the captured pieces' "+N" counts material alone, see Piece values), development and
centralisation in the cube, pawns' progress towards their last square (worth more as the
board empties), king safety (home behind its pawns, enemy pieces near it) giving way to an
active king in the endgame, mobility (left out of the quiescence search where it cannot
matter), the bishop pair, and, a side ahead, trading down and driving the bare king to a
corner, which mates with king and queen. In the browser it searches some 400,000 positions
a second.

**The levels** (`LEVELS` in `ai/levels.ts`, the choice in `ai/choose.ts`). Unlike a pure
engine, the search gives an exact score to every root move within a margin of the best, and
the level chooses among those the way a player would: each move's score off by the level's
noise, a little less for moving a piece straight back to where it came from, then a softmax
at the level's temperature over the moves within its margin. A mate is always taken and a
move into a mate never chosen while there is another. Every level plays the first eight
plies more freely, so no two games open alike. A level can also overlook moves that are
hard to see on five levels (`hardToSee`): a knight's jump to another level, or a long move
(two squares or more) that changes level. An overlooked move is hidden from that turn's search
below the root (except from a side in check), whoever would play it, so the computer walks
into a long unicorn line or a knight from the next level up, and misses its own follow-ups,
the way a person does; its own moves this turn are always all considered.

| Level  | Looks ahead                     | Misjudges by | Plays near-best within  | Overlooks hard moves |
| ------ | ------------------------------- | ------------ | ----------------------- | -------------------- |
| Easy   | 2 plies, short captures         | ±45 cp       | 260 cp (temperature 70) | half of them         |
| Medium | 3 plies                         | ±18 cp       | 90 cp (temperature 22)  | about 1 in 5         |
| Hard   | up to 1.8 s, as deep as it gets | —            | 16 cp (temperature 6)   | none                 |

Measured by self-play (`chooseMove`, alternating colours): Easy beat a random mover 6–0,
Medium beat Easy 18–0, and Hard beat Medium 16–0 even on half its thinking time.

**A finished game's review** ("Review", see HUD) asks workers of its own, one fewer than
the machine's cores and at most three, one position each at a time, handed out from the
start (`analyse` in `ai/computer.ts`, `analysePosition` in `ai/choose.ts`), so the marks come
in from the first move on and the page's going stops it; each position is a search of its
own, so the marks are the same however the positions are split: Hard's depth and quiescence,
margin 0, no noise or blind spots, as `assessPosition`, but bounded by 120,000 positions
searched (`ANALYSIS_NODES`, about a third of a second in the browser) rather than the
clock, so a game reviewed anywhere gets the same marks (1.5 s is a backstop for a slow
machine), and looking past a forced move (`deepenForced`; a move needs no choosing, but its
grade needs what it leads to). Each answer is the best move and its score for the side to
move, a forced mate as the plies to it. `game/analysis.ts` grades each move as lichess
does: what it cost the mover in winning chances (from -1 to 1, a logistic of the score:
`2 / (1 + e^(-0.00368 cp)) - 1`) between the best score before it and the negated score
after it, so a pawn thrown away a queen ahead counts for little; 0.1 an inaccuracy, 0.2 a
mistake, 0.3 a blunder. The best move is never marked. Walking into a forced mate, or
letting one go, is a blunder unless the player stood (or still stands) so far behind (or
ahead) that it hardly changes the result: a mistake past 7 pawns, an inaccuracy past 10. In
self-play (`chooseMove` games, each position reviewed), per 100 moves: Easy 13.6
inaccuracies, 6.6 mistakes and 5.8 blunders, Medium 10.5, 2.1 and 2.9, Hard 2.0, 0 and 0.3
(16 Easy, 12 Medium and 8 Hard sides).

### Piece values

What a piece is worth here, in pawns, is measured rather than borrowed from chess: queen 11.2,
knight 3.1, bishop 3.1, rook 2.8, unicorn 1.2 (`game/material.ts`, the captured pieces' "+N", meant
to say who is winning from which pieces stand alone, in every phase of the game). They come from
self-play of test bots (`research/piece-values/`, its README for the detail): a C port of `src/ai`
that searches node for node as the game does, with pruning added that is worth about 200 Elo at
the same work, every move searched to a fixed number of positions. Material was taken away at
random, never by a bot's choice, so no imbalance came with compensation, from the starting
position and from quiet, level positions of played games in three phases (12 or more pieces
besides kings and pawns; 6–11; 1–5 with pawns on both sides), leaving the start quiet (nothing
hanging, no check); each imbalance was played twice, swapped between the sides. In each phase
every piece's effect on the odds of winning was fitted, the pawn's included, and one set fitted
to predict well in all phases at once, each weighted equally; the pawn was set to 1 last. Over
some 15,000 games at three strengths:

- A knight is worth a bishop; a rook about nine tenths of one, a unicorn two fifths, a queen
  three and a half; the same at every strength and in every phase but one: in endings a rook is
  worth more against pawns.
- The values hold once the bots play reasonably: replaying the same games at 20,000, 80,000 and
  320,000 positions a move gives a bishop 3.14, 3.20 and 3.08 pawns (only at 5,000, 3.4, is
  play weak enough to shift them). Each of those steps is worth 300 to 375 Elo; the game's Hard
  sits about 205 Elo above the 80,000 bots, so the 320,000 bots play about 100 Elo above Hard.
  The values are fitted to the games at 80,000 and 320,000 together.
- Against the old values (queen 10, knight and bishop 3, rook 2.5, unicorn 1.5), these predict
  results better in every phase, and where the two read a game differently, the side these
  put ahead scored 54% (680 games).
- In endings without pawns no lone piece mates, so an extra piece there nearly always draws;
  the "+N" cannot show that.

The computer keeps its own values (`ai/evaluate.ts`: queen 9.8, knight 3.2, bishop 2.95, rook
2.45, unicorn 1.4): they play together with its positional terms, and at equal work its search
did no better with the measured values (scaled so its positional credits keep their share: 44–46%
in 1,000 games), with evaluations fitted to self-play results (29% or worse), or with constants
tuned for strength (51.3% ± 1.4%).

## The tutorial

`/learn` (and `/learn/<lesson>`: `rook`, `bishop`, `unicorn`, `queen`, `king`, `knight`,
`pawn`) opens on Setup, the armies as a game starts (nothing picked up, the board only to
look at, and in the card each side's pieces counted in one row, the words saying what chess
doesn't have: two unicorns, and ten pawns instead of eight), then teaches how the pieces move on the real tower and rules, a
lesson per piece (`screens/learn/LearnScreen.tsx`, the lessons in `game/lessons.ts`), through staged positions
rather than text: a sentence or two a step, said plainly as a teacher would ("Rooks move in a
straight line, in any of 6 directions: left, right, forwards, backwards, up or down."), and a
quieter note only for a rule the board can't show, such as no castling. A direction is only
ever one of the six (left, right, forwards, backwards, up, down): a bishop goes two at once, a
unicorn three, and the ways out of a square are counted as lines ("12 lines"). One card holds the whole lesson: the pieces along
its top, the lesson (the unicorn's badged as the new piece; the pawn's step named beside its
name, with a dot for each step at the right, the current one a longer bar, a tap on one going
to it), and Next. Each lesson stands the piece alone on Cc3, the middle of the board,
picked up, every square it can reach ringed in gold, beside a little cube with its lines
drawn from the middle (a rook's to the faces, a bishop's to the edges, a unicorn's to the
corners) and how many moves it has from where it stands. A tapped ring plays the move (the
glide, the last move's line): the piece is picked up again where it lands and the count follows
it; Reset puts it back. A piece captures as it moves, as in chess, so only the pawn has more
steps: Move (White's), Black (Black's pawn alone in the middle, "Black pawns mirror
White's. They move the opposite way, down instead of up", said without forwards or
backwards, which depend on the side; the board stays White's way round, seated as no one
with Black on turn), Capture (a piece on each of its five capture squares) and Promote (from
Dc5, already on the far rank and a level short, so its one move up onto E5 opens the real
promotion dialog; the figure shows White's row and Black's, on White's side, and the note
says so). Next runs
through every step and lesson to "Play a game" (`/new`). A game's page has its own way in:
"How to play" at the top right of the HUD (a "?" in a window under 720 px wide, where the
pill's row ends short to make room for it on a phone; `e2e/hudFit.spec.ts` keeps it clear of
the rest of the HUD and of the tower). Opened from there, the tutorial is handed the game's
address in the router's state (`learnBack.ts`, a game page only) and carries it from lesson
to lesson: "← Home" becomes "← Game" and the last Next "Back to game", both back to that
game, which rejoins as on a reload. The card keeps one height per layout (beside the tower, 376 px, or
396 px for the pawn's steps; along the bottom 260 px, 272 px on a phone held upright, whose
words are larger, and 284 px on one 380 px wide or less, where the words take the card's
whole width without the figure; the window's height under Home on a phone on its side),
sized so every lesson fits with room above its foot; should a window be too short, the
lesson scrolls above the foot rather than run into it. The tower is framed in the room the
card and Home leave (`learnLayout.ts`), with the rings as seen from the opening in its middle
(`centre: 'opening'`) and kept in it from there and from below (looking down from higher up
they may pass under the card: framed for every elevation, a small phone's tower would stand
a fifth smaller). Where the card stands at the left (12 px in, in a short window; in a wide
one set in by the home page's gutter, `--learn-gutter`, as `--landing-gutter`) and the
tower, centred, would run under it, the fit centres the tower in the room right of the card
instead (`settleLeftInset`, the lens shift's one sideways part); in a wide window the card
stands beside the tower only once the tower, centred, leaves the card's 300 px and 20 px
more (`cardBeside`). On a touch screen Next and Reset take a fingertip's 44 px as they
stand (a hit area reaching into the foot's room), so the card keeps its height.
`e2e/learn.spec.ts` walks every lesson and step at six sizes, one for each layout down to
a 320 px phone either way up, and fails on a lesson within 10 px of the foot, one that has
to scroll, anything past the card's sides, or a card out of the window.

The board is the game's `Board` with `showMovesOf`, a square whose piece it keeps picked
up (on mount and in each new position, once a live move has landed). The lessons have no
kings, which the engine needs to tell a legal move; `LessonBoard` (a `Board` of the
engine's) lets a piece without its king make every move it has, and keeps the rules of
check where one stands. The page is a chunk of its own (`LearnRoute.tsx`, which says so
should it fail to load), so the start page carries none of it; the start page's link asks
for it as the pointer or focus reaches it, and `/learn` preloads it. The canvas
(`screens/learn/LearnCanvas.tsx`, in the chunk the game's board shares, preloaded on
`/learn` like `/new`) frames the tower under Home
(56 px, where the lobby has it) and over the card (its height and a 12 px gutter: 272 px,
284 px on a phone held upright, 296 px on one 380 px wide or less), or, where the window is wide enough for the tower to
clear a card at its left from every side the view turns to, or short, beside the card
(`learnLayout.ts`, `cardBeside`, which also sets the page's `data-card`). It never
publishes `__r3fState`.

## Repository layout

```
client/          React app (Vite). Engine in src/engine, log-derived game state in src/game,
                 the computer player in src/ai, UI in src/screens + src/three.
client/e2e/      Playwright tests; boots the real server and Vite (see playwright.config.ts).
client/scripts/  Showcase recorder, piece gallery, piece bake, browser benchmark, README image.
client/bench/    Client benchmarks (vitest bench) and their seeded fixtures.
server/          FastAPI app + Modal deployment (modal_app.py), schema, generated models, pytest suite.
server/bench/    Server benchmarks: store operations, live WebSocket load, adversarial input.
bench/           The benchmark runner (run.mjs) and the primary rows (primary.mjs); reports go to bench/out/.
bench/loop/      Performance work log: ledger of ideas tried, A/B reports, patches, tools.
docs/            The README's picture (preview.jpg, from client/scripts/readme-image.mjs).
research/piece-values/  How the piece values were measured: test bots (a C port of src/ai) and scripts.
.claude/         Claude Code settings, format hook and project skills (check, regen-types, run-3d-chess).
.github/workflows/  ci.yml (tests, gates, deploy) and claude.yml (@claude on issues and PRs).
.github/dependabot.yml  Weekly dependency PRs (npm, uv, GitHub Actions).
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

# Benchmarks: every tier in turn, then read bench/out/RESULTS.md (--quick for a smoke run)
node bench/run.mjs                 # --only client|server|browser; --compare <old bench/out>
node bench/run.mjs --primary --base main   # a change: the primary rows, A/B, bench/out/AB.md

# Deploy backend manually (not normally needed — CI deploys on merge to main).
# GITHUB_SHA is what /health reports; without it the image says "dev".
# --strategy recreate, as CI: the old container's sockets must not outlive it (see ci.yml)
cd server && GITHUB_SHA=$(git rev-parse HEAD) uv run --extra deploy modal deploy --strategy recreate modal_app.py
# Try a change without touching production: a separate app name AND a separate game
# store (GAMES_STORE names the modal.Dict; the default is production's). Stop it after.
cd server && GAMES_STORE=3d-chess-games-staging uv run --extra deploy \
  modal deploy modal_app.py --name 3d-chess-backend-staging
cd server && uv run --extra deploy modal app stop 3d-chess-backend-staging -y
```

CI (GitHub Actions) runs the server's lint (ruff check and format) and tests, the client's
lint (ESLint + Prettier check), build and unit tests with coverage, both generated-protocol-type
checks (`messages.py`, `schema.ts` against `schema.json`), and the E2E suite on every push/PR
to `main`; the E2E suite is split over six parallel jobs (`E2E_GROUP`: `games`, `session`,
`framing`, `offers` and `learn`, named in `client/playwright.config.ts` and balanced by
their measured time, and `rest`, every spec they don't name),
and on a failure each job uploads its Playwright HTML report and trace as a workflow
artifact. On a push to `main`, and only once the server, client and every E2E job pass, it
also deploys the backend to Modal. The deploy bakes the
commit SHA into the image as `APP_VERSION`, and the job polls `/health` until it reports
that SHA, so a deploy that never starts serving fails the job rather than passing on the
previous (already healthy) deployment. The production image is built with
`Image.uv_sync` from `server/uv.lock`, so it runs exactly the dependency versions the
tests ran against. Authentication comes from the `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET`
repo secrets. The frontend is deployed separately by Cloudflare Pages' GitHub
integration (configured in Cloudflare, not in this repo); it shows up as the "Cloudflare
Pages" check on pull requests.

Link previews read `client/index.html`'s meta tags (title, description, and `og:image`,
`public/og.jpg`: the README's picture cut to 1.91:1, written by `scripts/readme-image.mjs`
from the same frame). A game's link is an invitation, so the build also writes
`invite.html`, the same page with the invitation's `og:title` and description
(`invitePage` in `vite.config.ts`, which fails the build if a tag it replaces is missing), and
`public/_redirects` has Cloudflare Pages serve it at `/game/*`; every other address gets
`index.html` (Pages' single-page fallback). `og:image` names `https://3dchess.club/og.jpg`,
which only holds what main deployed, so a branch's preview build points it at the
preview's own copy (`socialImageOnPreviews`, from Pages' `CF_PAGES_URL`).
`public/_headers` sets three headers on every address: other sites may not show the app in
a frame, browsers must not guess file types, and a link the player follows sends only the
site's name. The build adds a rule keeping each file it wrote under `/assets/` a year (their
names carry their hash; `keepHashedFiles` in `vite.config.ts`), one rule a file, so a name the
deploy lacks is never kept, and `assets/404.html` makes it a 404; anything else a returning
browser asks for again (Pages' default). The bench's `vite preview` sends the build's headers
(`client/bench/preview.config.ts`), so its returning visit is cached as a player's is, and
serves a game's address the invitation's page, as `public/_redirects` has the host do.

Dependabot (`.github/dependabot.yml`) opens weekly PRs: minor and patch updates grouped, one
per ecosystem (client npm, server uv, GitHub Actions, the actions pinned to commit SHAs),
and each major on its own. Two come apart on purpose: `three` (with `@types/three`), whose
update can move the piece set's golden hashes (`golden.test.ts`; `npm run bake:pieces` if
the shapes change), and `datamodel-code-generator`, pinned exactly, whose update may need
`messages.py` regenerated. `@types/node` majors are ignored: they move with `.nvmrc`.

The client's entry (with its CSS, kept under `ENTRY_GZIP_BUDGET` gzipped in `vite.config.ts`:
the build fails above it, raised only on purpose) holds the start screen, the side choice and the game
screen (the invitation, the HUD, the move record). Everything 3D is a chunk the entry loads
lazily, shared by the start page's preview (`screens/LandingPreview.tsx`), the lobby's
canvas (`screens/lobby/LobbyCanvas.tsx`), the game's board (`screens/GameCanvas.tsx`) and
the tutorial's (`screens/learn/LearnCanvas.tsx`):
three.js, the scene and the set's precomputed parts, about 330 KB (gzip; the benchmark report's "Bundle"). The start page asks for
it at once and shows its title and button without waiting for it; on the side choice
(`/new`, `/computer`), a game's address (`/game/:id`, `/computer/:id`) and the tutorial
(`/learn`) the built page preloads it from the start (a
`modulepreload` added by a small plugin in `vite.config.ts`), so a shared link shows its
invitation without waiting for three.js, and does not wait for the entry before asking
for the scene. Should the chunk fail to load (a dropped connection, a deploy that replaced
it), only the canvas is left out: each is loaded with `lazyChunk` (`src/lib/cachedImport.ts`)
inside a `ChunkBoundary` (`src/components/ChunkBoundary.tsx`), so the start page goes
without its preview, the lobby's pages play on with no scene (`LobbyLayout` ends each of
its moments at once), and the game keeps its HUD and move record with "Couldn't load the
board" and a Retry. The retry asks for the chunk again with a fresh `React.lazy` (which
keeps its first failure for good) and, should that fail too, reloads the page: Chromium
keeps a module that failed to fetch failed for the rest of the page's life, and a
replaced chunk is gone. A browser that gives a canvas no WebGL (turned off, a blocklisted GPU,
no GPU) leaves it out the same way (`ChunkBoundary`'s `canvas`): the start page without its
preview, the lobby without its scene, the tutorial without its board, and the game says
"No 3D board: WebGL is off in this browser", with no Retry and its move box in sight to play by.
In the build, r3f's `Canvas` is handed only the three.js classes the scene
writes as elements (`src/three/r3fCatalogue.ts`) instead of the whole namespace, so the
rest of three.js is left out; a new element's class must be added there
(`r3fCatalogue.test.ts` fails until it is, and the build fails if the swap stops applying).
The e2e suite runs against the dev server, which does neither: to run it against a build,
start `vite preview` on port 5173 (built with `VITE_WS_URL=ws://127.0.0.1:8000/ws`) and the
backend first, and Playwright reuses them.

### Benchmarks

`node bench/run.mjs` runs three tiers one after another and writes its report to
`bench/out/RESULTS.md` (raw JSON beside it; `bench/out/` is ignored: a report is true of one
commit on one machine, and a copy kept in the tree reads as current long after it is not):
**client**, the rules engine, the log-derived game state, the board's pointer and frame
math, the computer's search on fixed work (`client/bench/*.bench.ts`, vitest bench over
seeded games and positions built to be as expensive as the rules allow) and the piece
geometry's cold startup (`client/bench/startup.ts`); **server**, the relay in process and
over real sockets, with store models that mimic `modal.Dict`'s copies and blocking calls
(`server/bench/bench_server.py`, its store models in `bench_app.py`); and **browser**, the
production build end to end in headless Chromium (`client/scripts/bench-browser.mjs`,
software WebGL, so its frame times are only relative; it walks into a game through the UI
the way the e2e suite does, by role and name, so a change to the way into a game must keep
it walking). Cases marked ⚠ are adversarial. Numbers compare only between runs on one
machine; the report records the machine, the commit and each tier's run time. A browser
section that fails is a "failed" row in the report and fails the tier: `run.mjs` says so
in the report and exits 1.

**The primary rows** (`bench/primary.mjs`) are one number for each moment a player waits
on (CLAUDE.md "Performance"): the start page usable and answering its first click, a shared
game's first screen, the first board frame (joining a game, playing the computer), a long
game reopened, a finished game's review (from "Review" to every mark in, its marks checked
the same in every run), a move landing (the player's and the opponent's), a piece selected,
and the computer's search speed (at a fixed time a move, speed is strength). Each runs from the
player's action (a click, a navigation, the opponent's send) to what the player sees,
never from a point in between, which a change can move without the player noticing. The
report and the A/B comparison lead with them; every other row is a diagnostic, saying
where the time goes. In the browser tier each measured page plays against a socket from
the script, never a second page: two pages in one browser share its GPU process and wait
on each other's shader compiles, which players on two devices never do. Moves are clicked
on the board through the app's raycasting, in the opening of a real game with captures by
both sides and a check (`client/bench/tacticalGame.ts`, pinned by its test), and each
landing is watched for jank, shader programs linked (0 once warm) and, over the game, the
renderer's live geometries and textures (a leak shows as growth). The findings at the top
of the report state the numbers and nothing about their cause, which would outlive the code
it described.

To measure a change, run `node bench/run.mjs --primary --base <ref>` (e.g. `--base HEAD`
for uncommitted work, `--base main` for a branch): it checks the base commit out into a
temporary worktree, gives it this checkout's benchmark code, copies this checkout (its
uncommitted files too) into a second one laid out alike, so the two differ only in their
code, and runs the two interleaved (base, head, head, base, ...), judging each change by pairs of runs made next to each
other, so a shared machine speeding up or slowing down over the run cannot pass for a
change. So a check added with a change runs against the base too: a check the base cannot
pass (a throw on the old behaviour) fails the whole comparison. Make it a row that measures
instead (a count, which the base reports as it is), and let the verdict show the difference.
It writes `bench/out/AB.md`, opening with the primary rows, their verdicts and one
speed for them all (the geometric mean of each row's median pair: ×1.004 for identical
code); `--primary` runs only what those rows need (the browser tier's `primary` profile and
the client tier's search bench), about 13 minutes for three pairs on a 4-core VM, where
the client and browser tiers in full took 37. More pairs do not help a row get called: a
call needs every pair to agree and the change to exceed their spread (a count at 0 on a side,
which has no ratio, is judged by the pairs' differences, called when every pair moves the same
way).
Without `--primary` or `--only`, `--base` runs the tiers the diff can move (the server's
code: the server tier; the client's app code: client and browser; nothing: all, an A/A
test). Narrow it further (`--only client --files engine --grep E4`) and a comparison takes
under a minute. Among the diagnostics, a few calls are expected by chance (identical code
had 1–5% of rows called), and the report says how many. A saved run can also be compared
with `--compare <copy of bench/out>`, which is only as good as the machine was steady
between the two runs: every table gains a "vs baseline" column and the report opens with
what got better or worse beyond the noise. Each client case runs in three rounds and starts
from a collected heap; its "Run-to-run" spread is the noise a change must beat to count
(the server and browser tiers get one with `--repeat 3`, at three times their run time;
measured once, they only resolve changes of about 30% on a shared VM). While iterating, run
one tier (`--only client`) or one file or case directly (`npx vitest bench --config
vitest.bench.config.ts bench/engine.bench.ts -t E4`; the server and browser scripts take
`--only <section>`, and the browser script `--profile primary`). The client fixtures'
games are chosen in a fixed move order and fingerprinted, so a faster engine is timed on
exactly the same games, and a change to the rules stops the client tier instead of timing
different work.

## Known limitations (accepted for this project's scope)

- The server doesn't detect checkmate, stalemate or the draws; game-over is decided
  independently by each client, from the final position only. So after an ending on the
  board the server still records a turn-correct move (the app sends none: its board takes
  no input once a game is over), and a move a modified client records after a mate takes
  the result away again on the other board. Only a resignation or an agreed draw, which the
  server records, makes it refuse further moves.
- A rejoin refused with `invalid_game` after the page has already shown the game (it expired
  during a long outage) keeps the stored seat and leaves the board on screen, taking no
  input, with the error in the banner; only a reload resolves it (the stored seat is then
  deleted and the page says "No game here").
- A WebSocket session is bounded by the Modal function timeout (1 hour). The client
  auto-reconnects and rejoins when that (or any drop) severs the socket, so the
  interruption is a brief "Reconnecting…" rather than a frozen game.
- One seat, one live tab. Opening your own game in a second tab of the same browser moves
  the seat to that tab; the first tab is told so and can take it back, but the two never
  play simultaneously.
- Modal's edge rejects binary WebSocket frames before they reach the app; the local
  uvicorn backend answers them with an `invalid_message` error instead. The client only
  ever sends text.
- A frame over 4,096 characters is refused with `invalid_message` before it is parsed (the
  longest a client sends is about 150): validating a wide object against every message
  model held the one event loop for seconds.
- The server records any shape-valid, turn-correct move without checking legality. The
  client replays history defensively — a record it cannot apply, or one that leaves a
  position it cannot evaluate (a captured king), freezes the board at the last good
  position with an explanation instead of crashing — but it cannot repair the record.
- A game is not drawn for want of the material to mate (a bare king against king and rook,
  say): it goes on until the fifty moves run out, or the players agree a draw.
- No clock: a player may take as long as they like, and an opponent who has walked away
  can only be resigned against or waited for.
- A game against the computer lives in the browser that played it: it cannot be opened in
  another browser or device, and clearing site data ends it.
- No spectators: a game has exactly two seats.
