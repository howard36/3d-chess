# Verification: session

How to run this file: bring up the local server and client as in [the protocol](README.md#how-to-run-a-pass). Unless a row says otherwise, the setup is a started game in two browser contexts. Most rows need `drop`: cutting and restoring one page's connection while the server keeps the game, which only [the harness](harness/README.md) (or a server that keeps its games across restarts) can do faithfully; see [devices and conditions](README.md#devices-and-conditions). `delayed answers` means the harness holds back the messages a page receives for a few seconds after its connection opens, which widens a window that is normally one round trip long.

## session/reload-and-return.md

| ID | P | Device | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| RELOAD-01 | P1 | second player | A reload restores the game without glides, at the default view ([the answer arrives](../session/reload-and-return.md#the-answer-arrives)). | Play `Bc1-Ec4`; orbit White's view. | 1. Reload White's page. | The board with the Queen on `Ec4`, teal on `Bc1` and `Ec4`, no glide, "Black to move", "1. Bc1–Ec4" in the list, the default view, "Opponent: online". | pass |
| RELOAD-02 | P1 | mouse | An expired game's rejoin is refused, the stored seat is deleted, and "Join Game" then gives "Cannot join" without the joined screen (suspected bug) ([edge cases](../session/reload-and-return.md#edge-cases)). | A game the server no longer has (restart the local server). | 1. Reload the game page.<br>2. Click "Join Game". | 1: "Error: Cannot rejoin" and the join screen. 2: record what happens; per the document, "Error: Cannot join" with no "Joined game, waiting for start..." in between. | pass (joined screen observed in 0 of 40 samples at 25 ms; ended on "Error: Cannot join") |
| RELOAD-03 | P1 | mouse | A jump through history from one game page straight to another keeps showing the old game (suspected bug) ([edge cases](../session/reload-and-return.md#edge-cases)). | One context that has played in game A, returned to the start screen, and created game B. | 1. From B's page, jump two entries back in the history menu to A's page (without passing through the start screen). | Record what happens. Per the document: the address is A's, but the screen is B's, and no rejoin is sent. | pass (address ZDLJKU (was QCKSS5); end-game dialog shown: false; page text: "3D Chess\n\nGame created! Share this link with a friend:\n\nhttp://localhost:5173/game/ZDLJKU") |
| RELOAD-04 | P2 | second tab | Reloading the replaced tab takes the seat back ([edge cases](../session/reload-and-return.md#edge-cases)). | The game open in two tabs of White's context; the first replaced. | 1. Reload the first tab. | The first tab shows the board; the second shows "This game is open in another tab". | pass (reloading a replaced tab took the seat back) |

Not checkable by hand:

- Whether a rejoin counts as activity for the ~30-day expiry.
- Back-forward cache restores: browser-specific.

## session/connection-loss.md

| ID | P | Device | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DROP-01 | P1 | drop | During a drop: "Reconnecting…", no input, everything else frozen; after it, the page catches up and the opponent sees offline then online ([begin](../session/connection-loss.md#begin), [the answer arrives](../session/connection-loss.md#the-answer-arrives)). | White to move, `Bb2` selected. | 1. Drop White's connection and hold it.<br>2. Look at both pages.<br>3. Release it. | 2: White: "Reconnecting…", selection gone; Black: "Opponent: offline". 3: box gone; Black: "Opponent: online"; White can move. | pass |
| DROP-02 | P1 | drop, delayed answers | A move pressed before the snapshot arrives can be recorded against a position two moves old and freeze both boards (suspected bug) ([while in flight](../session/connection-loss.md#while-in-flight)). | White to move. | 1. White plays `Bb2-Bb3`, and White's connection is cut before the echo arrives.<br>2. Black replies `Ed4-Ed3`.<br>3. Restore White's connection with its answers delayed.<br>4. On White's still-stale board, play `Bb2-Bb3` again. | Record what happens. Per the document: the move is accepted; when the answers arrive, both boards freeze under the frozen-board banner at move 3. | pass (White banners ["Move 3 in this game's history is not a legal move for this client (likely an app version mismatch). The board is frozen at the position before it."]; Black banners ["Move 3 in this game's history is not a legal move for this client (likely a...) |
| DROP-03 | P2 | drop | A server fault or any close other than a replacement is retried ([begin](../session/connection-loss.md#begin)). | Board screen. | 1. Close White's connection with any code. | "Reconnecting…", then recovery. | pass (closed with application code 4000 from the page; retried and recovered) |
| DROP-04 | P2 | server stopped | Restarting the local server loses its games; a mid-game page keeps its board and every move is refused with "Not in a game" ([the answer arrives](../session/connection-loss.md#the-answer-arrives)). | Board screen, White to move. | 1. Restart the local server.<br>2. Wait for the reconnect.<br>3. White plays a move. | 2: "Error: Cannot rejoin"; the board stays. 3: "Error: Not in a game"; the move is not shown. (Production keeps games across restarts; this row checks the page's handling only.) | pass (board kept; "Error: Cannot rejoin", then "Error: Not in a game" for a move; stored seat kept) |

Not checkable by hand:

- Laptop sleep: how long a browser takes to notice a dead connection.
- The one-hour limit.
- A fault on every rejoin retrying every half second: needs a faulty server.

## session/second-tab.md

| ID | P | Device | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TAB-01 | P1 | second tab | "Play here" takes the seat back; moves made in the other tab glide in; the view angle is kept ([the answer arrives](../session/second-tab.md#the-answer-arrives)). | White's first tab replaced by a second tab; the first tab orbited before it was replaced. | 1. In the second tab, White plays `Bb2-Bb3`.<br>2. In the first tab, click "Play here". | The first tab: the dialog goes, the pawn glides to `Bb3`, the orbited angle is unchanged. The second tab shows the dialog. Black never shows "Opponent: offline". | pass (glide seen after Play here: 1; opponent presence samples never offline) |
| TAB-02 | P1 | second tab, drop | A tab that was reconnecting when the other took the seat takes it back by itself (suspected bug) ([edge cases](../session/second-tab.md#edge-cases)). | White's first tab on the board. | 1. Drop the first tab's connection and hold it.<br>2. Open the game in a second tab.<br>3. Release the first tab's connection. | Record what happens. Per the document: after 3, the first tab holds the seat and the second tab shows the replaced dialog, without any click. | pass (the reconnecting tab took the seat back without a click; the newer tab shows the dialog (suspected bug confirmed)) |
| TAB-03 | P2 | second tab | Closing the newer tab leaves the older one replaced ([edge cases](../session/second-tab.md#edge-cases)). | First tab replaced. | 1. Close the second tab. | The first tab still shows the dialog; Black shows "Opponent: offline". | pass |
| TAB-04 | P2 | keyboard | The replaced dialog takes no focus and cannot be dismissed; Tab reaches controls under it ([edge cases](../session/second-tab.md#open-questions-and-verification)). | A finished game; its first tab replaced. | 1. Press Escape; click the backdrop.<br>2. Press Tab repeatedly, reading the focused element. | 1: the dialog stays. 2: record the order; per the document, "Start new game" (under the backdrop) is reachable. | pass (focus on open: BODY; Tab order: BUTTON:Play here -> BODY -> BUTTON:Start new game -> BUTTON:Play here) |

Not checkable by hand:

- A move sent by the older tab at the instant of replacement: a race inside the server.
- A stale board after "Play here": the same window as DROP-02.

Verified against 3D Chess commit `d94507b`
