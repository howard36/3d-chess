# Goal: complete the 3D Chess product description

You are working in the `product-description/` directory of the 3D Chess repository. Read `README.md`, `glossary.md`, `foundations/connection-and-seat.md`, and `start/creating-a-game.md` first. The README defines the purpose, the document template, the method, the structure, and the coverage table. The other three are the exemplars: match their depth, tone, and structure exactly. Your job is to write every document in the README's structure until the coverage table has no `not started` rows, then run a consistency pass.

## Source of truth

The 3D Chess source is the parent directory of this one (`client/` and `server/`), at commit `4e18386`. Describe the experience of a player using the web client (`client/src/App.tsx`: the start screen at `/` and the game page at `/game/{id}`) in a desktop browser, with the default settings and nothing customized, against a server built from the same commit. Server operations (deployment, `/health`, logs, CI), modified clients, and test hooks are out of scope; see the README's scope decisions.

For each document, read in this order before writing:

1. Where the feature's state lives: the screen in `client/src/screens/` (`StartScreen.tsx`, `GameScreen.tsx`, `PromotionPicker.tsx`, `EndGameModal.tsx`, `MoveList.tsx`), and the board in `client/src/three/Board.tsx`.
2. The shared pipeline: the connection hook `client/src/hooks/useGameSocket.ts` (states, queueing, retry, reset), the log derivations `client/src/game/session.ts` (seat, presence, errors) and `client/src/game/history.ts` (the replayed position, turn, last move, frozen record, game over), the stored seat in `client/src/lib/playerRole.ts`, and the server handler in `server/modal_app.py` (what it accepts, records, relays, and refuses).
3. The tests. They are close to executable specifications of edge cases. Key files: `client/src/App.test.tsx` (every screen and the game page's reactions to messages), `client/src/three/Board.test.tsx` (selection, markers, orientation, animation), `client/src/hooks/useGameSocket.test.ts` (queueing, drops, retry, replaced), `client/src/game/history.test.ts`, `client/src/game/session.test.ts`, `server/tests/test_local_ws.py` (every server answer), and the Playwright specs in `client/e2e/` (real two-player flows: reload, second tab, presence, promotion, checkmate).
4. UI behavior: `client/src/three/` (`layout.ts` for orientation, `theme.ts` for colors, `motion.ts` and `moveAnimation.tsx` for the glide and fade, `TurnIndicator.tsx`), and the 3D library defaults noted under "Things already established" below.
5. Rules and constants: `client/src/engine/` (`board.ts`, `pieces.ts`, `coords.ts`) and `server/schema.json` (message shapes and error codes).

Do not describe code. Describe what the player sees and does. Technical detail goes only in `> Technical note:` block quotes, and only when the mechanism changes what the player would expect.

## Writing rules

- Follow the eight-section template in the README for every feature document. Foundations, game-page panels, and cross-cutting documents may drop sections that do not apply (a panel with no request has no in-flight phase) but must still cover cancel and interrupt behavior wherever an interaction exists.
- Section 3's five subsections are always headed `### Begin`, `### End without sending`, `### Send`, `### While in flight`, and `### The answer arrives`, in that order.
- Modifiers and cancel/interrupt go in tables with the columns used in `start/creating-a-game.md`: modifiers "At the start" and "Changes while in flight"; interrupts "Before sending" and "While in flight". The seven modifier rows and eleven interrupt rows are fixed in the README; copy them in that order and do not add, drop, or reorder them in a single document.
- Section 6 walks the eight concerns in the README's order, one bold-led paragraph each, even when the answer is "no interaction".
- Use the glossary's words. If you need a term the glossary lacks, add it to `glossary.md` in the right section with a one-paragraph definition, then use it.
- Sentence case for all headings. Direct, concrete language. No hedging, no marketing. Quote on-screen text exactly, including its capitalization and whether it ends in "..." or "…".
- State surprising behavior plainly and say why if the reason is in the code or a comment. If it looks like a bug, say so in "Open questions" rather than smoothing it over.
- Cross-reference other documents with relative links rather than repeating their content. The foundations own the facts listed below. Do not restate them; link.
- Every document ends with "## Open questions and verification" listing what was read from code but not confirmed by hand, followed by `Verified against 3D Chess commit \`4e18386\``.
- One Mermaid `stateDiagram-v2` per interaction. Keep it to the states the player passes through; omit internal bookkeeping.

## Things already established (do not re-derive, do not contradict)

Numbers and timings:

- Retry schedule after a drop: 0.5 s, 1 s, 2 s, 4 s, then 8 s between attempts, forever; it starts over when a connection opens. No attempt limit, no manual retry except "Play here" after a replacement.
- The server ends every connection after at most one hour; games idle for about 30 days are deleted.
- Game ids are 6 characters from A–Z and 0–9, random, case-sensitive in the address.
- Glide and fade last 300 ms each, eased in and out; the glide lifts the piece by a fifth of the distance between neighboring cells at its midpoint. A stalled frame counts as at most 33 ms, so a backgrounded tab resumes an animation instead of skipping it.
- The default view's distance is fitted to the window: the camera stands just far enough back for all eight corners of the lattice to be in frame (with an 8% margin), on first render and again on every resize, keeping whatever direction the player has turned to. Zoom is limited to between 6 units and the larger of 25 and 1.5 times that fitted distance from the point the camera orbits; the board spans about 5.4 units. Orbit goes all the way around horizontally and from directly above to directly below the board, stopping at those two poles. The view keeps drifting briefly after a drag is released (damping).
- The move list is at most 40% of the window's height or 320 pixels, whichever is less, and scrolls itself to the newest move whenever a move is added.
- The starting position has 40 pieces, 20 per side, and White has 61 legal first moves.

Input:

- The board acts on the release of a press, never on pointer down: the primary mouse button, a finger, or a pen, released within 6 pixels of where it went down, over the same piece or cell. A pointer that moves further is a drag and only turns the view; the right and middle buttons, the wheel, and a second finger never select, clear, or play a move.
- The first piece or legal destination along the line from the camera through the pointer takes the press; nothing behind it sees it. A piece in front of a destination therefore blocks it. An empty, non-destination cell the line passes through before that point clears the selection. A press that passes through the board and reaches no piece and no destination clears the selection; a press that misses the board entirely does nothing.
- Pressing a piece that cannot be selected (the opponent's, or any piece when it is not your turn) clears the current selection, because its own cell is in front of it on the line. Pressing your own selectable piece while another is selected moves the selection to it.
- The seat label, turn indicator, reconnecting banner, and frozen-board banner let presses and drags through to the board; the move box, move list, and error banner do not. The promotion dialog, end-game dialog, and replaced dialog cover the whole window, block the board completely, and make everything behind them unreachable by keyboard and assistive technology (inert).
- The 3D board cannot be operated from the keyboard, but a move can be typed in the move box ("Ab2-Ab3", "=Q" to promote) and is played exactly as pressing its piece and destination would. The only other keyboard input the app handles itself is Escape in the promotion dialog. Each dialog puts keyboard focus on its first button when it opens.
- Shift, Ctrl, or Cmd with a left drag pans instead of orbiting, and with a right drag orbits instead of panning. They change nothing about what a press does to the board.
- The browser's context menu never opens over the board.

The connection and the seat:

- The connection opens as soon as the app loads, on either screen. Connection states are connecting, connected, reconnecting, and replaced.
- A create, join, or rejoin made while the connection is not open is queued and sent when it opens. A create or join whose connection drops before its answer is re-sent on each new connection until answered; the server hands a repeated join from the same tab (client id) the seat it already claimed. A move is never queued: the board does not take input while disconnected, and any move still pending when a new connection opens is dropped.
- On a new connection the board does not take input until that connection's create, join, or rejoin has been answered, so no move is ever made against the snapshot from before a drop.
- A move appears on either board only when its echo, or a snapshot containing it, arrives. The mover's own board holds (takes no input) from sending until the answer arrives or the connection drops; a drop frees it because the move was either recorded (and arrives in the next snapshot) or lost.
- Every new connection with a stored seat, and without a seat already given on that connection, sends one rejoin automatically. The answer is a snapshot of the whole record. Last connection wins for a page's rejoins until one is answered, and after "Play here" (take over); an automatic rejoin after a drop, once the page has held the seat, does not take the seat from another tab's live connection and is refused with *seat in use*, which shows the replaced dialog.
- The stored seat is written when the server assigns a seat and deleted only when a rejoin is refused ("No such seat to rejoin" or "Cannot rejoin") before any snapshot has arrived and before the game has started on this page.
- Returning to the start screen by any route, or going straight from one game's page to another's through history, resets the connection (if anything has been sent or received on it): the old game is forgotten on this page, the opponent sees "Opponent: offline", and the stored seat is kept.
- The server records any move that is well formed and made in turn, without checking legality, and relays it to whichever players are connected. It never decides that a game is over.
- Presence is not shown until the first presence message arrives; after that the latest one about the opponent wins. A connection replaced by the same player's new connection never reports the player offline.

The game page:

- Phase is derived from the server's messages on this page: playing once the game has started (a start notice or a snapshot saying started), joined after "Join Game" is clicked or the seat is confirmed, otherwise before joining. Before joining, a stored seat shows the share-link screen and no stored seat shows the join screen.
- The board, and therefore the view, mounts only in the playing phase. Nothing can be selected or looked at before both seats are taken.
- Only the latest server error is shown, as the error banner on the game page and as red text on the start screen. Dismissing hides every error so far; a later error shows again.
- Game over is decided by each browser from the record. The end-game dialog covers the board and offers only "Start new game", which goes to the start screen.

Established by the verification passes (scripted; see verification/README.md):

- Animations advance at most 33 ms per drawn frame, so below 30 frames per second the 300 ms glide and fade last longer (about 1.5 s at 9 frames per second). Under a reduced-motion preference they do not play at all.
- The promotion dialog opens with "Queen" focused, because it opens on the release of the press rather than during it: Escape cancels and Enter picks the Queen straight away.
- Two clicks on a destination with no pause between them both send the move; the copy is refused with "Not your turn" (bug-triage B-14). With a 100 ms pause only one is sent.
- The dialogs' buttons render as plain words (no border or background) and their headings as body-size text.

Naming decisions:

- "The board takes input" (not "enabled"), "held" for the player's own move in flight, "frozen" only for a move record this browser cannot replay.
- "Seat" for the server's assignment, "stored seat" for this browser's memory of it, "color" for white or black as a property of a seat or piece.
- "Press" on the board, "click" on HTML controls.
- The code's "role" is written "stored seat"; its "phase waiting" is "before joining"; its "boardDisabled" is "the board does not take input"; its "replayFailedAt" is "frozen".

Ownership of the playing states (the `play/` documents must agree on these hand-offs):

- [making a move](play/making-a-move.md) owns: nothing selected on your turn, a piece selected, pressing a destination, your move in flight (held), and your echo arriving. It links to the view for how the landing looks.
- [promotion](play/promotion.md) owns: the promotion dialog, from pressing a promotion square to picking or cancelling. Once a piece is picked, the move is in flight as in making a move.
- [the opponent's move](play/the-opponents-move.md) owns: the opponent's turn as you see it (nothing of yours selectable), the opponent's move in flight on their side, and its echo landing on your board, up to your turn beginning.
- [check and the end of the game](play/check-and-game-end.md) owns: a king in check, checkmate and stalemate, the end-game dialog, and "Start new game".
- [the view](foundations/the-view.md) owns: orbit, zoom, and pan; orientation; every marker, fill, glow, and animation, and when an arriving move animates or does not.
- [the input model](foundations/input-model.md) owns: what a press does, what takes it, and when the board takes input.

## Order of work

1. `foundations/` first, in this order: `game-rules.md`, `input-model.md`, `connection-and-seat.md`, `screens-and-navigation.md`, `the-view.md`. Everything else links to them.
2. `play/` next, all four documents. This is the hardest part and the bulk of the experience. Read `Board.tsx`, `GameScreen.tsx`, `history.ts`, and `PromotionPicker.tsx` in full before starting any of them, because the states hand off to each other and the documents must agree on where one ends and the next begins (see the ownership list above).
3. The remaining `start/`, `game-page/`, `session/`, and `cross-cutting/` documents. These are independent of each other and can be drafted in parallel with subagents once the foundations and `play/` documents exist to link to. If you parallelize, give each subagent this prompt, the exemplars, and the specific document to write; then review every result yourself for consistency with the glossary and the established facts above before accepting it.
4. Consistency pass over the whole set: same term for the same thing everywhere, no two documents describing the same behavior differently, every relative link resolves, every document has a verification footer, every glossary term used is defined.
5. Update the coverage table in `README.md` as you go: `drafted` when written, never `verified` (verification by hand is a separate pass).

## Working rules

- Commit after each document or coherent group of documents with a message of the form `docs: add product-description/{path}` or `docs: revise product-description/{path}`, following the repository's Conventional Commits convention. End each commit message with the co-author and session trailers the environment specifies.
- Do not modify anything in `client/` or `server/` or the repository's root files. They are read-only reference material.
- Do not add files outside the README's structure without updating the structure and coverage table to match.
- When a behavior cannot be determined from code and tests, write down what you could determine, put the rest in "Open questions", and move on. Do not guess and do not block.
- Depth bar: `start/creating-a-game.md` is roughly 140 lines of long paragraphs for a small request. The `play/` documents will be longer; game-page panels will often be shorter. Completeness matters more than length. Every phase, every modifier row, every interrupt row must be accounted for, even if the answer is "No effect."
- If you find that the README's structure is wrong for something you discover (a document that should be split, two that should merge), make the change, update the structure and coverage table, and note why in the commit message.

You are done when the coverage table has no `not started` rows, the consistency pass is complete, and everything is committed.
