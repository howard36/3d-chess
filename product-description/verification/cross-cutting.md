# Verification: cross-cutting

How to run this file: bring up the local server and client as in [the protocol](README.md#how-to-run-a-pass). `modified client` means sending a message on the page's own connection that the app would never send; [the harness](harness/README.md) does this from inside the page, standing in for the modified or version-skewed client these documents describe. `reduced motion` is the operating system's (or devtools') "reduce motion" preference. Other device values are defined in [devices and conditions](README.md#devices-and-conditions).

## cross-cutting/error-messages.md

The individual messages are checked where they arise: "Cannot join" in JOIN-03, "Game full" in JOIN-04, "Cannot rejoin" in CONN-08 and RELOAD-02, "Not your turn" in MOVE-07, "Already in a game" in CREATE-06 and WAIT-06, "Not in a game" in DROP-04.

| ID | P | Device | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ERR-01 | P2 | mouse | The start screen shows errors as red text under the button, not in the banner ([error messages](../cross-cutting/error-messages.md)). | Start screen. | 1. Provoke any error on the start screen (for example by sending a second create on the same connection from the console). | Red text "Error: …" under the button; no banner. | pass (shown as <P> red text under the button; the button re-enabled (the error was provoked by a raw create on the same connection)) |

Not checkable by hand:

- "Message is not valid JSON", "Message does not conform to the protocol schema", "Clients may not send … messages", "Both players must have joined to move", and "Received a malformed message from the server": a correct client never provokes them.

## cross-cutting/broken-game-record.md

| ID | P | Device | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FROZEN-01 | P1 | modified client | A move this browser cannot replay freezes both boards under a banner; the list still shows it ([the answer arrives](../cross-cutting/broken-game-record.md#the-answer-arrives)). | New game, White to move. | 1. From White's page, send a move from the empty cell `Cc3` to `Cc4`. | Both pages: "Move 1 in this game's history is not a legal move for this client (likely an app version mismatch). The board is frozen at the position before it." below the turn indicator; "White to move"; the list shows `Cc3–Cc4`; no piece can be selected. | pass |
| FROZEN-02 | P1 | modified client | A move that is illegal but can be applied is not flagged ([what freezes and what does not](../cross-cutting/broken-game-record.md)). | New game, White to move. | 1. From White's page, send `Ab1-Ec4` (a Knight "jump" across the cube). | No banner. The Knight glides to `Ec4` on both boards, the pawn there fades, "Black to move". | pass |
| FROZEN-03 | P2 | modified client | Reloading hits the same freeze ([edge cases](../cross-cutting/broken-game-record.md)). | FROZEN-01. | 1. Reload either page. | The same banner at the same move. | pass |

## cross-cutting/accessibility.md

| ID | P | Device | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A11Y-01 | P1 | keyboard | The board cannot be played from the keyboard ([accessibility](../cross-cutting/accessibility.md)). | Board screen, White to move, no error. | 1. Press Tab, arrows, Enter, Space. | Nothing is focused on the board screen, nothing is selected, the view does not move. | pass |
| A11Y-02 | P1 | mouse | The end-game dialog has no dialog role; the promotion dialog and the replaced dialog do ([accessibility](../cross-cutting/accessibility.md)). | A finished game; a promotion dialog; a replaced tab. | 1. Inspect each dialog's role in the accessibility tree. | End-game: no dialog role. Promotion: `dialog`, named "Promote to". Replaced: `alertdialog`, named "This game is open in another tab". | pass (roles on the finished board screen: []; promotion "dialog" and replaced "alertdialog" roles were confirmed in PROMO-01 and TAB-04) |
| A11Y-03 | P2 | reduced motion | Moves glide even when the system asks for reduced motion ([accessibility](../cross-cutting/accessibility.md)). | Both contexts with reduced motion on. | 1. Play a move. | The piece still glides. | pass |
| A11Y-04 | P2 | mouse | Status and alert roles are present on the messages ([accessibility](../cross-cutting/accessibility.md)). | Start screen with the server stopped; a game page with an error. | 1. Inspect the status line and the banner. | Status line: role `status`. Banner: role `alert`. | pass (status line has role status; the banner role alert is confirmed in BANNER-01) |

## cross-cutting/screen-sizes-and-touch.md

| ID | P | Device | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SIZE-01 | P1 | narrow | On an upright phone the default view cuts off both sides of the board (suspected bug) ([screen sizes and touch](../cross-cutting/screen-sizes-and-touch.md)). | Started game in 375 × 667. | 1. Look at the board. | Record what shows. Per the document: the sides of the cube, including some of the player's nearest pieces, are cut off. | pass (cells whose centres fall outside a 375x667 window: Aa1@(-41,494), Ee5@(439,157), Aa5@(-81,175)) |
| SIZE-02 | P1 | narrow | The share link overflows a narrow window and cannot be scrolled (suspected bug) ([screen sizes and touch](../cross-cutting/screen-sizes-and-touch.md)). | A new game's share-link screen in 375 × 667. | 1. Look at the link. | Record what shows. Per the document: the link runs off both edges. | pass (link box x -74..449 in a 375 px window) |
| SIZE-03 | P2 | touch | A tap selects a piece and a tap on a destination plays the move ([screen sizes and touch](../cross-cutting/screen-sizes-and-touch.md)). | Started game on a touch device (or touch emulation), White to move. | 1. Tap `Bb2`.<br>2. Tap `Bb3`. | 1: selected with two destinations. 2: the move is played. | pass (touch emulation taps (single finger only)) |
| SIZE-04 | P2 | mouse | Resizing the window redraws the board at once ([screen sizes and touch](../cross-cutting/screen-sizes-and-touch.md)). | Started game. | 1. Resize the window from 1280 × 720 to 800 × 900. | The board redraws to fill the new window; nothing is stretched. | pass |

Verified against 3D Chess commit `d94507b`
