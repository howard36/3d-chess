# Goal: complete the 3D Chess product description

You are working in the `product-description/` directory of the 3D Chess repository. Read `README.md`, `glossary.md`, `foundations/connection-and-seat.md`, and `start/creating-a-game.md` first. The README defines the purpose, the document template, the method, the structure, and the coverage table. The other three are the exemplars: match their depth, tone, and structure exactly. Your job is to keep every document in the README's structure true to the source, until the coverage table has no `not started` rows, then run a consistency pass.

## Source of truth

The 3D Chess source is the parent directory of this one (`client/` and `server/`), at commit `24c650c`. Describe the experience of a player using the web client (`client/src/App.tsx`: the home page at `/`, the side choice at `/new` and `/computer`, a game against a friend at `/game/{id}`, a game against the computer at `/computer/{id}`, and the tutorial at `/learn` and `/learn/{lesson}`) in a desktop browser, against a server built from the same commit. Server operations (deployment, `/health`, logs, CI), modified clients, test hooks and developer pages, and the computer's playing strength are out of scope; see the README's scope decisions.

For each document, read in this order before writing:

1. Where the feature's state lives: the screens in `client/src/screens/` (`StartScreen.tsx` and `LandingPreview.tsx` for the home page; `lobby/ChooseSide.tsx`, `lobby/LobbyCards.tsx` and `lobby/LobbyLayout.tsx` for the side choice, the invitations and the arrival; `GameScreen.tsx` and `GameView.tsx` for the game page; `ComputerGameScreen.tsx` for a game against the computer; `TurnPill.tsx`, `CapturedPieces.tsx`, `MoveCard.tsx`, `MoveAnnouncer.tsx`, `PromotionPicker.tsx`, `EndGameModal.tsx` and `useEndCard.ts` for the HUD and the dialogs; `learn/LearnScreen.tsx` for the tutorial), and the board in `client/src/three/Board.tsx`.
2. The shared pipeline: the connection hook `client/src/hooks/useGameSocket.ts` (states, queueing, retry, reset) and its stand-in for a game against the computer, `client/src/hooks/useComputerGame.ts` with `client/src/game/computerGame.ts`; the log derivations `client/src/game/session.ts` (seat, presence, errors), `client/src/game/history.ts` (the replayed position, turn, last move, captures, frozen record, game over and draws) and `client/src/game/invitation.ts`; the stored seat in `client/src/lib/playerRole.ts` and the stored computer games in `client/src/lib/computerGames.ts`; the tutorial's lessons in `client/src/game/lessons.ts`; and the server handler in `server/modal_app.py` (what it accepts, records, relays, and refuses).
3. The tests. They are close to executable specifications of edge cases. Key files: `client/src/App.test.tsx` and `AppNavigation.test.tsx` (every page and the reactions to messages), the `GameScreen.*.test.tsx` files, `client/src/three/Board.test.tsx` (selection, markers, orientation, animation), `client/src/hooks/useGameSocket.test.ts` (queueing, drops, retry, replaced), `client/src/game/history.test.ts`, `client/src/game/session.test.ts`, `client/src/game/computerGame.test.ts`, `server/tests/test_local_ws.py` (every server answer), and the Playwright specs in `client/e2e/` (real two-player flows, the computer, the tutorial, the HUD's fit).
4. UI behavior: `client/src/three/` (`layout.ts` for orientation, `cameraFit.ts` and `CameraControls.tsx` for the view, `glide.ts`, `moveAnimation.tsx` and `motion.ts` for the moves' motion, `intro/` for the entrance, `lobby/` for the lobby's motion, `scene/` for the marks, the labels and the colors), `client/src/index.css` for the HUD's layout, and the facts under "Things already established" below.
5. Rules and constants: `client/src/engine/` (`board.ts`, `pieces.ts`, `coords.ts`, `draws.ts`), `client/src/game/material.ts`, `client/src/ai/levels.ts`, and `server/schema.json` (message shapes and error codes).

Do not describe code. Describe what the player sees and does. Technical detail goes only in `> Technical note:` block quotes, and only when the mechanism changes what the player would expect.

## Writing rules

- Follow the eight-section template in the README for every feature document. Foundations, game-page panels, and cross-cutting documents may drop sections that do not apply (a panel with no request has no in-flight phase) but must still cover cancel and interrupt behavior wherever an interaction exists.
- Section 3's five subsections are always headed `### Begin`, `### End without sending`, `### Send`, `### While in flight`, and `### The answer arrives`, in that order.
- Modifiers and cancel/interrupt go in tables with the columns used in `start/creating-a-game.md`: modifiers "At the start" and "Changes while in flight"; interrupts "Before sending" and "While in flight". The seven modifier rows and eleven interrupt rows are fixed in the README; copy them in that order and do not add, drop, or reorder them in a single document.
- Section 6 walks the eight concerns in the README's order, one bold-led paragraph each, even when the answer is "no interaction".
- Use the glossary's words. If you need a term the glossary lacks, add it to `glossary.md` in the right section with a one-paragraph definition, then use it.
- Sentence case for all headings. Direct, concrete language. No hedging, no marketing. Quote on-screen text exactly, including its capitalization and whether it ends in "..." or "…".
- State surprising behavior plainly and say why if the reason is in the code or a comment. If it looks like a bug, say so in "Open questions" rather than smoothing it over, and file it in `bug-triage.md`.
- Cross-reference other documents with relative links rather than repeating their content. The foundations own the facts listed below. Do not restate them; link.
- Every document ends with "## Open questions and verification" listing what was read from code but not confirmed by hand, followed by `Drafted against 3D Chess commit \`24c650c\``. The footer becomes `Verified against …` only after a person's pass under [the verification protocol](verification/README.md).
- One Mermaid `stateDiagram-v2` per interaction. Keep it to the states the player passes through; omit internal bookkeeping.

## Things already established (do not re-derive, do not contradict)

Numbers and timings:

- Retry schedule after a drop: 0.5 s, 1 s, 2 s, 4 s, then 8 s between attempts, forever; it starts over when a connection opens. No attempt limit, no manual retry except "Play here" after a replacement.
- The server ends every connection after at most one hour; games idle for about 30 days are deleted.
- A friend game's id is 6 characters from A–Z and 0–9, random, case-sensitive in the address. A computer game's id is 10 lowercase characters, made in the browser.
- The glide is a straight line, a Knight's too, from 360 ms for a short step to 560 ms for the longest; a captured piece is knocked over and burns away as the capturer arrives. A stalled frame counts as at most 33 ms, so a backgrounded tab resumes an animation instead of skipping it.
- The entrance: just under 4 seconds for a game that starts while the page is open, about 3.1 after the lobby, about 1.3 for a page that opens on a game already under way, a 150 ms fade with reduced motion. The board takes no input until it is over.
- At mate the result card appears about 1.3 seconds after the King strikes the glass; at a draw, about 0.6 seconds after the move lands.
- The default view's distance is fitted to the window: the camera stands just far enough back for the whole tower and its labels to be in frame below the turn pill's band, from every height the view can be turned to, on first render and again on every resize, keeping whatever direction the player has turned to and their zoom (as a multiple of the fitted distance). Zoom is limited to between 0.7 and 1.5 times that fitted distance. Orbit goes all the way around horizontally and from directly above the tower to 14° below the horizon, never below the garden's ground. The camera always turns about the tower's center, which stays at one point on screen: there is no pan. The view keeps drifting briefly after a drag is released (damping), then holds still. There is no "reset view" control.
- The starting position has 40 pieces, 20 per side: White's Rooks, Knights and King on rank 1 of level A, its Bishops, Unicorns and Queen on rank 2 of level A, its pawns on ranks 1 and 2 of level B; Black's the mirror on levels E and D. White has 61 legal first moves.
- Material for the captured pieces' lead: Queen 10, Knight 3, Bishop 3, Rook 2.5, Unicorn 1.5, pawn 1.

Input:

- The board acts on the release of a press, never on pointer down: the primary mouse button, a finger, or a pen, released within 6 pixels of where it went down, over the same piece or cell. A pointer that moves further is a drag and only turns the view; the right and middle buttons, the wheel, and a second finger never select, clear, or play a move.
- The first piece or legal destination along the line from the camera through the pointer takes the press; nothing behind it sees it. A piece in front of a destination therefore blocks it. A destination takes a press only on its marked circle (or, for a capture, on the piece). An empty cell that is not a destination, or a press that reaches nothing, clears the selection. On a touch screen, tap assist sends a near miss to the nearest own selectable piece or legal destination within about 22 pixels.
- Pressing a piece that cannot be picked up now (the opponent's, where it is not a capture, or any piece while it is not the player's turn) makes it shake its head and keeps the selection. Pressing the selected piece puts it down. Pressing another of the player's own selectable pieces moves the selection to it.
- The turn pill, the captured pieces, the reconnecting line, and the frozen-board banner let presses and drags through to the board; "How to play", the move card (while shown), the error banner's "✕", "Retry" and "Play again" do not. The promotion dialog, the result card, and the replaced dialog cover the whole window, block the board completely, and make everything behind them unreachable by keyboard and assistive technology (inert).
- The 3D board cannot be operated from the keyboard, but a move can be typed in the move box ("Bb1-Cb1", "=Q" to promote), the first Tab stop on the board screen, and is played exactly as pressing its piece and destination would. On the opponent's turn, and after the game is over, the box answers "Wait for their move." Escape is handled in the promotion dialog (cancel), on the result card (close), and in the move box (hide). Each dialog puts keyboard focus on its first button when it opens: "Queen", "Play again", "Play here".
- There is no pan. Shift, Ctrl, or Cmd with a left drag does nothing to the view, and with a right drag orbits. They change nothing about what a press does to the board.
- The browser's context menu never opens over the board.

The connection and the seat:

- The connection opens as soon as the app loads, on any page. Connection states are connecting, connected, reconnecting, and replaced. The home page and the tutorial never use it; a game against the computer never uses it (its stand-in is always "connected" and answers at once).
- A create, join, or rejoin made while the connection is not open is queued and sent when it opens. A create or join whose connection drops before its answer is re-sent on each new connection until answered; the server hands a repeated join from the same tab (client id) the seat it already claimed. A move is never queued: the board does not take input while disconnected, and any move still pending when a new connection opens is dropped.
- On a new connection the board does not take input until that connection's create, join, or rejoin has been answered, so no move is ever made against the snapshot from before a drop.
- A move appears on either board only when its echo, or a snapshot containing it, arrives. The mover's own board holds (takes no input) from sending until the answer arrives or the connection drops; a drop frees it because the move was either recorded (and arrives in the next snapshot) or lost.
- Every new connection with a stored seat, and without a seat already given on that connection, sends one rejoin automatically. The answer is a snapshot of the whole record. Last connection wins for a page's rejoins until one is answered, and after "Play here" (take over); an automatic rejoin after a drop, once the page has held the seat, does not take the seat from another tab's live connection and is refused with *seat in use*, which shows the replaced dialog.
- The stored seat is written when the server assigns a seat and deleted only when a rejoin is refused ("No such seat to rejoin" or "Cannot rejoin") before any snapshot has arrived and before the game has started on this page.
- Leaving a game's page against a friend by any route, arriving at the home page, or going straight from one game's page to another's through history, resets the connection (if anything has been sent or received on it): the old game is forgotten on this page, the opponent sees the player "Offline" on their turn pill, and the stored seat is kept.
- The server records any move that is well formed and made in turn, without checking legality, and relays it to whichever players are connected. It never decides that a game is over.
- Presence is not shown until the first presence message arrives; after that the latest one about the opponent wins. A connection replaced by the same player's new connection never reports the player offline. The turn pill dims while the connection is down.

The game page:

- Before the game starts, the game page is the lobby: a stored seat shows "Returning to your game…" until the rejoin is answered, then the invitation to send (the host) or the board; no stored seat shows the invitation to the free seat ("Join game", or the card "No game here" or "This game is taken"). The arrival plays when the guest takes the seat, then the board screen's entrance.
- The board, and therefore the view, mounts only once the game has started. Nothing can be selected or turned before both seats are taken.
- Only the latest server error is shown: in the error banner on the game page, as red text in the side choice's bottom line. Dismissing hides every error so far; a later error shows again. The invitation's refusals are said by its own card, not the banner.
- Game over is decided by each browser from the record: checkmate, stalemate, threefold repetition, or the fifty-move rule. The result card covers the board, can be closed (its close button, Escape, or a click outside it), and offers "Play again", which goes to the side choice of the same kind (`/new` or `/computer`); once it is closed, "Play again" stands below the tower. The board itself is not closed when the game ends (bug-triage B-25).
- A game against the computer is kept in this browser's storage and comes back from it on a reload or return, with no server and no wait.

Established by the verification passes (scripted, against `d94507b` and `c571311`; see verification/README.md). These were observed on the build of that time and have not been rerun at `24c650c`:

- Animations advance at most 33 ms per drawn frame, so below 30 frames per second the glide and the capture last longer (about 1.5 s at 9 frames per second). Under a reduced-motion preference they do not play at all.
- The promotion dialog opens with "Queen" focused, because it opens on the release of the press rather than during it: Escape cancels and Enter picks the Queen straight away.

Naming decisions:

- "The board takes input" (not "enabled"), "held" for the player's own move in flight, "frozen" only for a move record this browser cannot replay.
- "Seat" for the server's assignment, "stored seat" for this browser's memory of it, "color" for white or black as a property of a seat or piece.
- "Press" on the board, "click" on HTML controls.
- "Home page" for `/`, "side choice" for `/new` and `/computer`, "invitation to send" and "invitation to the free seat" for the two lobby pages of a game not yet started, "result card" for the end-of-game dialog, "turn pill" and "move card" for the HUD's parts.
- The code's "role" is written "stored seat"; its "phase waiting" is "before joining"; its "boardDisabled" is "the board does not take input"; its "replayFailedAt" is "frozen".

Ownership of the playing states (the `play/` documents must agree on these hand-offs):

- [making a move](play/making-a-move.md) owns: nothing selected on your turn, a piece selected, pressing a destination, your move in flight (held), and your echo arriving. It links to the view for how the landing looks.
- [promotion](play/promotion.md) owns: the promotion dialog, from pressing a promotion square to picking or cancelling. Once a piece is picked, the move is in flight as in making a move.
- [the opponent's move](play/the-opponents-move.md) owns: the opponent's turn as you see it (nothing of yours selectable), the opponent's move in flight on their side, and its echo landing on your board, up to your turn beginning.
- [check and the end of the game](play/check-and-game-end.md) owns: a king in check, the four endings, the result card, and "Play again".
- [playing the computer](computer/playing-the-computer.md) owns: the difficulty, the computer's arrival, its thinking and its moves, and what a game kept in the browser does differently.
- [the tutorial](learn/the-tutorial.md) owns: the lessons, their steps, and the lesson board.
- [the view](foundations/the-view.md) owns: the look of the board; the entrance; orbit and zoom; orientation; the labels; every marker and animation, and when an arriving move animates or does not.
- [the input model](foundations/input-model.md) owns: what a press does, what takes it, and when the board takes input.

## Order of work

1. `foundations/` first, in this order: `game-rules.md`, `input-model.md`, `connection-and-seat.md`, `screens-and-navigation.md`, `the-view.md`. Everything else links to them.
2. `play/` next, all four documents. This is the hardest part and the bulk of the experience. Read `Board.tsx`, `GameScreen.tsx`, `GameView.tsx`, `history.ts`, and `PromotionPicker.tsx` in full before starting any of them, because the states hand off to each other and the documents must agree on where one ends and the next begins (see the ownership list above).
3. The remaining `start/`, `computer/`, `learn/`, `game-page/`, `session/`, and `cross-cutting/` documents. These are independent of each other and can be drafted in parallel with subagents once the foundations and `play/` documents exist to link to. If you parallelize, give each subagent this prompt, the exemplars, and the specific document to write; then review every result yourself for consistency with the glossary and the established facts above before accepting it.
4. Consistency pass over the whole set: same term for the same thing everywhere, no two documents describing the same behavior differently, every relative link resolves, every document has its footer, every glossary term used is defined.
5. Update the coverage table in `README.md` as you go: `drafted` when written, never `verified` (verification by hand is a separate pass).

## Working rules

- Commit after each document or coherent group of documents with a message of the form `docs: add product-description/{path}` or `docs: revise product-description/{path}`, following the repository's Conventional Commits convention. End each commit message with the co-author and session trailers the environment specifies.
- Do not modify anything in `client/` or `server/` or the repository's root files. They are read-only reference material.
- Do not add files outside the README's structure without updating the structure and coverage table to match.
- When a behavior cannot be determined from code and tests, write down what you could determine, put the rest in "Open questions", and move on. Do not guess and do not block.
- Depth bar: `start/creating-a-game.md` is under 200 lines of long paragraphs for a small request. The `play/` documents will be longer; game-page panels will often be shorter. Completeness matters more than length. Every phase, every modifier row, every interrupt row must be accounted for, even if the answer is "No effect."
- If you find that the README's structure is wrong for something you discover (a document that should be split, two that should merge), make the change, update the structure and coverage table, and note why in the commit message.
- When the source moves on, refresh rather than mix: bring every document to the new commit, change every footer, and say in the README's coverage section what changed.

You are done when the coverage table has no `not started` rows, the consistency pass is complete, and everything is committed.
