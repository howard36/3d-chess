# Verification: game page

How to run this file: bring up the local server and client as in [the protocol](README.md#how-to-run-a-pass). Unless a row says otherwise, the setup is a started game in two browser contexts, at the default view, in a 1280 × 720 window. `narrow` is a 375 × 667 window. Device values are defined in [devices and conditions](README.md#devices-and-conditions). To put an error in the banner on the player's own page, use MOVE-07's double click, or send a second `create_game` on the page's connection from the console as in ERR-01.

## game-page/seat-and-opponent-status.md

These rows were rewritten for the turn pill at `f7bff4d` and have not been run by hand yet.

| ID | P | Device | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SEAT-01 | P1 | mouse | The player's stone stands at the left end of the pill in their army's material ([the seat appears](../game-page/seat-and-opponent-status.md#the-seat-appears)). | Started game. | 1. Look at both pills. | White's page: a porcelain stone at the left, a charcoal one at the right; Black's page: the reverse. No words name either color. | not run |
| SEAT-02 | P1 | second player | Presence shows only when the opponent is not connected ([the opponent leaves and returns](../game-page/seat-and-opponent-status.md#the-opponent-leaves-and-returns)). | Started game. | 1. Look at White's pill.<br>2. Close Black's page.<br>3. Reopen its link. | 1: "Opponent" (or "Their move") and a filled charcoal stone. 2: the stone becomes an outline and the word "Offline". 3: back as in 1. | not run |
| SEAT-03 | P2 | narrow | On a phone held upright the pill fills the top row beside the gear, and nothing overlaps ([the turn indicator](../game-page/turn-indicator.md#begin)). | Started game in a 390 × 844 window. | 1. Look at the top of the window. | The pill from 12 px at the left to the gear at the right; both stones and words whole. | not run |
| SEAT-04 | P2 | mouse | The pill lets presses through to the board ([edge cases](../game-page/seat-and-opponent-status.md#edge-cases)). | Started game. | 1. Left-drag 100 px starting on the pill.<br>2. Right-click on it. | 1: the view orbits; no text is selected. 2: no context menu. | not run |
| SEAT-05 | P2 | mouse | Presence and the seat are told to screen readers ([presence becomes known](../game-page/seat-and-opponent-status.md#presence-becomes-known)). | Started game. | 1. Inspect the pill and the presence status in the accessibility tree.<br>2. Close Black's page. | 1: the pill reads "You play White. Your move."; a status region reads "Your opponent is online.". 2: it reads "Your opponent is offline." | not run |

## game-page/turn-indicator.md

The red ring and "CHECK" are checked in END-01. These rows were rewritten for the turn pill at `f7bff4d` and have not been run by hand yet.

| ID | P | Device | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TURN-01 | P1 | second player | The light passes when a move lands, on both boards together ([the answer arrives](../game-page/turn-indicator.md#the-answer-arrives)). | White to move. | 1. White plays `Bb1-Cb1`. | When the pawn lands: White's pill lights its right half ("Their move"), Black's its left ("Your move"). | not run |
| TURN-02 | P2 | narrow | In check at 390 px the pill neither truncates nor wraps ([begin](../game-page/turn-indicator.md#begin)). | A position with Black in check, 390 × 844. | 1. Look at both pills. | The checked side's stone ringed in red with "CHECK" beside it; every word whole, on one line. | not run |
| TURN-03 | P2 | mouse | Each move is announced ([the answer arrives](../game-page/turn-indicator.md#the-answer-arrives)). | Started game. | 1. Inspect the move announcement in the accessibility tree.<br>2. White plays `Bb1-Cb1`. | 1: a polite status region, empty. 2: "White pawn Bb1 to Cb1. Black to move." on White's page, "…Your move." on Black's. | not run |
| TURN-04 | P2 | second player | After checkmate the pill gives the result from each side ([the answer arrives](../game-page/turn-indicator.md#the-answer-arrives)). | New game. | 1. Play `Ad1-Ac3`, `Ec4-Cc2`, `Ac2-Ad1`, `Cc2-Bb1`. | Black's pill: "Checkmate · you win"; White's: "Checkmate · you lose"; then the dialogs "You win" and "You lose". | not run |

## game-page/move-list.md

These rows were rewritten for the move card at `f7bff4d` and have not been run by hand yet.

| ID | P | Device | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LIST-01 | P1 | second player | With Keyboard play on, the card lists pairs in cell notation ([the simple case](../game-page/move-list.md#the-simple-case)). | Started game; White turns Keyboard play on (gear, Play). | 1. Play `Ab2-De5`, `Ed4-Ba1`. | White's card: one row "1  Ab2–De5  Ed4–Ba1" under a porcelain and a charcoal stone, the latest move brightest. | not run |
| LIST-02 | P1 | mouse | With the setting off nothing shows, but the list is in the page ([begin](../game-page/move-list.md#begin)). | Started game, two moves played, Keyboard play off. | 1. Look at the bottom left.<br>2. Inspect the accessibility tree. | 1: nothing. 2: a list named "Move history" with the moves. | not run |
| LIST-03 | P2 | mouse | Tab brings up the move box alone ([the move box](../foundations/input-model.md#the-move-box)). | Started game, Keyboard play off. | 1. Press Tab.<br>2. Press Escape. | 1: the field appears at the bottom left with its hint, focused. 2: it goes. | not run |
| LIST-04 | P2 | narrow | On a phone the card never covers the board ([keyboard, touch, and screen size](../game-page/move-list.md#interactions-with-other-systems)). | Keyboard play on, twelve moves played, at 390 × 664, 360 × 640 and 640 × 360. | 1. Look at the card and the tower. | Upright: one sideways line of moves across the bottom, below the tower. On its side: the card at the bottom right, beside the tower. | not run |

## game-page/error-banner.md

| ID | P | Device | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BANNER-01 | P1 | mouse | The banner shows "Error: {message}" with "✕", stays until dismissed, and comes back with the next error ([the simple case](../game-page/error-banner.md#the-simple-case)). | A full game; a third context on its link. | 1. Click "Join Game".<br>2. Wait 3 s.<br>3. Click "✕".<br>4. Click "Join Game" again. | 1–2: "Error: Game full" stays. 3: gone. 4: back. | pass |
| BANNER-02 | P2 | second player | A later success does not hide the banner ([the answer arrives](../game-page/error-banner.md#the-answer-arrives)). | White to move; provoke "Error: Not your turn" (see MOVE-07). | 1. Let Black move, then White move. | The banner is still there after both moves. | pass (banner after both moves: ["Error: Not your turn✕"]) |
| BANNER-03 | P2 | keyboard | The end-game dialog covers the banner and puts it out of reach ([edge cases](../game-page/error-banner.md#edge-cases)). | New game; an error showing on White's page (see the note at the top). | 1. Play `Ad1-Cc1`, `Dc5-Bc3`, `Bc1-Ad1`, `Bc3-Ab2`.<br>2. On White's page press Tab several times.<br>3. Click where the "✕" shows through. | 1: the end-game dialog opens with focus on "Start new game"; the banner is visible behind the backdrop, darkened. 2: focus never reaches "✕". 3: the banner stays. | pass (focus on open: BUTTON:Start new game; point over the banner covered by the dialog: true; Tab: BODY > BUTTON:Start new game > BODY > BUTTON:Start new game > BODY > BUTTON:Start new game) |
| BANNER-04 | P2 | mouse | The banner is drawn under the promotion dialog and is out of reach while it is open ([cancel and interrupt](../game-page/error-banner.md#cancel-and-interrupt)). | The promotion line (as for PROMO-01); an error showing on White's page. | 1. Open the promotion dialog.<br>2. Click where the "✕" shows through.<br>3. Click "✕". | 1: the banner stays, darkened, under the dialog. 2: the click lands on the dialog's backdrop, so the promotion is cancelled; the banner is unchanged. 3: the banner is dismissed. | pass (1: banner darkened under the backdrop: true; 2: promotion cancelled (the click landed on the backdrop), nothing sent, 0 selected, banner unchanged; 3: "✕" dismissed it) |
| BANNER-05 | P2 | second tab, drop | A rejoin refused because another tab holds the seat shows the replaced dialog, not the banner ([the answer arrives](../game-page/error-banner.md#the-answer-arrives)). | As TAB-02. | 1. Run TAB-02's steps.<br>2. Look at the bottom of the first tab. | The first tab shows the replaced dialog; no "Error: This game is open in another tab" appears in the banner. | pass (first tab: replaced dialog, no banner (no role=alert at all); second tab: board, no dialog) |
| BANNER-06 | P3 | narrow | In a narrow window the banner takes a row of its own above the move box and the move list ([begin](../game-page/error-banner.md#begin)). | LIST-05. | 1. Measure the banner. | Centered on its own row directly above the move box and the move list, overlapping neither. | pass (banner x 61..314, y 511..555, centre 187.5; gap to the row below 8 px) |

Verified against 3D Chess commit `4e18386`
