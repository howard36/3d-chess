# Verification: start

How to run this file: bring up the local server and client as in [the protocol](README.md#how-to-run-a-pass). Each section starts from fresh browser contexts (no stored seats) unless it says otherwise. Device values are defined in [devices and conditions](README.md#devices-and-conditions); `server stopped` means the local server process is not running (stop it with Ctrl+C and start it again when the step says so), and `storage off` means the browser refuses to store site data for `localhost`.

## start/creating-a-game.md

| ID | P | Device | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CREATE-01 | P1 | mouse | Clicking "Start New Game" shows "Creating Game..." and then the share-link screen at `/game/{id}` ([the simple case](../start/creating-a-game.md#the-simple-case)). | Start screen, connected. | 1. Click "Start New Game". | The button reads "Creating Game..." and is disabled, then the address becomes `/game/` plus six characters from A–Z and 0–9, and the page reads "Game created! Share this link with a friend:" with that link. | pass |
| CREATE-02 | P1 | server stopped | The button works before the connection is open; the click is queued ([end without sending](../start/creating-a-game.md#end-without-sending)). | Server stopped; open `/`. | 1. Note the status line.<br>2. Click "Start New Game".<br>3. Start the server. | 1: "Connecting to server…", then "Reconnecting to server…". 2: "Creating Game...", disabled, status line still shown. 3: within about 8 s, the share-link screen of a new game. | pass (server unreachability simulated by blocking the page socket; "Connecting to server…" not separately observed) |
| CREATE-03 | P1 | drop | A drop while the request is in flight leaves the button stuck (suspected bug) ([cancel and interrupt](../start/creating-a-game.md#cancel-and-interrupt)). | Start screen, connected. | 1. Click "Start New Game" and cut the connection before the answer arrives.<br>2. Let the connection come back and wait 10 s. | Record what happens. Per the document: "Creating Game..." stays, disabled, after the status line has gone; only a reload recovers. | pass (button still "Creating Game..." and disabled 10 s after the connection returned (suspected bug confirmed)) |
| CREATE-04 | P2 | mouse | A double click creates one game ([while in flight](../start/creating-a-game.md#while-in-flight)). | Start screen, connected. | 1. Double-click "Start New Game". | One navigation to a game page; no error. | pass |
| CREATE-05 | P2 | keyboard | The button works from the keyboard ([modifiers](../start/creating-a-game.md#modifiers)). | Start screen, nothing focused. | 1. Press Tab.<br>2. Press Enter. | 1: the button is focused, with a focus ring. 2: a game is created. | pass |
| CREATE-06 | P1 | storage off | With storage refused, the creator lands on the join screen, and "Join Game" gives "Already in a game" (suspected bug) ([edge cases](../start/creating-a-game.md#edge-cases)). | A context whose storage throws or is blocked. | 1. Click "Start New Game".<br>2. Click "Join Game". | Record what happens. Per the document: 1: the join screen instead of the share link. 2: "Joined game, waiting for start..." with "Error: Already in a game". | pass (storage refused by making Storage throw (suspected bug confirmed)) |
| CREATE-07 | P2 | second player | Arriving from a finished game does not bounce back into it ([edge cases](../start/creating-a-game.md#edge-cases)). | A finished game. | 1. Click "Start new game".<br>2. Wait 2 s. | The start screen stays, with "Start New Game" enabled and no error. | pass |

Not checkable by hand:

- Back pressed within the round trip of a create: a race of a few tens of milliseconds.
- How long "Connecting to server…" lasts on a cold production server.

## start/waiting-for-an-opponent.md

| ID | P | Device | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WAIT-01 | P1 | mouse | The share link is plain text, and the screen shows no color ([the simple case](../start/waiting-for-an-opponent.md#the-simple-case)). | A game just created. | 1. Look for a copy control and click the link text.<br>2. Look for the creator's color. | No button or copy control; clicking the text does nothing; the color is not shown anywhere. | pass (no buttons or links on the share-link screen; no color named; the first scripted attempt counted before the screen rendered) |
| WAIT-02 | P1 | second player | A join replaces the screen with the board, and the color appears then ([the answer arrives](../start/waiting-for-an-opponent.md#the-answer-arrives)). | WAIT-01. | 1. Join from a second context. | The creator's page shows the board screen, "You are playing as …" with the stored color, "White to move", then "Opponent: online". | pass (creator: You are playing as black.Opponent: online; joiner: You are playing as white.Opponent: online) |
| WAIT-03 | P1 | mouse | Reloading while waiting returns to the share-link screen ([begin](../start/waiting-for-an-opponent.md#begin)). | A game with one seat taken. | 1. Reload. | The share-link screen again, with the same link. | pass |
| WAIT-04 | P1 | second player | A join made while the creator is away is found on return ([the answer arrives](../start/waiting-for-an-opponent.md#the-answer-arrives)). | A game with one seat taken. | 1. Close the creator's page.<br>2. Join from a second context.<br>3. Reopen the link in the creator's context. | 2: the joiner's board shows "Opponent: offline". 3: the creator's page shows the board directly (after the brief share-link screen), and the joiner's shows "Opponent: online". | pass |
| WAIT-05 | P1 | second tab | Opening the link in another tab of the same browser takes the seat ([edge cases](../start/waiting-for-an-opponent.md#edge-cases)). | A game with one seat taken. | 1. Open the link in a new tab of the same context. | The new tab shows the share-link screen; the first shows "This game is open in another tab". | pass |
| WAIT-06 | P1 | drop | Back then Forward before the start screen's connection opens gives "Error: Already in a game" (suspected bug) ([edge cases](../start/waiting-for-an-opponent.md#edge-cases)). | A game with one seat taken; the connection held down so that it cannot open. | 1. Press Back.<br>2. Press Forward.<br>3. Let the connection open. | Record what happens. Per the document: the share-link screen with "Error: Already in a game" in the banner; the seat is unaffected. | pass (banner: ["Error: Already in a game✕"] (suspected bug confirmed)) |
| WAIT-07 | P2 | drop | A drop while waiting shows "Reconnecting…" and the screen stays ([cancel and interrupt](../start/waiting-for-an-opponent.md#cancel-and-interrupt)). | A game with one seat taken. | 1. Drop the connection and hold it for 3 s.<br>2. Release it. | 1: "Reconnecting…" at the top right, the share-link text unchanged. 2: the box goes; the screen stays. | pass |

Not checkable by hand:

- The one-instant "Opponent: offline" as the board appears after a rejoin while waiting: shorter than a frame.
- Whether reopening an unjoined game keeps it from expiring.

## start/joining-a-game.md

| ID | P | Device | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| JOIN-01 | P1 | mouse | A visitor sees only "Join Game" ([begin](../start/joining-a-game.md#begin)). | A game with one seat taken; a fresh context. | 1. Open the link. | The title and a "Join Game" button; nothing else. | pass |
| JOIN-02 | P1 | second player | Joining starts the game on both pages, with the joiner holding the other color ([the answer arrives](../start/joining-a-game.md#the-answer-arrives)). | JOIN-01. | 1. Click "Join Game". | At most a flash of "Joined game, waiting for start...", then the board screen on both pages; the two seat labels name different colors; "White to move"; "Opponent: online" on both. | pass (checked together with WAIT-02) |
| JOIN-03 | P1 | mouse | An unknown id is refused with "Cannot join" ([the answer arrives](../start/joining-a-game.md#the-answer-arrives)). | A fresh context. | 1. Open `/game/NOPE00`.<br>2. Click "Join Game". | "Error: Cannot join" in the banner; the join screen again. | pass |
| JOIN-04 | P1 | second player | A third person is refused with "Game full" ([edge cases](../start/joining-a-game.md#edge-cases)). | A started game; a third context. | 1. Open the link.<br>2. Click "Join Game". | "Error: Game full"; the join screen again. | pass |
| JOIN-05 | P1 | drop | A drop before the seat confirmation strands the joiner, and the seat is lost (suspected bug) ([cancel and interrupt](../start/joining-a-game.md#cancel-and-interrupt)). | A game with one seat taken; a fresh context on its link. | 1. Click "Join Game" and cut the connection before the answer.<br>2. Let it reconnect; wait 10 s.<br>3. Reload and click "Join Game". | Record what happens. Per the document: 2: "Joined game, waiting for start..." stays; the creator's page shows the board. 3: "Error: Game full". | pass (joiner stuck on joined screen; creator's board shown with presence "Opponent: offline"; after reload, "Game full" (suspected bug confirmed)) |
| JOIN-06 | P2 | second player | Joining works while the creator is away ([edge cases](../start/joining-a-game.md#edge-cases)). | A game whose creator's page is closed. | 1. Join. | The board screen with "Opponent: offline". | pass (checked within WAIT-04: joiner saw "Opponent: offline" with the creator away) |
| JOIN-07 | P2 | second tab | A second tab still on the join screen is refused after the first joins ([edge cases](../start/joining-a-game.md#edge-cases)). | A visitor with the link open in two tabs of one context. | 1. Join in tab 1.<br>2. Click "Join Game" in tab 2. | 2: "Error: Game full" in tab 2. | pass |

Not checkable by hand:

- The one-frame return to the join screen when "Join Game" is clicked again after a refusal.
- Whether a visitor should learn anything about the game before clicking: a product call.

Verified against 3D Chess commit `d94507b`
