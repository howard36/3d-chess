# Bug triage

A consolidated list of the defects and inconsistencies that the feature documents raised in their "Open questions and verification" sections and in their bodies. B-01 to B-23 were read from the 3D Chess source and tests at commit `d94507b`, and their **Why** lines keep the file:line references of that commit; the 19 that were reproduced, in whole or in part, by the [first, scripted verification pass](verification/README.md#results-so-far) carry a **Status** line naming the checklist items. Every entry still open, or fixed since, has an **At `24c650c`** line that says where it stands at the commit the documents now describe, with references into that commit. B-24 and B-25 were found at `24c650c`. Entries changed by the work merged after it carry an **At `b325641`** line as well: `939b9b4` (#97) fixed B-13 and B-15, and `b325641` (#98) fixed B-25 and narrowed B-20; `8f30691` (#85) narrowed B-21. The list exists so the product team can decide, item by item, whether to fix, to document as intended, or to leave.

## Summary

The documents raised about 60 questions; after merging by root cause, 23 entries remained at `d94507b`, and the refresh for `24c650c` added two. Three entries were **high**, all fixed on 2026-09-26: a press on the board acted on pointer-down, so turning the view could play a move (B-01); a move made just after reconnecting could be recorded against a stale position and freeze the game (B-02); and a join whose answer was lost stranded the joiner (B-03). B-01 to B-10 were fixed then (B-10 as a side effect), and their entries carry a **Fix** line; the two product calls among them were decided as described there (B-06: the tab the player chose keeps the seat; B-09: dialogs, live regions, reduced motion and typed moves, not keyboard navigation of the 3D board).

**At `24c650c`**, the redesign (the home page, the lobby, the glass tower, the turn pill and the result card) and later fixes have closed four more (B-12, B-14, B-19, B-22, the last but for a "reset view" control) and narrowed five (B-16, B-18, B-20, B-21, B-23). Still open: B-11, B-13, B-15, B-17, and the rest of the partly fixed ones. Two are new: a drawn game can be played on from the board once its result card is closed (B-25, **medium**: ordinary presses undo a finished game's result for both players), and two tabs on one game against the computer overwrite each other's stored game (B-24). Only B-25 was checked in the running app at `24c650c` (confirmed by a scripted run); the others say what they were read from.

**At `b325641`**, the documents' current commit, three more are fixed: B-13 (unknown addresses now show "Nothing here" with "Home"), B-15 (the error banner judges each refusal by its own request, and an answer that moves the game on ends it), and B-25 (the board takes no input once a game is over). B-20 is narrowed further by resigning and draw offers, and B-21 by the tab's title and icon on the player's move. Still open: B-11, B-17, B-24, and the remainder of B-16, B-18, B-20, B-21, B-22 and B-23.

| ID | Title | Severity | Area | Decision needed | Status at `b325641` |
| --- | --- | --- | --- | --- | --- |
| B-01 | A press on the board acts on pointer-down, so turning the view can play a move or drop the selection | high | play | fix | fixed |
| B-02 | A move pressed just after reconnecting is recorded against a stale position and can freeze the game | high | session | fix | fixed |
| B-03 | A join whose answer is lost strands the joiner and loses the seat for good | high | start | fix | fixed |
| B-04 | A create whose answer is lost leaves "Creating Game..." stuck until reload | medium | start | fix | fixed |
| B-05 | Jumping between two game pages through browser history shows the old game under the new address | medium | session | fix | fixed |
| B-06 | A tab that was reconnecting takes the seat back from the newer tab without a click | medium | session | product call | fixed |
| B-07 | The promotion dialog loses keyboard focus to the press that opens it | medium | play | fix | fixed |
| B-08 | The default view crops the board, badly on phones, and the HUD collides in narrow windows | medium | view | fix | fixed |
| B-09 | The game cannot be played without a pointer, and dialogs and cues are not accessible | medium | cross-cutting | product call | fixed |
| B-25 | A drawn game can be played on from the board once its result card is closed | medium | play | fix | fixed (b325641) |
| B-10 | Back then Forward before the start screen's connection opens shows "Error: Already in a game" | low | session | fix | fixed |
| B-11 | With browser storage disabled, the creator lands on the join screen and a reload loses the seat | low | start | fix | open |
| B-12 | Returning players see "Game created! Share this link with a friend:" while their rejoin is in flight | low | session | fix | fixed |
| B-13 | Unknown addresses render an empty dark page | low | navigation | fix | fixed (939b9b4) |
| B-14 | A very fast double press on a destination sends the move twice and shows "Not your turn" | low | play | fix | fixed |
| B-15 | Old errors keep acting: success never clears the banner, and earlier refusals steer later joins | low | game page | fix | fixed (939b9b4) |
| B-16 | The presence line goes stale while the player is disconnected | low | game page | product call | partly fixed |
| B-17 | The retry schedule starts over on every successful open, so a fault on each rejoin retries every 0.5 s | low | session | fix | open |
| B-18 | The frozen-board handling misleads: wrong wording, a wrong count, and a King capture offered | low | cross-cutting | fix | partly fixed |
| B-19 | Small copy and rendering slips | low | cross-cutting | fix | fixed or no longer applicable |
| B-20 | The end of a game offers nothing but leaving: no review, no rematch, no resignation, no abandonment | low | play | product call | partly fixed |
| B-21 | Nothing signals the player's turn, an opponent joining, or a move in flight | low | cross-cutting | product call | partly fixed |
| B-22 | The board has no coordinate labels, so the move list cannot be matched to cells | low | view | product call | fixed, except a "reset view" control |
| B-23 | Nothing identifies a seat but this browser's storage | low | cross-cutting | product call | partly fixed |
| B-24 | Two tabs on one game against the computer overwrite each other's stored game | low | computer | fix | open |

## High

### B-01: A press on the board acts on pointer-down, so turning the view can play a move or drop the selection

- **Where the user meets it:** Turning the view to look at the board, the most common thing a player does. They drag, right-drag, or pinch starting over the cube.
- **What happens / what was expected:** The board acts on the press itself, before anyone can tell whether it is a click or the start of a drag, and for every mouse button and every finger. A drag that starts on a highlighted destination plays that move and turns the view. A drag that starts anywhere else in the cube clears the selection. A right press (pan) or middle press (zoom) selects and moves like a left one, and a second finger landing for a pinch is a press of its own. Expected: a drag turns the view and nothing else; only a click (press and release without movement, primary button) selects or moves.
- **Reproduce:** New game, White. Press the pawn on `Ab2`. Press on `Ab3`'s dot and drag 200 px left. The view turns and `Ab2–Ab3` is played. Or: select the Queen `Bc1`, then drag starting over an empty cell in the middle of the cube; the view turns and the selection is gone.
- **Why (from the code, at `d94507b`):** `client/src/three/Board.tsx:223-228` (the board group clears the selection on `onPointerDown`), `:268-275` (a destination cell plays the move on `onPointerDown`), and `:179-182` with `:328` (pieces select on `onPointerDown`). The camera controls (`client/src/screens/GameScreen.tsx:350`) listen to the same pointer, independently. Neither filters by button or pointer count.
- **Severity:** `high`. An irreversible move is played by a gesture meant only to look, and with a Queen or Rook selected, destinations cover much of the board.
- **Decision needed:** `fix`. Resolve presses on click (the 3D library's click event already ignores presses that moved more than a couple of pixels), and only for the primary button and the first pointer.
- **Raised by:** [the input model](foundations/input-model.md#open-questions-and-verification), [making a move](play/making-a-move.md#open-questions-and-verification), [the view](foundations/the-view.md#begin), [screen sizes and touch](cross-cutting/screen-sizes-and-touch.md#open-questions-and-verification).
- **Status:** confirmed 2026-09-25 by the scripted pass: INPUT-02 (a drag from a destination played the move), INPUT-03 (a drag from an empty cell cleared the selection), INPUT-05 and MOVE-08 (right and middle presses select and move).
- **Fix:** fixed 2026-09-26. The board acts on click, only for the primary button and only when the pointer was released within 6 px of the press (`client/src/three/tap.ts`, used by every handler in `Board.tsx`); a drag, right-drag, middle-drag or pinch only turns the view. On rerun, INPUT-02, INPUT-03, INPUT-05 and MOVE-08 no longer reproduce.

### B-02: A move pressed just after reconnecting is recorded against a stale position and can freeze the game

- **Where the user meets it:** Right after the connection comes back from a drop, or right after "Play here" in a replaced tab.
- **What happens / what was expected:** The board takes input again as soon as the new connection opens, one round trip before the rejoin's snapshot arrives. For that moment it shows the position from before the drop, which after a drop can be two moves old (the player's own move recorded but its echo lost, plus the opponent's reply) and after a replacement any number of moves old. A move pressed then is sent, and the server records it if the turn matches, without checking legality. If the move's piece is no longer where the stale board showed it, neither browser can replay the record, and both boards freeze permanently under the frozen-board banner. Expected: the board takes no input until the snapshot has arrived.
- **Reproduce:** Needs the window held open. The harness does it: White plays `Bb2-Bb3` and the echo is lost to a drop; Black replies `Ed4-Ed3`; White's connection returns with its answers held back for 5 s; on the stale board White plays `Bb2-Bb3` again. Both boards then show "Move 3 in this game's history is not a legal move for this client…" and the game is over for good.
- **Why (from the code, at `d94507b`):** `client/src/screens/GameScreen.tsx:72-81`: whether the board takes input depends on the connection state and the player's own move in flight, not on whether this connection's rejoin has been answered (the rejoin is sent at `:95-101`). `server/modal_app.py:160-178` records any in-turn move. `client/src/game/history.ts:115-127` stops replay at the first move it cannot apply.
- **Severity:** `high`. It destroys the game for both players, and the banner blames "an app version mismatch".
- **Decision needed:** `fix`. Treat the board as not taking input until `hasSessionSince(messages, sessionStartIndex)` holds for a page with a stored seat, which is the same check the page already uses to decide whether to rejoin.
- **Raised by:** [connection loss](session/connection-loss.md#open-questions-and-verification), [a second tab](session/second-tab.md#open-questions-and-verification), [making a move](play/making-a-move.md#edge-cases), [the broken game record](cross-cutting/broken-game-record.md#open-questions-and-verification), [the turn indicator](game-page/turn-indicator.md#edge-cases), [the connection and seat model](foundations/connection-and-seat.md#open-questions-and-verification).
- **Status:** confirmed 2026-09-25 by the scripted pass: DROP-02 (both boards froze at move 3).
- **Fix:** fixed 2026-09-26. The board, the move box and the move send all wait until the current connection's create, join or rejoin has been answered (`hasSessionSince(messages, sessionStartIndex)` in `GameScreen.tsx`).

### B-03: A join whose answer is lost strands the joiner and loses the seat for good

- **Where the user meets it:** Clicking "Join Game" on a share link while the network is flaky, or reloading or leaving in the fraction of a second after the click.
- **What happens / what was expected:** The page shows "Joined game, waiting for start..." from the click. If the connection drops after the join is sent but before the seat confirmation arrives, the page stays on that screen forever, even after reconnecting: it has no stored seat to rejoin with, and nothing re-sends the join. The server has meanwhile taken the seat: the creator's board appears and shows the joiner offline. After a reload the joiner gets the join screen, and "Join Game" is refused with "Game full". Nobody can ever sit in that seat again, so the game can never be played. Expected: the page recovers the seat (retry the join, or have the server remember the joining connection's claim) or at least reports the failure.
- **Reproduce:** Harness: open a new game's link in a second context, click "Join Game" and close the socket in the same instant, let it reconnect, wait 10 s. The joined screen stays up and the creator shows the board. Reload and click "Join Game": "Error: Game full".
- **Why (from the code, at `d94507b`):** `client/src/screens/GameScreen.tsx:116-124` leaves the joined screen only on "Cannot join" or "Game full"; `:95-101` rejoins only with a stored seat; `:105-111` stores the seat only on the seat confirmation; `client/src/hooks/useGameSocket.ts:73-81` never re-sends a request that was already sent. `server/modal_app.py:318-331` claims the seat before answering.
- **Severity:** `high`. It leaves the user in a state they cannot get out of, and the game is lost for both players.
- **Decision needed:** `fix`. For example, re-send the join on the next connection when the page is in the joined phase without a confirmed seat (a repeated join is harmless if the server treats a join from the same browser as a rejoin), or include the chosen color in the join so the joiner can rejoin.
- **Raised by:** [joining a game](start/joining-a-game.md#open-questions-and-verification), [connection loss](session/connection-loss.md#open-questions-and-verification), [the connection and seat model](foundations/connection-and-seat.md#requests-while-disconnected).
- **Status:** confirmed 2026-09-25 by the scripted pass: JOIN-05.
- **Fix:** fixed 2026-09-26. Every tab sends a random `clientId` (per tab, kept in `sessionStorage`) with `join_game`; the server records which client claimed each seat and answers a repeated join from that client with its own seat instead of "Game full". The page re-sends an unanswered join on each new connection (`useResendOnReconnect`), and a reload followed by "Join Game" also gets the seat back.
- **Follow-up:** fixed again 2026-09-26 (by `c571311`): a repeated join is now answered with the seat confirmation and a snapshot of the whole record, not a second start notice, so a joiner whose first answer was lost sees the moves made in the meantime. Checked by JOIN-10 and CONN-18 in the second pass.
- **Status:** partly back at `1928567` (read from code, JOIN-18 unverified). The re-send on the next connection still recovers the seat. But a tab reloaded after a lost answer now opens the invitation to the free seat, which asks which seats are taken, sees both, and says "This game is taken" with no way to join, so the reload-then-join recovery is gone. See [joining a game](start/joining-a-game.md#open-questions-and-verification).

## Medium

### B-04: A create whose answer is lost leaves "Creating Game..." stuck until reload

- **Where the user meets it:** Clicking "Start New Game" as the connection drops.
- **What happens / what was expected:** The button stays at "Creating Game...", disabled, for good; the status line comes and goes; nothing re-sends the request. If the server received it, an orphan game with one seat exists. Expected: the request is retried, or the button is re-enabled when the connection returns.
- **Reproduce:** Click "Start New Game" and cut the connection in the same instant (harness: `clickThenCut`). Let it reconnect. The button stays disabled.
- **Why (from the code, at `d94507b`):** `client/src/screens/StartScreen.tsx:28`: loading ends only on the game id or an error arriving; nothing watches the connection.
- **Severity:** `medium`. A reload recovers.
- **Decision needed:** `fix`. Re-enable the button (or re-send) when a new connection opens with the request unanswered.
- **Raised by:** [creating a game](start/creating-a-game.md#open-questions-and-verification), [connection loss](session/connection-loss.md#open-questions-and-verification).
- **Status:** confirmed 2026-09-25 by the scripted pass: CREATE-03.
- **Fix:** fixed 2026-09-26. An unanswered `create_game` is re-sent on the next connection (`useResendOnReconnect` in `StartScreen.tsx`); the worst case is an unused game on the server.

### B-05: Jumping between two game pages through browser history shows the old game under the new address

- **Where the user meets it:** Using the browser's history menu (a long press or right-click on Back or Forward) to go from one game page straight to another without passing through the start screen.
- **What happens / what was expected:** The address changes but the page keeps the previous game's connection and everything the server said about it; no rejoin is sent. In the pass, jumping from a new game's page back to a finished game showed the new game's share-link screen with the finished game's link, instead of the finished game's result. Moves made on such a page go to the other game. Expected: a change of game id resets the page and rejoins, as arriving at the start screen does.
- **Reproduce:** Finish a game, click "Start new game", then "Start New Game". From the new game's page, jump two entries back in history (`history.go(-2)` in the console does the same).
- **Why (from the code, at `d94507b`):** `client/src/App.tsx:18-20` resets the connection only on arrival at `/`; `client/src/screens/GameScreen.tsx:46-50` re-reads the stored seat on an id change but keeps the message log; `:98` then finds a seat on the current connection and does not rejoin.
- **Severity:** `medium`. Wrong but recoverable by reload; uncommon path.
- **Decision needed:** `fix`. Reset the connection whenever the game id in the address changes, not only on `/`.
- **Raised by:** [reloading and returning](session/reload-and-return.md#open-questions-and-verification), [the broken game record](cross-cutting/broken-game-record.md#open-questions-and-verification).
- **Status:** confirmed 2026-09-25 by the scripted pass: RELOAD-03.
- **Fix:** fixed 2026-09-26. `App.tsx` resets the socket session whenever the game id in the address changes (not only on `/`), in a layout effect so the old game is never painted, and mounts a fresh game screen per game id.
- **Follow-up:** fixed again 2026-09-26: the new game's page is only mounted once the connection has been reset for it, so it can no longer read (and store) the previous game's seat. Checked by RELOAD-05 in the second pass, and by `client/src/AppNavigation.test.tsx`.

### B-06: A tab that was reconnecting takes the seat back from the newer tab without a click

- **Where the user meets it:** With the game open in two tabs of one browser, when the first tab's connection was down at the moment the second took the seat (an outage, a sleeping laptop, or a click on "Play here" while the other tab is reconnecting).
- **What happens / what was expected:** The replaced signal cannot reach a dead connection, so the first tab never learns it was replaced. When its retry succeeds it rejoins and takes the seat back, and the tab the player is actually using suddenly shows "This game is open in another tab". It happens once, not in a loop. Expected, arguably: the tab the player chose keeps the seat.
- **Reproduce:** Drop tab 1's connection and hold it; open the game in tab 2; release tab 1. Tab 2 shows the replaced dialog.
- **Why (from the code, at `d94507b`):** `client/src/hooks/useGameSocket.ts:147-157` retries every close except 4001; `client/src/screens/GameScreen.tsx:95-101` rejoins on every new connection. Related: `server/modal_app.py:348-379` moves the seat first and closes the older connection only after three sends, so the older tab can still act on the seat for a moment.
- **Severity:** `medium`. Surprising and disruptive, but recoverable with one click.
- **Decision needed:** `product call`. Either keep last-connection-wins (and document it), or let a reconnecting page learn that its seat moved (for example a rejoin that does not take a seat held by a live connection unless the user asks).
- **Raised by:** [a second tab](session/second-tab.md#open-questions-and-verification), [connection loss](session/connection-loss.md#edge-cases).
- **Status:** confirmed 2026-09-25 by the scripted pass: TAB-02.
- **Fix:** fixed 2026-09-26, deciding that the tab the player chose keeps the seat. `rejoin_game` gained `takeover`: page loads and "Play here" send `true` (last connection wins, as before); an automatic reconnect sends `false`, and the server refuses it with the new error `seat_in_use` if another client's live connection holds the seat. That tab then shows "This game is open in another tab" with "Play here". Its own half-open socket (same client id) is still replaced.
- **Follow-up:** 2026-09-26: a page now takes the seat over until one of its rejoins is answered (not merely sent), so a fresh page whose first answer is lost still takes the seat (RELOAD-06).

### B-07: The promotion dialog loses keyboard focus to the press that opens it

- **Where the user meets it:** Promoting a pawn and reaching for the keyboard (Escape to cancel, Enter for a Queen).
- **What happens / what was expected:** The dialog focuses "Queen" as it appears, but it appears during the pointer-down of the press on the promotion square, and the browser's default handling of that same press then moves focus to the page. The dialog opens with nothing focused: Escape and Enter do nothing until the player presses Tab. Expected: "Queen" focused, Escape cancels, Enter promotes.
- **Reproduce:** Play `Ba2-Ba3`, `Ee4-Ee3`, `Ba3-Ca3`, `Ee3-Ee2`, `Ca3-Da4`, `Ee2-Ee1`; select `Da4`, press `Ea5`; press Escape. The dialog stays.
- **Why (from the code, at `d94507b`):** `client/src/screens/PromotionPicker.tsx:16-19` focuses in an effect that runs during the opening pointer-down; the dialog is opened from the board's `onPointerDown` (`client/src/three/Board.tsx:196-197`).
- **Severity:** `medium`. The intended keyboard behavior never works, and an Escape-to-cancel expectation fails silently. Fixing B-01 (acting on click) would largely fix this too.
- **Decision needed:** `fix`. Open the dialog on click, or focus after the pointer sequence ends.
- **Raised by:** [promotion](play/promotion.md#open-questions-and-verification), [accessibility](cross-cutting/accessibility.md#open-questions-and-verification).
- **Status:** confirmed 2026-09-25 by the scripted pass: PROMO-02, PROMO-04, PROMO-08 (the first draft of the promotion document claimed the opposite and was corrected).
- **Fix:** fixed 2026-09-26 by the B-01 fix: the dialog now opens on the click, after the browser's focus handling for the press, so "Queen" keeps focus and Escape and Enter work. On rerun, PROMO-02, PROMO-04 and PROMO-08 no longer reproduce.

### B-08: The default view crops the board, badly on phones, and the HUD collides in narrow windows

- **Where the user meets it:** Every game's first sight of the board; any narrow window or phone.
- **What happens / what was expected:** The camera's position and vertical field of view are fixed, so the board's size follows the window's height. In a 1280 × 720 window the nearest bottom edge of the cube, the player's own back rank, runs off the bottom. On an upright 375 × 667 phone both sides are cut off (the centers of `Aa1`, `Aa5`, and `Ee5` fall outside the window). In the same window the seat label covers the left of the turn indicator, the turn indicator wraps to two lines, and the share link runs off both edges of a page that cannot scroll. Expected: the whole board framed at any window shape; HUD panels that never overlap; a share link that wraps or can be copied.
- **Reproduce:** Open a started game in a 375 × 667 window; open a new game's share-link screen in the same window.
- **Why (from the code, at `d94507b`):** `client/src/screens/GameScreen.tsx:321` (fixed camera), `:285` (`100vh`), `:289-299` and `client/src/three/TurnIndicator.tsx:7-21` (fixed HUD positions), `:388` (the link in large unbreakable text), `client/src/main.tsx:10` (`overflow-hidden` on the body).
- **Severity:** `medium`. Phones are barely usable without pinching out, and the player's own pieces are hidden at the start.
- **Decision needed:** `fix`. Fit the camera distance to the cube and the window's aspect; let the HUD wrap or stack; make the share link breakable, or give it a copy button.
- **Raised by:** [the view](foundations/the-view.md#open-questions-and-verification), [screen sizes and touch](cross-cutting/screen-sizes-and-touch.md#open-questions-and-verification), [seat and opponent status](game-page/seat-and-opponent-status.md#open-questions-and-verification), [the turn indicator](game-page/turn-indicator.md#open-questions-and-verification), [waiting for an opponent](start/waiting-for-an-opponent.md#open-questions-and-verification).
- **Status:** confirmed 2026-09-25 by the scripted pass: VIEW-01 (screenshot), SIZE-01, SIZE-02, SEAT-03, TURN-02.
- **Fix:** fixed 2026-09-26. The camera's distance is fitted to the cube and the window's aspect ratio on load and on every resize, keeping the current direction (`client/src/three/cameraFit.ts`). The HUD is two responsive grids (top: seat, turn, connection; bottom: move box, error, move list) that stack in narrow windows, the page uses `100dvh`, and the share link wraps anywhere and has a "Copy link" button.

### B-09: The game cannot be played without a pointer, and dialogs and cues are not accessible

- **Where the user meets it:** A keyboard-only or screen-reader user; a user who relies on reduced motion or cannot tell colors apart.
- **What happens / what was expected:** The board cannot be navigated, selected, or moved from the keyboard, and the canvas has no text alternative; the position exists for assistive technology only as the move list. The end-game dialog has no dialog role and takes no focus. The replaced dialog takes no focus and does not make the page behind it inert, so Tab reaches "Start new game" under it. Check, selection, destinations, and the last move are distinguished only by color. Animations ignore the reduced-motion preference. Turn and presence changes are not announced.
- **Reproduce:** Tab and arrow keys on the board screen do nothing; inspect the end-game dialog's role; set reduced motion and play a move.
- **Why (from the code, at `d94507b`):** `client/src/three/Board.tsx:152-204` (pointer events only), `client/src/screens/EndGameModal.tsx:20-51` (no role, no focus), `client/src/screens/GameScreen.tsx:217-256` (replaced dialog), `client/src/three/theme.ts` (color-only cues; since deleted, the board's colors now live in `client/src/three/scene/palette.ts`), `client/src/three/motion.ts` (no reduced-motion check), `client/src/three/TurnIndicator.tsx:23-27` (no live region).
- **Severity:** `medium`. The game is closed to some users, but the product's scope is a hobby game among friends.
- **Decision needed:** `product call`. Decide the accessibility bar; the dialog roles, focus handling, live regions, and reduced motion are cheap fixes whatever the bar.
- **Raised by:** [accessibility](cross-cutting/accessibility.md#open-questions-and-verification), [a second tab](session/second-tab.md#open-questions-and-verification), [check and the end of the game](play/check-and-game-end.md#open-questions-and-verification).
- **Status:** confirmed 2026-09-25 by the scripted pass: A11Y-01, A11Y-02, A11Y-03, TAB-04.
- **Fix:** fixed 2026-09-26 at the level the entry calls cheap, plus play from the keyboard. A move box under the board takes typed moves (`Ab2-Ab3`, `=Q` to promote) with spoken errors. The end-game and replaced dialogs have dialog roles, take focus, and make the page behind them `inert`, as the promotion dialog does. The turn indicator and presence line are live regions, check is said in words ("— in check"), the canvas has a text label, and move animations are skipped under reduced motion. Still open: navigating the 3D board itself by keyboard, and color-only cues for the last move (the move list states it in text).

### B-25: A drawn game can be played on from the board once its result card is closed

- **Where the user meets it:** A game drawn by repetition or the fifty-move rule. The player whose turn the final position gives closes the result card to look at the position, and presses a piece to see its moves.
- **What happens / what was expected:** The board still takes presses after the game has ended. After checkmate or stalemate that changes nothing, because the side to move has no legal move. After a draw by repetition or the fifty-move rule the side to move still has moves: a piece rises with its destinations, a press on one sends the move, the server records it, and both boards play it. The new position is usually no longer drawn, so the result leaves both turn pills and the game carries on, as if the draw had never happened. Against the computer, the computer answers. The move box, by contrast, refuses ("Wait for their move."). Expected: a finished game takes no moves, from the board or anywhere else.
- **Reproduce:** New game against a friend. Play the repetition line `Ab1-Aa3`, `Eb5-Ea3`, `Aa3-Ab1`, `Ea3-Eb5`, twice (a draw on the eighth move). On White's page close the result card, press `Bb1`, then `Cb1` (END-13).
- **Why (from the code, at `24c650c`):** `client/src/screens/GameView.tsx:207`: the board's `disabled` is the input rule and the entrance only, not the game's end. `client/src/three/Board.tsx:238`: `canPick` does not look at the end either. `client/src/screens/GameScreen.tsx:237`: `handleMove` sends without checking. `server/modal_app.py`, `record_move`: the server checks turn parity only, by design. `client/src/game/computerGame.ts:103-114`: the computer's stand-in accepts a move without checking `isOver` (the move box's own check is `yourTurn`, which is false once the game is over, `client/src/screens/GameView.tsx:250-251`).
- **Severity:** `medium`. Two ordinary presses, the natural way to look at a piece's moves, undo a finished game's result for both players.
- **Decision needed:** `fix`. Close the board once the game is over (as the move box already is), and have the computer's stand-in refuse moves after the end.
- **Raised by:** [making a move](play/making-a-move.md#edge-cases), [check and the end of the game](play/check-and-game-end.md#edge-cases), [the broken game record](cross-cutting/broken-game-record.md#open-questions-and-verification), [the glossary](glossary.md#selection-and-board-state).
- **Status:** confirmed 2026-10-09 at `24c650c` by a scripted run (END-13): after the repetition line and Escape on the result card, White pressed `Bb1` and `Cb1`; the move landed on both pages, both pills dropped the result, and Black played on. The move box answered "Wait for their move." to the same move (ERR-05).
- **At `b325641`:** fixed by `b325641` (#98): the board takes no input once the game is over, by any ending (`boardDisabled`, `client/src/screens/GameScreen.tsx:170-175`). The computer's stand-in still accepts a move after an ending on the board (`client/src/game/computerGame.ts`, `answer`), but the page no longer sends one. Read from code; END-13 not rerun.

## Low

### B-10: Back then Forward before the start screen's connection opens shows "Error: Already in a game"

- **Where the user meets it:** Going Back to the start screen and Forward again quickly, or during an outage; "Start new game" followed at once by Back.
- **What happens / what was expected:** The game page sends its rejoin twice on the new connection; the second is refused and "Error: Already in a game" sits in the banner over an otherwise normal page. Expected: one rejoin, no error.
- **Reproduce:** On a share-link screen, hold the connection down, press Back, press Forward, release.
- **Why (from the code, at `d94507b`):** `client/src/hooks/useGameSocket.ts:89-98`: a reset does not change the session number, which changes only when a connection opens (`:115`); `client/src/screens/GameScreen.tsx:95-101` queues a rejoin against the old number and sends another on the new one; `server/modal_app.py:260-262` refuses the second.
- **Severity:** `low`. Cosmetic; the seat is unaffected.
- **Decision needed:** `fix`. Bump the session number on reset, or do not queue a rejoin.
- **Raised by:** [waiting for an opponent](start/waiting-for-an-opponent.md#open-questions-and-verification), [reloading and returning](session/reload-and-return.md#open-questions-and-verification), [connection loss](session/connection-loss.md#open-questions-and-verification), [error messages](cross-cutting/error-messages.md).
- **Status:** confirmed 2026-09-25 by the scripted pass: WAIT-06.
- **Status:** fixed 2026-09-26 as a side effect of the B-05 and B-06 work: a reset now clears the connection's session, and a rejoin is only sent on an open connection, so Back then Forward sends exactly one. The second pass checked both paths (WAIT-06, WAIT-12, NAV-10); no "Already in a game" appears.

### B-11: With browser storage disabled, the creator lands on the join screen and a reload loses the seat

- **Where the user meets it:** Creating a game in a browser that refuses site storage.
- **What happens / what was expected:** The create succeeds, but the game page reads the seat only from storage, so it shows the creator the join screen; "Join Game" there shows "Joined game, waiting for start..." with "Error: Already in a game". A drop before the game starts, or any reload, loses the seat. Expected: the page uses the seat it was just given.
- **Reproduce:** Make storage throw (the harness overrides it), click "Start a game".
- **Why (from the code, at `d94507b`):** `client/src/screens/GameScreen.tsx:33-35` and `:46-50` read the seat from storage only; `client/src/game/session.ts:35-49` does not count the creation answer as an assigned seat.
- **Severity:** `low`. Rare configuration.
- **Decision needed:** `fix`. Carry the creator's seat into the game page in memory (the connection already holds it).
- **Raised by:** [creating a game](start/creating-a-game.md#open-questions-and-verification), [waiting for an opponent](start/waiting-for-an-opponent.md#edge-cases), [connection loss](session/connection-loss.md#edge-cases).
- **Status:** confirmed 2026-09-25 by the scripted pass: CREATE-06.
- **Status:** still present at `1928567` in a new form (read from code, CREATE-28 unverified): the side choice stores the seat, the game page finds none, and invites the creator to the other seat of their own game; "Join game" is refused with "Already in a game".
- **At `24c650c`:** still open, in the form described at `1928567`. The game page still reads the seat only from storage (`client/src/screens/GameScreen.tsx:65`, `storedRole`; `:349`, a page without one counts as a guest), so a creator whose browser refuses storage is invited to the other seat of their own game, and "Join game" is refused with "Already in a game", leaving "Joining…" up. Read from code; CREATE-28 at `24c650c` unverified.

### B-12: Returning players see "Game created! Share this link with a friend:" while their rejoin is in flight

- **Where the user meets it:** Reloading or reopening any game, as the joiner or during a game in progress; for as long as an outage lasts.
- **What happens / what was expected:** Before the snapshot arrives, a page with a stored seat shows the creator's waiting screen, telling a joiner in the middle of a game to share a link. Normally a flash; during an outage it stays up with "Reconnecting…". Expected: a neutral "Rejoining…" until the snapshot says what to show.
- **Reproduce:** Stop the server; reload the joiner's page of a started game.
- **Why (from the code, at `d94507b`):** `client/src/screens/GameScreen.tsx:141-145` and `:385-392`: the before-joining phase with a stored seat always shows the share-link screen.
- **Severity:** `low`. Copy.
- **Decision needed:** `fix`. Show a separate rejoining state until the first snapshot.
- **Raised by:** [the connection and seat model](foundations/connection-and-seat.md#open-questions-and-verification), [reloading and returning](session/reload-and-return.md#while-in-flight), [waiting for an opponent](start/waiting-for-an-opponent.md#edge-cases), [joining a game](start/joining-a-game.md#edge-cases).
- **Status:** confirmed 2026-09-25 by the scripted pass: CONN-09.
- **Status:** still present at `4e18386` (CONN-09, second pass).
- **Status:** resolved at `1928567` (read from code, not re-run): a page with a stored seat shows "Returning to your game…", with no lobby, until its rejoin is answered.
- **At `24c650c`:** fixed. A page with a stored seat shows only "Returning to your game…" until its rejoin is answered (`client/src/screens/GameScreen.tsx:543`). Read from code; CONN-09 at `24c650c` unverified.

### B-13: Unknown addresses render an empty dark page

- **Where the user meets it:** A mistyped address such as `/games` or `/game/`.
- **What happens / what was expected:** A dark page with no text and no link. Expected: a not-found message with a link to the start screen.
- **Reproduce:** Open `/games`.
- **Why (from the code, at `d94507b`):** `client/src/App.tsx:24-27`: no catch-all route.
- **Severity:** `low`.
- **Decision needed:** `fix`. Add a catch-all route.
- **Raised by:** [screens and navigation](foundations/screens-and-navigation.md#open-questions-and-verification).
- **Status:** confirmed 2026-09-25 by the scripted pass: NAV-02.
- **At `24c650c`:** still open. `client/src/App.tsx:89-104` lists `/`, `/learn/:lesson?`, `/new`, `/game/:gameId`, `/computer` and `/computer/:gameId`, and nothing else: any other address is still an empty dark page with no link home. Read from code; NAV-02 at `24c650c` unverified.
- **At `b325641`:** fixed by `939b9b4` (#97): a catch-all route (`client/src/App.tsx:106`) shows `client/src/screens/NotFound.tsx`, the lobby's card with "Nothing here" and a focused "Home" button. Read from code and `client/src/AppNavigation.test.tsx`; NAV-02 not run.

### B-14: A very fast double press on a destination sends the move twice and shows "Not your turn"

- **Where the user meets it:** Double-clicking a destination very quickly (within about 20 ms in the pass; ordinary double-clicks at 50 ms and more sent one move).
- **What happens / what was expected:** The hold that stops a second move takes effect only after the page re-renders; a second press before that sends the move again, and the server refuses the copy with "Error: Not your turn". The game is unaffected. Expected: one move, no error.
- **Reproduce:** Harness: press a destination twice with no pause.
- **Why (from the code, at `d94507b`):** `client/src/screens/GameScreen.tsx:150-155` and `client/src/three/Board.tsx:189-204` read the hold and the selection from the last render.
- **Severity:** `low`.
- **Decision needed:** `fix`. Keep a synchronous "move sent" flag in a ref. Fixing B-01 (acting on click) narrows it further.
- **Raised by:** [making a move](play/making-a-move.md#open-questions-and-verification), [error messages](cross-cutting/error-messages.md).
- **Status:** confirmed 2026-09-25 by the scripted pass: MOVE-07 (the first draft claimed one move; corrected).
- **Status:** still present at `4e18386`: two clicks with no pause both send the move, and the second is refused with "Not your turn" (MOVE-07, second pass). Acting on release makes it harder to do by accident.
- **At `24c650c`:** fixed. The board puts the piece down the moment the move is sent (`held`, `client/src/three/Board.tsx:150-155`) and the page marks the move in flight before its next render (`moveInFlight`, `client/src/screens/GameScreen.tsx:148-151`), so a second press, however fast, sends nothing; `client/src/screens/GameScreen.moveGuard.test.tsx` covers it. Read from code; MOVE-07 at `24c650c` unverified.

### B-15: Old errors keep acting: success never clears the banner, and earlier refusals steer later joins

- **Where the user meets it:** After any refusal on the game page.
- **What happens / what was expected:** The error banner stays until "✕", however many requests succeed after it, so it can describe a problem long over. The page's checks look at every error it has ever received, including dismissed ones: after "Cannot rejoin", a click on "Join Game" returns to the join screen before its own answer, so the joined screen never shows; a second "Join Game" after "Game full" does the same. An error the start screen received and cleared can reappear on the next game page. Expected: a request's success or failure is judged by its own answer, and a success clears the banner.
- **Reproduce:** Let a stored seat go stale (restart the local server), open the game, click "Join Game": no joined screen, "Error: Cannot join".
- **Why (from the code, at `d94507b`):** `client/src/screens/GameScreen.tsx:113` (the banner shows the latest error until dismissed), `:116-124` and `:128-139` (`errors.some` over the whole log), `:61` (errors from the whole log, including the start screen's).
- **Severity:** `low`.
- **Decision needed:** `fix`. Judge each request by the messages after it, as the start screen already does, and hide the banner when the next request succeeds.
- **Raised by:** [the error banner](game-page/error-banner.md#open-questions-and-verification), [joining a game](start/joining-a-game.md#open-questions-and-verification), [reloading and returning](session/reload-and-return.md#open-questions-and-verification), [the broken game record](cross-cutting/broken-game-record.md#open-questions-and-verification).
- **Status:** confirmed 2026-09-25 by the scripted pass: RELOAD-02 (no joined screen after "Cannot rejoin"), BANNER-02 (the banner survived two moves).
- **At `24c650c`:** still open, in today's words. The banner still shows the latest error until "✕" (`client/src/screens/GameScreen.tsx:200`, `latestError`), whatever succeeds after it. The failed-join and stale-seat reactions still read every error since the page was opened or reset (`:207`, `:221`, `errors.some`), as does the invitation (`client/src/game/invitation.ts`): once a page has been told "Cannot join" or "Game full", its card says "No game here" or "This game is taken" for as long as it is open. Read from code.
- **At `b325641`:** fixed by `939b9b4` (#97). The banner shows the refusal that still stands (`selectStandingError`, `client/src/game/session.ts:90`): the latest error since the page opened, unless a later answer (a move landing, a game created, a seat taken, the game starting, a snapshot, the invitation's answer) has overtaken it; "✕" dismisses that one error. The failed-join and stale-seat reactions read only their own request's answers (`refusedSince`, `:107`), and the side choice's errors no longer reach the game's page. The same change fixed a seat lost on reload when a stale rejoin's refusal was read after the page had joined. Still as before: the invitation's card (`client/src/game/invitation.ts`) reads every refusal in the log, harmlessly. Read from code and `client/src/screens/GameScreen.errors.test.tsx`; BANNER rows not run.

### B-16: The presence line goes stale while the player is disconnected

- **Where the user meets it:** During "Reconnecting…", or behind the replaced dialog.
- **What happens / what was expected:** The opponent stays shown online (no "Offline") although nothing can update it; the opponent may have left. After a rejoin while waiting, the board can open showing "Offline" for an instant before the join's own report. Expected: the line hidden or marked unknown while disconnected.
- **Reproduce:** Hold White's connection down; close Black's page; White still shows Black online (no "Offline").
- **Why (from the code, at `d94507b`):** `client/src/game/session.ts:57-64` reads the latest report in the whole log; `client/src/screens/GameScreen.tsx:301-308` shows it in every connection state.
- **Severity:** `low`.
- **Decision needed:** `product call`.
- **Raised by:** [seat and opponent status](game-page/seat-and-opponent-status.md#open-questions-and-verification), [the connection and seat model](foundations/connection-and-seat.md#open-questions-and-verification).
- **Status:** confirmed 2026-09-25 by the scripted pass: CONN-10.
- **At `24c650c`:** partly fixed. The turn pill and the captured pieces dim while the connection is down (`client/src/screens/GameView.tsx:235`, `stale={reconnecting}`), which says that what they show may be out of date; but the pill still shows the last presence report (`client/src/game/session.ts:57-61`), and nothing marks it stale behind the replaced dialog. Read from code.
- **At `b325641`:** unchanged (`client/src/screens/GameView.tsx:249`).

### B-17: The retry schedule starts over on every successful open, so a fault on each rejoin retries every 0.5 s

- **Where the user meets it:** A server that accepts connections but fails while handling this player's rejoin (for example while its storage is failing).
- **What happens / what was expected:** Each attempt opens, rejoins, and is closed with an internal error; since the schedule resets on open, the page retries every half second indefinitely, "Reconnecting…" flickers, and the opponent's presence line flaps. Expected: the backoff keeps growing until the page is back in its game.
- **Reproduce:** Needs a faulty server; read from code.
- **Why (from the code, at `d94507b`):** `client/src/hooks/useGameSocket.ts:110` resets the attempt count on open; `server/modal_app.py:409-418` closes on an unexpected error.
- **Severity:** `low`.
- **Decision needed:** `fix`. Reset the count when the rejoin is answered, not when the socket opens.
- **Raised by:** [connection loss](session/connection-loss.md#open-questions-and-verification).
- **At `24c650c`:** still open: `client/src/hooks/useGameSocket.ts:119-121` resets the attempt count when a connection opens. Read from code.
- **At `b325641`:** unchanged (`client/src/hooks/useGameSocket.ts:130`).

### B-18: The frozen-board handling misleads: wrong wording, a wrong count, and a King capture offered

- **Where the user meets it:** A game whose record holds a move this browser cannot replay (B-02 in the real app, or a modified or version-skewed client).
- **What happens / what was expected:** The banner says the move "is not a legal move for this client (likely an app version mismatch)", but replay checks only whether a move can be applied, not legality, and the likeliest cause at this commit is B-02. Its move number counts single moves, while the move list numbers pairs. If an opponent's illegal move leaves their King attacked, the honest player is offered the King capture, and playing it freezes the board with the banner blaming the honest player's move. A move recorded after checkmate removes the end-game dialog. Expected: accurate wording and a count that matches the list; no King captures offered.
- **Reproduce:** Harness: send a move from an empty cell (FROZEN-01); send an illegal but applicable Knight move (FROZEN-02, not flagged).
- **Why (from the code, at `d94507b`):** `client/src/screens/GameScreen.tsx:277-278` (wording), `client/src/screens/MoveList.tsx:30-31` (pair numbering), `client/src/engine/board.ts:264-280` (legal moves do not exclude King captures), `client/src/game/history.ts:118-121` and `:131`.
- **Severity:** `low`. Reachable in the honest app only through B-02.
- **Decision needed:** `fix`. Reword the banner; number it like the list; exclude King captures from legal moves.
- **Raised by:** [the broken game record](cross-cutting/broken-game-record.md#open-questions-and-verification), [the move list](game-page/move-list.md#edge-cases).
- **Status:** banner text, freeze, and the unflagged illegal move confirmed 2026-09-25 by the scripted pass: FROZEN-01, FROZEN-02, FROZEN-03.
- **At `24c650c`:** partly fixed. The banner now reads "Move {N} of this game can't be replayed by this version of the app. The board stays at the position before it." (`client/src/screens/GameScreen.tsx:337-341`), so it no longer calls the move illegal, and its likeliest cause in the honest app, B-02, is fixed. Still open: N counts single moves, while the move list (now in the page for screen readers only) numbers pairs (`client/src/screens/MoveCard.tsx:45`); the engine's legal moves still include capturing a King left in check (`client/src/engine/board.ts:367`), which the replay then freezes on (`client/src/game/history.ts:154-177`); and a move recorded after the end still takes the result away, which the app itself now allows after a draw (B-25). Read from code; FROZEN rows at `24c650c` unverified.
- **At `b325641`:** the banner's text is at `client/src/screens/GameScreen.tsx:375`. A move recorded after the end can no longer come from the app itself after a draw (B-25 fixed); the rest is unchanged.

### B-19: Small copy and rendering slips

- **Where the user meets it:** Throughout.
- **What happens / what was expected:**
  - The move list's two spaces between a row's moves collapse to one, so the columns do not line up (`client/src/screens/MoveList.tsx:60`; confirmed LIST-02).
  - Dialog buttons ("Queen" … "Unicorn", "Cancel", "Start new game", "Play here") and dialog headings render as plain words and body-size text, because the base styles strip button borders and heading sizes (seen in the pass's screenshots).
  - "You are playing as white." names the color in lower case with a period; the turn indicator says "White to move" (`client/src/screens/GameScreen.tsx:300`).
  - "Creating Game..." and "Joined game, waiting for start..." use three dots; "Connecting to server…" and "Reconnecting…" use an ellipsis. "Start New Game" and "Start new game" differ in capitalization. (The landing page, after `4e18386`, changed the start screen's side of both: its button reads "Start a game" and, while in flight, "Creating game…" with an ellipsis. "Joined game, waiting for start..." still uses three dots.)
  - "Error: Cannot rejoin" is all an expired game says; a player cannot tell the game is gone.
  - The error banner's "✕" is a target of about 16 × 24 px with no hand pointer.
  - Behind the end-game dialog the turn indicator still names the mated side "to move".
- **Severity:** `low`.
- **Decision needed:** `fix`.
- **Raised by:** [the move list](game-page/move-list.md#open-questions-and-verification), [promotion](play/promotion.md#begin), [seat and opponent status](game-page/seat-and-opponent-status.md#edge-cases), [error messages](cross-cutting/error-messages.md), [the error banner](game-page/error-banner.md#open-questions-and-verification), [check and the end of the game](play/check-and-game-end.md#edge-cases).
- **Status:** the list spacing (LIST-02) and the plain-word buttons (screenshots) confirmed 2026-09-25 by the scripted pass.
- **At `24c650c`:** fixed or no longer applicable. The move list is no longer drawn (it is in the page for screen readers only); the dialogs are styled glass cards with real buttons and headings; the seat label is gone (the pill shows the player's stone and "You"); the waiting texts use an ellipsis ("Joining…", "Returning to your game…", "Connecting to server…"); an expired game says "No game here" with "Play a friend" (whether it should say that the game expired is an open question in [reloading and returning](session/reload-and-return.md#open-questions-and-verification)); the banner's "✕" is 28 × 28 px; and once the game ends the pill gives the result, not the side to move. Read from code.

### B-20: The end of a game offers nothing but leaving: no review, no rematch, no resignation, no abandonment

- **Where the user meets it:** At checkmate or stalemate, and in a game the opponent has left.
- **What happens / what was expected:** The end-game dialog cannot be dismissed, so the final position and the move list cannot be studied. "Start new game" goes to the start screen; there is no rematch with the same opponent. There is no resignation, draw offer, or clock, so an opponent who leaves for good stalls the game until it expires.
- **Severity:** `low`.
- **Decision needed:** `product call`. Each is a feature decision; the dismissible dialog is the cheapest.
- **Raised by:** [check and the end of the game](play/check-and-game-end.md#open-questions-and-verification), [the opponent's move](play/the-opponents-move.md#open-questions-and-verification), [the rules](foundations/game-rules.md#open-questions-and-verification).
- **Status:** unchanged at `1928567`, except that "Start new game" now leads to the side choice at `/new`.
- **At `24c650c`:** partly addressed. The result card can be closed (its close button, Escape, or a click outside it) to study the final position, with "Play again" waiting below the tower; "Play again" leads to the side choice of the same kind, `/new` or `/computer` (`client/src/screens/EndGameModal.tsx`). There is still no rematch with the same opponent, no resignation or draw offer, no clock, and no way to step through the moves on screen, so an opponent who leaves for good still stalls the game until it expires. Read from code.
- **At `b325641`:** narrowed further by `b325641` (#98): a player can now resign at any moment or offer a draw, which the opponent accepts or declines, through the game menu at the top right ([resigning and draws](play/resigning-and-draws.md)); against the computer, which never offers, a draw is accepted only when it stands clearly worse. Still missing: a rematch with the same opponent, a clock, a way to claim a game from an opponent who has left for good (the player can only resign or wait), and stepping through the moves on screen.

### B-21: Nothing signals the player's turn, an opponent joining, or a move in flight

- **Where the user meets it:** Waiting in another tab for the opponent to join or move; playing on a slow connection.
- **What happens / what was expected:** The tab title never changes, and there is no sound or notification, so a creator in another tab does not know the game has started, and a player does not know it is their turn. While a move is in flight, nothing shows it; on a slow connection the board simply ignores presses.
- **Severity:** `low`.
- **Decision needed:** `product call`.
- **Raised by:** [the opponent's move](play/the-opponents-move.md#open-questions-and-verification), [waiting for an opponent](start/waiting-for-an-opponent.md#open-questions-and-verification), [screens and navigation](foundations/screens-and-navigation.md#open-questions-and-verification), [making a move](play/making-a-move.md#open-questions-and-verification).
- **Status:** partly addressed at `1928567` (read from code, WAIT-18 unverified): a host whose tab is in the background when the guest arrives sees the title "● Opponent joined · 3D Chess", and the arrival waits for them. The player's turn and a move in flight are still not signalled.
- **At `24c650c`:** partly addressed, as at `1928567`: a host whose tab is in the background when the guest arrives sees the title "● Opponent joined · 3D Chess" (`client/src/screens/GameScreen.tsx:385-393`), and the arrival waits for them. Nothing yet signals the player's turn to a tab in the background. A move in flight shows only as the piece left lifted over its origin until the move lands ([making a move](play/making-a-move.md#while-in-flight)). Read from code; WAIT-18 at `24c650c` unverified.
- **At `b325641`:** narrowed further by `8f30691` (#85): while it is the player's move in a game under way, the tab's title reads "● Your move · 3D Chess" and its icon carries a gold dot (`client/src/hooks/useTabSignal.ts`, called at `client/src/screens/GameScreen.tsx:419`), whether or not the tab is in view. There is still no sound or notification, an opponent's draw offer gives no sign in the tab, and a move in flight still shows only as the piece left lifted.

### B-22: The board has no coordinate labels, so the move list cannot be matched to cells

- **Where the user meets it:** Reading the move list, or discussing a move with the opponent.
- **What happens / what was expected:** The only place cell names appear is the list; the board has no level, file, or rank labels, and each player sees it mirrored. There is also no way to reset the view once panned away.
- **Severity:** `low`.
- **Decision needed:** `product call`.
- **Raised by:** [the rules](foundations/game-rules.md#open-questions-and-verification), [the view](foundations/the-view.md#open-questions-and-verification), [the move list](game-page/move-list.md#edge-cases).
- **Status:** resolved by the board's new look (seen at `bb16fed`): the files and ranks are labelled along two edges of the bottom level and each level's letter stands beside it, and the view can no longer be panned (it only turns round the tower's center and zooms), so it cannot be lost. There is still no "reset view" control.
- **At `24c650c`:** fixed, except a "reset view" control. Every file, rank and level is labelled on the tower (`client/src/three/scene/labelAnchors.ts`; [the view](foundations/the-view.md)), and the view only turns about the tower's centre and zooms, so it cannot be lost; there is still no control that brings back the default view.

### B-23: Nothing identifies a seat but this browser's storage

- **Where the user meets it:** Changing browser or device, clearing site data, or opening one's own link in another browser.
- **What happens / what was expected:** A seat belongs to whichever browser stored it. Another browser, a private window, or cleared site data gets the join screen, and "Join Game" is refused with "Game full"; the seat cannot be recovered. Conversely, anyone who knows a game id and a color can claim that seat with a modified client. The creator is not told their color until the game starts, and the join screen says nothing about the game before the click.
- **Severity:** `low`. By design for a game among friends (see the repository's ARCHITECTURE.md, trust assumptions).
- **Decision needed:** `product call`. A per-seat secret in the link or a "move my seat" link would address both directions.
- **Raised by:** [the connection and seat model](foundations/connection-and-seat.md#open-questions-and-verification), [the broken game record](cross-cutting/broken-game-record.md), [waiting for an opponent](start/waiting-for-an-opponent.md#open-questions-and-verification), [joining a game](start/joining-a-game.md#open-questions-and-verification).
- **Status:** the unrecoverable seat confirmed 2026-09-25 by the scripted pass: CONN-12.
- **At `24c650c`:** partly addressed. The creator now picks a side (or Random, decided before the game is made) on the side choice, and the invitation to the free seat names the side the guest will play, so both players know their color before the game starts. A seat still belongs only to this browser's storage: another browser, a private window, or cleared site data is shown "This game is taken" once both seats are taken, and the seat cannot be recovered. Read from code; CONN-12 at `24c650c` unverified.

### B-24: Two tabs on one game against the computer overwrite each other's stored game

- **Where the user meets it:** The same game against the computer open in two tabs: a duplicated tab, or `/computer/{id}` opened again from the history or a bookmark.
- **What happens / what was expected:** Each tab reads the stored game once, when it opens, and writes its own copy after every move. The tabs never learn of each other: each plays its own line against its own computer, and whichever moved last overwrites the stored game, silently discarding the other tab's moves. A reload then shows only that tab's line. Nothing says that the game is open twice. Expected: as against a friend, one tab plays and the other says the game is open elsewhere, or the other tab follows.
- **Reproduce:** Start a game against the computer and play a move. Open its address in a second tab; play a different move there. Play another move in the first tab, then reload the second: it shows the first tab's line (CPU-09).
- **Why (from the code, at `24c650c`):** `client/src/hooks/useComputerGame.ts:45` loads the game once; `:59` and `:66` save this tab's game after each answer; `client/src/lib/computerGames.ts:26-43` reads and writes `3dchess:computer:{id}` with no check of what is there; nothing listens for the browser's `storage` event.
- **Severity:** `low`. It needs two tabs on the same game, and the game is only against the computer.
- **Decision needed:** `fix`. Follow the stored game across tabs (the `storage` event), or let only one tab play.
- **Raised by:** [playing the computer](computer/playing-the-computer.md#open-questions-and-verification).
- **Status:** read from code at `24c650c`; not tried (CPU-09 unverified).
