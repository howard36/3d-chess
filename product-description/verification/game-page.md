# Verification: game page

How to run this file: bring up the local server and client as in [the protocol](README.md#how-to-run-a-pass). Unless a row says otherwise, the setup is a started game in two browser contexts, at the default view, in a 1280 × 720 window. `narrow` is a 375 × 667 window. Device values are defined in [devices and conditions](README.md#devices-and-conditions).

## game-page/seat-and-opponent-status.md

| ID | P | Device | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SEAT-01 | P1 | mouse | The label names the color in lower case with a period ([the seat label appears](../game-page/seat-and-opponent-status.md#the-seat-label-appears)). | Started game. | 1. Read both labels. | "You are playing as white." and "You are playing as black.". | pass |
| SEAT-02 | P1 | second player | The presence line follows the opponent's connection ([the opponent leaves and returns](../game-page/seat-and-opponent-status.md#the-opponent-leaves-and-returns)). | Started game. | 1. Close Black's page.<br>2. Reopen its link. | White: "Opponent: offline", then "Opponent: online". | pass |
| SEAT-03 | P2 | narrow | In a narrow window the label covers part of the turn indicator (suspected layout bug) ([edge cases](../game-page/seat-and-opponent-status.md#edge-cases)). | Started game in a 375 × 667 window. | 1. Look at the top of the window. | Record what shows. Per the document: the label overlaps the start of "White to move". | pass (seat label x 10..229; turn indicator x 94..281, height 72) |

## game-page/turn-indicator.md

| ID | P | Device | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TURN-01 | P1 | second player | The indicator changes when a move lands, on both boards together ([the answer arrives](../game-page/turn-indicator.md#the-answer-arrives)). | White to move. | 1. White plays `Bb2-Bb3`. | Both read "Black to move" when the pawn lands. | pass (both flipped within 243 ms of the press (headless)) |
| TURN-02 | P2 | narrow | The indicator wraps onto two lines in a narrow window ([edge cases](../game-page/turn-indicator.md#edge-cases)). | Started game, 375 × 667. | 1. Look at the indicator. | Record its height; per the document it wraps below about 400 px. | pass (turn indicator height 72 px at 375 wide (one line is about 42 px)) |

## game-page/move-list.md

| ID | P | Device | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LIST-01 | P1 | second player | The list is hidden until the first move, then lists pairs in cell notation ([the simple case](../game-page/move-list.md#the-simple-case)). | Started game. | 1. Look at the bottom right.<br>2. Play `Ab2-Ab3`, `Ed4-Ed3`. | 1: no list. 2: one row, "1. Ab2–Ab3 Ed4–Ed3". | pass |
| LIST-02 | P3 | mouse | The two moves in a row are separated by a single space, not two (rendering slip) ([edge cases](../game-page/move-list.md#edge-cases)). | LIST-01. | 1. Read the row's text as rendered. | One space between `Ab3` and `Ed4`. | pass (rendered text "1. Ab2–Ab3 Ed4–Ed3" (the DOM holds two spaces; one is shown)) |
| LIST-03 | P2 | second player | The list stops at 40% of the window's height and scrolls itself to the newest move ([the simple case](../game-page/move-list.md#the-simple-case)). | Play about 20 moves. | 1. Measure the list's height.<br>2. Scroll it to the top; play one more move. | 1: at most 40% of the window's height. 2: the list is back at the bottom. | pass (list 288 px tall in a 720 px window; scrolled to newest after a move) |
| LIST-04 | P2 | mouse | The wheel over the list scrolls the list, not the view ([edge cases](../game-page/move-list.md#edge-cases)). | LIST-03. | 1. Turn the wheel over the list. | The list scrolls; the camera does not move. | pass |

## game-page/error-banner.md

| ID | P | Device | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BANNER-01 | P1 | mouse | The banner shows "Error: {message}" with "✕", stays until dismissed, and comes back with the next error ([the simple case](../game-page/error-banner.md#the-simple-case)). | A full game; a third context on its link. | 1. Click "Join Game".<br>2. Wait 3 s.<br>3. Click "✕".<br>4. Click "Join Game" again. | 1–2: "Error: Game full" stays. 3: gone. 4: back. | pass |
| BANNER-02 | P2 | second player | A later success does not hide the banner ([the answer arrives](../game-page/error-banner.md#the-answer-arrives)). | White to move; provoke "Error: Not your turn" (see MOVE-07). | 1. Let Black move, then White move. | The banner is still there after both moves. | pass |

Verified against 3D Chess commit `d94507b`
