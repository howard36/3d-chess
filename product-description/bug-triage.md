# Bug triage

A consolidated list of the defects and inconsistencies that the feature documents raised in their "Open questions and verification" sections and in their bodies. Each entry is read from the 3D Chess source and tests at commit `d94507b`; the 19 that were reproduced, in whole or in part, by the [first, scripted verification pass](verification/README.md#results-so-far) carry a **Status** line naming the checklist items. The list exists so the product team can decide, item by item, whether to fix, to document as intended, or to leave.

## Summary

The documents raised about 60 questions; after merging by root cause, 23 entries remain. Three are **high**. All three can end a game or change it against the player's intent: a press on the board acts on pointer-down, so turning the view can play a move (B-01); a move made just after reconnecting can be recorded against a stale position and freeze the game for both players (B-02); and a join whose answer is lost leaves the joiner stranded and the game unplayable (B-03). The largest cluster is **the connection edge**: B-02, B-03, B-04, B-06, B-10, B-16, and B-17 are all a page's state and the server's getting out of step around a drop, a reset, or a second tab. The fixes are small and local: wait for the snapshot, resend or recover lost requests, reset on every game change. A second cluster is **input and layout**: B-01, B-07, B-08, B-09. Four entries are product calls about what the game should offer rather than defects (B-20 to B-23).

| ID | Title | Severity | Area | Decision needed | Issue |
| --- | --- | --- | --- | --- | --- |
| B-01 | A press on the board acts on pointer-down, so turning the view can play a move or drop the selection | high | play | fix | — |
| B-02 | A move pressed just after reconnecting is recorded against a stale position and can freeze the game | high | session | fix | — |
| B-03 | A join whose answer is lost strands the joiner and loses the seat for good | high | start | fix | — |
| B-04 | A create whose answer is lost leaves "Creating Game..." stuck until reload | medium | start | fix | — |
| B-05 | Jumping between two game pages through browser history shows the old game under the new address | medium | session | fix | — |
| B-06 | A tab that was reconnecting takes the seat back from the newer tab without a click | medium | session | product call | — |
| B-07 | The promotion dialog loses keyboard focus to the press that opens it | medium | play | fix | — |
| B-08 | The default view crops the board, badly on phones, and the HUD collides in narrow windows | medium | view | fix | — |
| B-09 | The game cannot be played without a pointer, and dialogs and cues are not accessible | medium | cross-cutting | product call | — |
| B-10 | Back then Forward before the start screen's connection opens shows "Error: Already in a game" | low | session | fix | — |
| B-11 | With browser storage disabled, the creator lands on the join screen and a reload loses the seat | low | start | fix | — |
| B-12 | Returning players see "Game created! Share this link with a friend:" while their rejoin is in flight | low | session | fix | — |
| B-13 | Unknown addresses render an empty dark page | low | navigation | fix | — |
| B-14 | A very fast double press on a destination sends the move twice and shows "Not your turn" | low | play | fix | — |
| B-15 | Old errors keep acting: success never clears the banner, and earlier refusals steer later joins | low | game page | fix | — |
| B-16 | The presence line goes stale while the player is disconnected | low | game page | product call | — |
| B-17 | The retry schedule starts over on every successful open, so a fault on each rejoin retries every 0.5 s | low | session | fix | — |
| B-18 | The frozen-board handling misleads: wrong wording, a wrong count, and a King capture offered | low | cross-cutting | fix | — |
| B-19 | Small copy and rendering slips | low | cross-cutting | fix | — |
| B-20 | The end of a game offers nothing but leaving: no review, no rematch, no resignation, no abandonment | low | play | product call | — |
| B-21 | Nothing signals the player's turn, an opponent joining, or a move in flight | low | cross-cutting | product call | — |
| B-22 | The board has no coordinate labels, so the move list cannot be matched to cells | low | view | product call | — |
| B-23 | Nothing identifies a seat but this browser's storage | low | cross-cutting | product call | — |

## High

### B-01: A press on the board acts on pointer-down, so turning the view can play a move or drop the selection

- **Where the user meets it:** Turning the view to look at the board, the most common thing a player does. They drag, right-drag, or pinch starting over the cube.
- **What happens / what was expected:** The board acts on the press itself, before anyone can tell whether it is a click or the start of a drag, and for every mouse button and every finger. A drag that starts on a highlighted destination plays that move and turns the view. A drag that starts anywhere else in the cube clears the selection. A right press (pan) or middle press (zoom) selects and moves like a left one, and a second finger landing for a pinch is a press of its own. Expected: a drag turns the view and nothing else; only a click (press and release without movement, primary button) selects or moves.
- **Reproduce:** New game, White. Press the pawn on `Ab2`. Press on `Ab3`'s dot and drag 200 px left. The view turns and `Ab2–Ab3` is played. Or: select the Queen `Bc1`, then drag starting over an empty cell in the middle of the cube; the view turns and the selection is gone.
- **Why (from the code):** `client/src/three/Board.tsx:223-228` (the board group clears the selection on `onPointerDown`), `:268-275` (a destination cell plays the move on `onPointerDown`), and `:179-182` with `:328` (pieces select on `onPointerDown`). The camera controls (`client/src/screens/GameScreen.tsx:350`) listen to the same pointer, independently. Neither filters by button or pointer count.
- **Severity:** `high`. An irreversible move is played by a gesture meant only to look, and with a Queen or Rook selected, destinations cover much of the board.
- **Decision needed:** `fix`. Resolve presses on click (the 3D library's click event already ignores presses that moved more than a couple of pixels), and only for the primary button and the first pointer.
- **Raised by:** [the input model](foundations/input-model.md#open-questions-and-verification), [making a move](play/making-a-move.md#open-questions-and-verification), [the view](foundations/the-view.md#begin), [screen sizes and touch](cross-cutting/screen-sizes-and-touch.md#open-questions-and-verification).
- **Status:** confirmed 2026-09-25 by the scripted pass: INPUT-02 (a drag from a destination played the move), INPUT-03 (a drag from an empty cell cleared the selection), INPUT-05 and MOVE-08 (right and middle presses select and move).

### B-02: A move pressed just after reconnecting is recorded against a stale position and can freeze the game

- **Where the user meets it:** Right after the connection comes back from a drop, or right after "Play here" in a replaced tab.
- **What happens / what was expected:** The board takes input again as soon as the new connection opens, one round trip before the rejoin's snapshot arrives. For that moment it shows the position from before the drop, which after a drop can be two moves old (the player's own move recorded but its echo lost, plus the opponent's reply) and after a replacement any number of moves old. A move pressed then is sent, and the server records it if the turn matches, without checking legality. If the move's piece is no longer where the stale board showed it, neither browser can replay the record, and both boards freeze permanently under the frozen-board banner. Expected: the board takes no input until the snapshot has arrived.
- **Reproduce:** Needs the window held open. The harness does it: White plays `Bb2-Bb3` and the echo is lost to a drop; Black replies `Ed4-Ed3`; White's connection returns with its answers held back for 5 s; on the stale board White plays `Bb2-Bb3` again. Both boards then show "Move 3 in this game's history is not a legal move for this client…" and the game is over for good.
- **Why (from the code):** `client/src/screens/GameScreen.tsx:72-81`: whether the board takes input depends on the connection state and the player's own move in flight, not on whether this connection's rejoin has been answered (the rejoin is sent at `:95-101`). `server/modal_app.py:160-178` records any in-turn move. `client/src/game/history.ts:115-127` stops replay at the first move it cannot apply.
- **Severity:** `high`. It destroys the game for both players, and the banner blames "an app version mismatch".
- **Decision needed:** `fix`. Treat the board as not taking input until `hasSessionSince(messages, sessionStartIndex)` holds for a page with a stored seat, which is the same check the page already uses to decide whether to rejoin.
- **Raised by:** [connection loss](session/connection-loss.md#open-questions-and-verification), [a second tab](session/second-tab.md#open-questions-and-verification), [making a move](play/making-a-move.md#edge-cases), [the broken game record](cross-cutting/broken-game-record.md#open-questions-and-verification), [the turn indicator](game-page/turn-indicator.md#edge-cases), [the connection and seat model](foundations/connection-and-seat.md#open-questions-and-verification).
- **Status:** confirmed 2026-09-25 by the scripted pass: DROP-02 (both boards froze at move 3).

### B-03: A join whose answer is lost strands the joiner and loses the seat for good

- **Where the user meets it:** Clicking "Join Game" on a share link while the network is flaky, or reloading or leaving in the fraction of a second after the click.
- **What happens / what was expected:** The page shows "Joined game, waiting for start..." from the click. If the connection drops after the join is sent but before the seat confirmation arrives, the page stays on that screen forever, even after reconnecting: it has no stored seat to rejoin with, and nothing re-sends the join. The server has meanwhile taken the seat: the creator's board appears and shows the joiner offline. After a reload the joiner gets the join screen, and "Join Game" is refused with "Game full". Nobody can ever sit in that seat again, so the game can never be played. Expected: the page recovers the seat (retry the join, or have the server remember the joining connection's claim) or at least reports the failure.
- **Reproduce:** Harness: open a new game's link in a second context, click "Join Game" and close the socket in the same instant, let it reconnect, wait 10 s. The joined screen stays up and the creator shows the board. Reload and click "Join Game": "Error: Game full".
- **Why (from the code):** `client/src/screens/GameScreen.tsx:116-124` leaves the joined screen only on "Cannot join" or "Game full"; `:95-101` rejoins only with a stored seat; `:105-111` stores the seat only on the seat confirmation; `client/src/hooks/useGameSocket.ts:73-81` never re-sends a request that was already sent. `server/modal_app.py:318-331` claims the seat before answering.
- **Severity:** `high`. It leaves the user in a state they cannot get out of, and the game is lost for both players.
- **Decision needed:** `fix`. For example, re-send the join on the next connection when the page is in the joined phase without a confirmed seat (a repeated join is harmless if the server treats a join from the same browser as a rejoin), or include the chosen color in the join so the joiner can rejoin.
- **Raised by:** [joining a game](start/joining-a-game.md#open-questions-and-verification), [connection loss](session/connection-loss.md#open-questions-and-verification), [the connection and seat model](foundations/connection-and-seat.md#requests-while-disconnected).
- **Status:** confirmed 2026-09-25 by the scripted pass: JOIN-05.

## Medium

### B-04: A create whose answer is lost leaves "Creating Game..." stuck until reload

- **Where the user meets it:** Clicking "Start New Game" as the connection drops.
- **What happens / what was expected:** The button stays at "Creating Game...", disabled, for good; the status line comes and goes; nothing re-sends the request. If the server received it, an orphan game with one seat exists. Expected: the request is retried, or the button is re-enabled when the connection returns.
- **Reproduce:** Click "Start New Game" and cut the connection in the same instant (harness: `clickThenCut`). Let it reconnect. The button stays disabled.
- **Why (from the code):** `client/src/screens/StartScreen.tsx:28`: loading ends only on the game id or an error arriving; nothing watches the connection.
- **Severity:** `medium`. A reload recovers.
- **Decision needed:** `fix`. Re-enable the button (or re-send) when a new connection opens with the request unanswered.
- **Raised by:** [creating a game](start/creating-a-game.md#open-questions-and-verification), [connection loss](session/connection-loss.md#open-questions-and-verification).
- **Status:** confirmed 2026-09-25 by the scripted pass: CREATE-03.

### B-05: Jumping between two game pages through browser history shows the old game under the new address

- **Where the user meets it:** Using the browser's history menu (a long press or right-click on Back or Forward) to go from one game page straight to another without passing through the start screen.
- **What happens / what was expected:** The address changes but the page keeps the previous game's connection and everything the server said about it; no rejoin is sent. In the pass, jumping from a new game's page back to a finished game showed the new game's share-link screen with the finished game's link, instead of the finished game's result. Moves made on such a page go to the other game. Expected: a change of game id resets the page and rejoins, as arriving at the start screen does.
- **Reproduce:** Finish a game, click "Start new game", then "Start New Game". From the new game's page, jump two entries back in history (`history.go(-2)` in the console does the same).
- **Why (from the code):** `client/src/App.tsx:18-20` resets the connection only on arrival at `/`; `client/src/screens/GameScreen.tsx:46-50` re-reads the stored seat on an id change but keeps the message log; `:98` then finds a seat on the current connection and does not rejoin.
- **Severity:** `medium`. Wrong but recoverable by reload; uncommon path.
- **Decision needed:** `fix`. Reset the connection whenever the game id in the address changes, not only on `/`.
- **Raised by:** [reloading and returning](session/reload-and-return.md#open-questions-and-verification), [the broken game record](cross-cutting/broken-game-record.md#open-questions-and-verification).
- **Status:** confirmed 2026-09-25 by the scripted pass: RELOAD-03.

### B-06: A tab that was reconnecting takes the seat back from the newer tab without a click

- **Where the user meets it:** With the game open in two tabs of one browser, when the first tab's connection was down at the moment the second took the seat (an outage, a sleeping laptop, or a click on "Play here" while the other tab is reconnecting).
- **What happens / what was expected:** The replaced signal cannot reach a dead connection, so the first tab never learns it was replaced. When its retry succeeds it rejoins and takes the seat back, and the tab the player is actually using suddenly shows "This game is open in another tab". It happens once, not in a loop. Expected, arguably: the tab the player chose keeps the seat.
- **Reproduce:** Drop tab 1's connection and hold it; open the game in tab 2; release tab 1. Tab 2 shows the replaced dialog.
- **Why (from the code):** `client/src/hooks/useGameSocket.ts:147-157` retries every close except 4001; `client/src/screens/GameScreen.tsx:95-101` rejoins on every new connection. Related: `server/modal_app.py:348-379` moves the seat first and closes the older connection only after three sends, so the older tab can still act on the seat for a moment.
- **Severity:** `medium`. Surprising and disruptive, but recoverable with one click.
- **Decision needed:** `product call`. Either keep last-connection-wins (and document it), or let a reconnecting page learn that its seat moved (for example a rejoin that does not take a seat held by a live connection unless the user asks).
- **Raised by:** [a second tab](session/second-tab.md#open-questions-and-verification), [connection loss](session/connection-loss.md#edge-cases).
- **Status:** confirmed 2026-09-25 by the scripted pass: TAB-02.

### B-07: The promotion dialog loses keyboard focus to the press that opens it

- **Where the user meets it:** Promoting a pawn and reaching for the keyboard (Escape to cancel, Enter for a Queen).
- **What happens / what was expected:** The dialog focuses "Queen" as it appears, but it appears during the pointer-down of the press on the promotion square, and the browser's default handling of that same press then moves focus to the page. The dialog opens with nothing focused: Escape and Enter do nothing until the player presses Tab. Expected: "Queen" focused, Escape cancels, Enter promotes.
- **Reproduce:** Play `Ba2-Ba3`, `Ee4-Ee3`, `Ba3-Ca3`, `Ee3-Ee2`, `Ca3-Da4`, `Ee2-Ee1`; select `Da4`, press `Ea5`; press Escape. The dialog stays.
- **Why (from the code):** `client/src/screens/PromotionPicker.tsx:16-19` focuses in an effect that runs during the opening pointer-down; the dialog is opened from the board's `onPointerDown` (`client/src/three/Board.tsx:196-197`).
- **Severity:** `medium`. The intended keyboard behavior never works, and an Escape-to-cancel expectation fails silently. Fixing B-01 (acting on click) would largely fix this too.
- **Decision needed:** `fix`. Open the dialog on click, or focus after the pointer sequence ends.
- **Raised by:** [promotion](play/promotion.md#open-questions-and-verification), [accessibility](cross-cutting/accessibility.md#open-questions-and-verification).
- **Status:** confirmed 2026-09-25 by the scripted pass: PROMO-02, PROMO-04, PROMO-08 (the first draft of the promotion document claimed the opposite and was corrected).

### B-08: The default view crops the board, badly on phones, and the HUD collides in narrow windows

- **Where the user meets it:** Every game's first sight of the board; any narrow window or phone.
- **What happens / what was expected:** The camera's position and vertical field of view are fixed, so the board's size follows the window's height. In a 1280 × 720 window the nearest bottom edge of the cube, the player's own back rank, runs off the bottom. On an upright 375 × 667 phone both sides are cut off (the centers of `Aa1`, `Aa5`, and `Ee5` fall outside the window). In the same window the seat label covers the left of the turn indicator, the turn indicator wraps to two lines, and the share link runs off both edges of a page that cannot scroll. Expected: the whole board framed at any window shape; HUD panels that never overlap; a share link that wraps or can be copied.
- **Reproduce:** Open a started game in a 375 × 667 window; open a new game's share-link screen in the same window.
- **Why (from the code):** `client/src/screens/GameScreen.tsx:321` (fixed camera), `:285` (`100vh`), `:289-299` and `client/src/three/TurnIndicator.tsx:7-21` (fixed HUD positions), `:388` (the link in large unbreakable text), `client/src/main.tsx:10` (`overflow-hidden` on the body).
- **Severity:** `medium`. Phones are barely usable without pinching out, and the player's own pieces are hidden at the start.
- **Decision needed:** `fix`. Fit the camera distance to the cube and the window's aspect; let the HUD wrap or stack; make the share link breakable, or give it a copy button.
- **Raised by:** [the view](foundations/the-view.md#open-questions-and-verification), [screen sizes and touch](cross-cutting/screen-sizes-and-touch.md#open-questions-and-verification), [seat and opponent status](game-page/seat-and-opponent-status.md#open-questions-and-verification), [the turn indicator](game-page/turn-indicator.md#open-questions-and-verification), [waiting for an opponent](start/waiting-for-an-opponent.md#open-questions-and-verification).
- **Status:** confirmed 2026-09-25 by the scripted pass: VIEW-01 (screenshot), SIZE-01, SIZE-02, SEAT-03, TURN-02.

### B-09: The game cannot be played without a pointer, and dialogs and cues are not accessible

- **Where the user meets it:** A keyboard-only or screen-reader user; a user who relies on reduced motion or cannot tell colors apart.
- **What happens / what was expected:** The board cannot be navigated, selected, or moved from the keyboard, and the canvas has no text alternative; the position exists for assistive technology only as the move list. The end-game dialog has no dialog role and takes no focus. The replaced dialog takes no focus and does not make the page behind it inert, so Tab reaches "Start new game" under it. Check, selection, destinations, and the last move are distinguished only by color. Animations ignore the reduced-motion preference. Turn and presence changes are not announced.
- **Reproduce:** Tab and arrow keys on the board screen do nothing; inspect the end-game dialog's role; set reduced motion and play a move.
- **Why (from the code):** `client/src/three/Board.tsx:152-204` (pointer events only), `client/src/screens/EndGameModal.tsx:20-51` (no role, no focus), `client/src/screens/GameScreen.tsx:217-256` (replaced dialog), `client/src/three/theme.ts` (color-only cues), `client/src/three/motion.ts` (no reduced-motion check), `client/src/three/TurnIndicator.tsx:23-27` (no live region).
- **Severity:** `medium`. The game is closed to some users, but the product's scope is a hobby game among friends.
- **Decision needed:** `product call`. Decide the accessibility bar; the dialog roles, focus handling, live regions, and reduced motion are cheap fixes whatever the bar.
- **Raised by:** [accessibility](cross-cutting/accessibility.md#open-questions-and-verification), [a second tab](session/second-tab.md#open-questions-and-verification), [check and the end of the game](play/check-and-game-end.md#open-questions-and-verification).
- **Status:** confirmed 2026-09-25 by the scripted pass: A11Y-01, A11Y-02, A11Y-03, TAB-04.

## Low

### B-10: Back then Forward before the start screen's connection opens shows "Error: Already in a game"

- **Where the user meets it:** Going Back to the start screen and Forward again quickly, or during an outage; "Start new game" followed at once by Back.
- **What happens / what was expected:** The game page sends its rejoin twice on the new connection; the second is refused and "Error: Already in a game" sits in the banner over an otherwise normal page. Expected: one rejoin, no error.
- **Reproduce:** On a share-link screen, hold the connection down, press Back, press Forward, release.
- **Why (from the code):** `client/src/hooks/useGameSocket.ts:89-98`: a reset does not change the session number, which changes only when a connection opens (`:115`); `client/src/screens/GameScreen.tsx:95-101` queues a rejoin against the old number and sends another on the new one; `server/modal_app.py:260-262` refuses the second.
- **Severity:** `low`. Cosmetic; the seat is unaffected.
- **Decision needed:** `fix`. Bump the session number on reset, or do not queue a rejoin.
- **Raised by:** [waiting for an opponent](start/waiting-for-an-opponent.md#open-questions-and-verification), [reloading and returning](session/reload-and-return.md#open-questions-and-verification), [connection loss](session/connection-loss.md#open-questions-and-verification), [error messages](cross-cutting/error-messages.md).
- **Status:** confirmed 2026-09-25 by the scripted pass: WAIT-06.

### B-11: With browser storage disabled, the creator lands on the join screen and a reload loses the seat

- **Where the user meets it:** Creating a game in a browser that refuses site storage.
- **What happens / what was expected:** The create succeeds, but the game page reads the seat only from storage, so it shows the creator the join screen; "Join Game" there shows "Joined game, waiting for start..." with "Error: Already in a game". A drop before the game starts, or any reload, loses the seat. Expected: the page uses the seat it was just given.
- **Reproduce:** Make storage throw (the harness overrides it), click "Start New Game".
- **Why (from the code):** `client/src/screens/GameScreen.tsx:33-35` and `:46-50` read the seat from storage only; `client/src/game/session.ts:35-49` does not count the creation answer as an assigned seat.
- **Severity:** `low`. Rare configuration.
- **Decision needed:** `fix`. Carry the creator's seat into the game page in memory (the connection already holds it).
- **Raised by:** [creating a game](start/creating-a-game.md#open-questions-and-verification), [waiting for an opponent](start/waiting-for-an-opponent.md#edge-cases), [connection loss](session/connection-loss.md#edge-cases).
- **Status:** confirmed 2026-09-25 by the scripted pass: CREATE-06.

### B-12: Returning players see "Game created! Share this link with a friend:" while their rejoin is in flight

- **Where the user meets it:** Reloading or reopening any game, as the joiner or during a game in progress; for as long as an outage lasts.
- **What happens / what was expected:** Before the snapshot arrives, a page with a stored seat shows the creator's waiting screen, telling a joiner in the middle of a game to share a link. Normally a flash; during an outage it stays up with "Reconnecting…". Expected: a neutral "Rejoining…" until the snapshot says what to show.
- **Reproduce:** Stop the server; reload the joiner's page of a started game.
- **Why (from the code):** `client/src/screens/GameScreen.tsx:141-145` and `:385-392`: the before-joining phase with a stored seat always shows the share-link screen.
- **Severity:** `low`. Copy.
- **Decision needed:** `fix`. Show a separate rejoining state until the first snapshot.
- **Raised by:** [the connection and seat model](foundations/connection-and-seat.md#open-questions-and-verification), [reloading and returning](session/reload-and-return.md#while-in-flight), [waiting for an opponent](start/waiting-for-an-opponent.md#edge-cases), [joining a game](start/joining-a-game.md#edge-cases).
- **Status:** confirmed 2026-09-25 by the scripted pass: CONN-09.

### B-13: Unknown addresses render an empty dark page

- **Where the user meets it:** A mistyped address such as `/games` or `/game/`.
- **What happens / what was expected:** A dark page with no text and no link. Expected: a not-found message with a link to the start screen.
- **Reproduce:** Open `/games`.
- **Why (from the code):** `client/src/App.tsx:24-27`: no catch-all route.
- **Severity:** `low`.
- **Decision needed:** `fix`. Add a catch-all route.
- **Raised by:** [screens and navigation](foundations/screens-and-navigation.md#open-questions-and-verification).
- **Status:** confirmed 2026-09-25 by the scripted pass: NAV-02.

### B-14: A very fast double press on a destination sends the move twice and shows "Not your turn"

- **Where the user meets it:** Double-clicking a destination very quickly (within about 20 ms in the pass; ordinary double-clicks at 50 ms and more sent one move).
- **What happens / what was expected:** The hold that stops a second move takes effect only after the page re-renders; a second press before that sends the move again, and the server refuses the copy with "Error: Not your turn". The game is unaffected. Expected: one move, no error.
- **Reproduce:** Harness: press a destination twice with no pause.
- **Why (from the code):** `client/src/screens/GameScreen.tsx:150-155` and `client/src/three/Board.tsx:189-204` read the hold and the selection from the last render.
- **Severity:** `low`.
- **Decision needed:** `fix`. Keep a synchronous "move sent" flag in a ref. Fixing B-01 (acting on click) narrows it further.
- **Raised by:** [making a move](play/making-a-move.md#open-questions-and-verification), [error messages](cross-cutting/error-messages.md).
- **Status:** confirmed 2026-09-25 by the scripted pass: MOVE-07 (the first draft claimed one move; corrected).

### B-15: Old errors keep acting: success never clears the banner, and earlier refusals steer later joins

- **Where the user meets it:** After any refusal on the game page.
- **What happens / what was expected:** The error banner stays until "✕", however many requests succeed after it, so it can describe a problem long over. The page's checks look at every error it has ever received, including dismissed ones: after "Cannot rejoin", a click on "Join Game" returns to the join screen before its own answer, so the joined screen never shows; a second "Join Game" after "Game full" does the same. An error the start screen received and cleared can reappear on the next game page. Expected: a request's success or failure is judged by its own answer, and a success clears the banner.
- **Reproduce:** Let a stored seat go stale (restart the local server), open the game, click "Join Game": no joined screen, "Error: Cannot join".
- **Why (from the code):** `client/src/screens/GameScreen.tsx:113` (the banner shows the latest error until dismissed), `:116-124` and `:128-139` (`errors.some` over the whole log), `:61` (errors from the whole log, including the start screen's).
- **Severity:** `low`.
- **Decision needed:** `fix`. Judge each request by the messages after it, as the start screen already does, and hide the banner when the next request succeeds.
- **Raised by:** [the error banner](game-page/error-banner.md#open-questions-and-verification), [joining a game](start/joining-a-game.md#open-questions-and-verification), [reloading and returning](session/reload-and-return.md#open-questions-and-verification), [the broken game record](cross-cutting/broken-game-record.md#open-questions-and-verification).
- **Status:** confirmed 2026-09-25 by the scripted pass: RELOAD-02 (no joined screen after "Cannot rejoin"), BANNER-02 (the banner survived two moves).

### B-16: The presence line goes stale while the player is disconnected

- **Where the user meets it:** During "Reconnecting…", or behind the replaced dialog.
- **What happens / what was expected:** "Opponent: online" stays on screen although nothing can update it; the opponent may have left. After a rejoin while waiting, the board can open showing "Opponent: offline" for an instant before the join's own report. Expected: the line hidden or marked unknown while disconnected.
- **Reproduce:** Hold White's connection down; close Black's page; White still shows "Opponent: online".
- **Why (from the code):** `client/src/game/session.ts:57-64` reads the latest report in the whole log; `client/src/screens/GameScreen.tsx:301-308` shows it in every connection state.
- **Severity:** `low`.
- **Decision needed:** `product call`.
- **Raised by:** [seat and opponent status](game-page/seat-and-opponent-status.md#open-questions-and-verification), [the connection and seat model](foundations/connection-and-seat.md#open-questions-and-verification).
- **Status:** confirmed 2026-09-25 by the scripted pass: CONN-10.

### B-17: The retry schedule starts over on every successful open, so a fault on each rejoin retries every 0.5 s

- **Where the user meets it:** A server that accepts connections but fails while handling this player's rejoin (for example while its storage is failing).
- **What happens / what was expected:** Each attempt opens, rejoins, and is closed with an internal error; since the schedule resets on open, the page retries every half second indefinitely, "Reconnecting…" flickers, and the opponent's presence line flaps. Expected: the backoff keeps growing until the page is back in its game.
- **Reproduce:** Needs a faulty server; read from code.
- **Why (from the code):** `client/src/hooks/useGameSocket.ts:110` resets the attempt count on open; `server/modal_app.py:409-418` closes on an unexpected error.
- **Severity:** `low`.
- **Decision needed:** `fix`. Reset the count when the rejoin is answered, not when the socket opens.
- **Raised by:** [connection loss](session/connection-loss.md#open-questions-and-verification).

### B-18: The frozen-board handling misleads: wrong wording, a wrong count, and a King capture offered

- **Where the user meets it:** A game whose record holds a move this browser cannot replay (B-02 in the real app, or a modified or version-skewed client).
- **What happens / what was expected:** The banner says the move "is not a legal move for this client (likely an app version mismatch)", but replay checks only whether a move can be applied, not legality, and the likeliest cause at this commit is B-02. Its move number counts single moves, while the move list numbers pairs. If an opponent's illegal move leaves their King attacked, the honest player is offered the King capture, and playing it freezes the board with the banner blaming the honest player's move. A move recorded after checkmate removes the end-game dialog. Expected: accurate wording and a count that matches the list; no King captures offered.
- **Reproduce:** Harness: send a move from an empty cell (FROZEN-01); send an illegal but applicable Knight move (FROZEN-02, not flagged).
- **Why (from the code):** `client/src/screens/GameScreen.tsx:277-278` (wording), `client/src/screens/MoveList.tsx:30-31` (pair numbering), `client/src/engine/board.ts:264-280` (legal moves do not exclude King captures), `client/src/game/history.ts:118-121` and `:131`.
- **Severity:** `low`. Reachable in the honest app only through B-02.
- **Decision needed:** `fix`. Reword the banner; number it like the list; exclude King captures from legal moves.
- **Raised by:** [the broken game record](cross-cutting/broken-game-record.md#open-questions-and-verification), [the move list](game-page/move-list.md#edge-cases).
- **Status:** banner text, freeze, and the unflagged illegal move confirmed 2026-09-25 by the scripted pass: FROZEN-01, FROZEN-02, FROZEN-03.

### B-19: Small copy and rendering slips

- **Where the user meets it:** Throughout.
- **What happens / what was expected:**
  - The move list's two spaces between a row's moves collapse to one, so the columns do not line up (`client/src/screens/MoveList.tsx:60`; confirmed LIST-02).
  - Dialog buttons ("Queen" … "Unicorn", "Cancel", "Start new game", "Play here") and dialog headings render as plain words and body-size text, because the base styles strip button borders and heading sizes (seen in the pass's screenshots).
  - "You are playing as white." names the color in lower case with a period; the turn indicator says "White to move" (`client/src/screens/GameScreen.tsx:300`).
  - "Creating Game..." and "Joined game, waiting for start..." use three dots; "Connecting to server…" and "Reconnecting…" use an ellipsis. "Start New Game" and "Start new game" differ in capitalization.
  - "Error: Cannot rejoin" is all an expired game says; a player cannot tell the game is gone.
  - The error banner's "✕" is a target of about 16 × 24 px with no hand pointer.
  - Behind the end-game dialog the turn indicator still names the mated side "to move".
- **Severity:** `low`.
- **Decision needed:** `fix`.
- **Raised by:** [the move list](game-page/move-list.md#open-questions-and-verification), [promotion](play/promotion.md#begin), [seat and opponent status](game-page/seat-and-opponent-status.md#edge-cases), [error messages](cross-cutting/error-messages.md), [the error banner](game-page/error-banner.md#open-questions-and-verification), [check and the end of the game](play/check-and-game-end.md#edge-cases).
- **Status:** the list spacing (LIST-02) and the plain-word buttons (screenshots) confirmed 2026-09-25 by the scripted pass.

### B-20: The end of a game offers nothing but leaving: no review, no rematch, no resignation, no abandonment

- **Where the user meets it:** At checkmate or stalemate, and in a game the opponent has left.
- **What happens / what was expected:** The end-game dialog cannot be dismissed, so the final position and the move list cannot be studied. "Start new game" goes to the start screen; there is no rematch with the same opponent. There is no resignation, draw offer, or clock, so an opponent who leaves for good stalls the game until it expires.
- **Severity:** `low`.
- **Decision needed:** `product call`. Each is a feature decision; the dismissible dialog is the cheapest.
- **Raised by:** [check and the end of the game](play/check-and-game-end.md#open-questions-and-verification), [the opponent's move](play/the-opponents-move.md#open-questions-and-verification), [the rules](foundations/game-rules.md#open-questions-and-verification).

### B-21: Nothing signals the player's turn, an opponent joining, or a move in flight

- **Where the user meets it:** Waiting in another tab for the opponent to join or move; playing on a slow connection.
- **What happens / what was expected:** The tab title never changes, and there is no sound or notification, so a creator in another tab does not know the game has started, and a player does not know it is their turn. While a move is in flight, nothing shows it; on a slow connection the board simply ignores presses.
- **Severity:** `low`.
- **Decision needed:** `product call`.
- **Raised by:** [the opponent's move](play/the-opponents-move.md#open-questions-and-verification), [waiting for an opponent](start/waiting-for-an-opponent.md#open-questions-and-verification), [screens and navigation](foundations/screens-and-navigation.md#open-questions-and-verification), [making a move](play/making-a-move.md#open-questions-and-verification).

### B-22: The board has no coordinate labels, so the move list cannot be matched to cells

- **Where the user meets it:** Reading the move list, or discussing a move with the opponent.
- **What happens / what was expected:** The only place cell names appear is the list; the board has no level, file, or rank labels, and each player sees it mirrored. There is also no way to reset the view once panned away.
- **Severity:** `low`.
- **Decision needed:** `product call`.
- **Raised by:** [the rules](foundations/game-rules.md#open-questions-and-verification), [the view](foundations/the-view.md#open-questions-and-verification), [the move list](game-page/move-list.md#edge-cases).

### B-23: Nothing identifies a seat but this browser's storage

- **Where the user meets it:** Changing browser or device, clearing site data, or opening one's own link in another browser.
- **What happens / what was expected:** A seat belongs to whichever browser stored it. Another browser, a private window, or cleared site data gets the join screen, and "Join Game" is refused with "Game full"; the seat cannot be recovered. Conversely, anyone who knows a game id and a color can claim that seat with a modified client. The creator is not told their color until the game starts, and the join screen says nothing about the game before the click.
- **Severity:** `low`. By design for a game among friends (see the repository README's trust assumptions).
- **Decision needed:** `product call`. A per-seat secret in the link or a "move my seat" link would address both directions.
- **Raised by:** [the connection and seat model](foundations/connection-and-seat.md#open-questions-and-verification), [the broken game record](cross-cutting/broken-game-record.md), [waiting for an opponent](start/waiting-for-an-opponent.md#open-questions-and-verification), [joining a game](start/joining-a-game.md#open-questions-and-verification).
- **Status:** the unrecoverable seat confirmed 2026-09-25 by the scripted pass: CONN-12.
