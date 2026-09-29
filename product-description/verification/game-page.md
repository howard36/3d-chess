# Verification: game page

How to run this file: bring up the local server and client as in [the protocol](README.md#how-to-run-a-pass). Unless a row says otherwise, the setup is a started game in two browser contexts, at the default view, in a 1280 × 720 window. `narrow` is a 375 × 667 window. Device values are defined in [devices and conditions](README.md#devices-and-conditions). To put an error in the banner on the player's own page, use MOVE-07's double click, or send a second `create_game` on the page's connection from the console as in ERR-01.

## game-page/seat-and-opponent-status.md

These rows were rewritten for the turn pill at `f7bff4d` and have not been run by hand yet.

| ID | P | Device | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SEAT-01 | P1 | mouse | The player's stone stands at the left end of the pill in their army's material ([the seat appears](../game-page/seat-and-opponent-status.md#the-seat-appears)). | Started game. | 1. Look at both pills. | White's page: a porcelain stone at the left, a charcoal one at the right; Black's page: the reverse. No words name either color. | not run |
| SEAT-02 | P1 | second player | Presence shows only when the opponent is not connected ([the opponent leaves and returns](../game-page/seat-and-opponent-status.md#the-opponent-leaves-and-returns)). | Started game. | 1. Look at White's pill.<br>2. Close Black's page.<br>3. Reopen its link. | 1: "Opponent" (or "Their move") and a filled charcoal stone. 2: the stone becomes an outline and the word "Offline". 3: back as in 1. | not run |
| SEAT-03 | P2 | narrow | On a phone held upright the pill fills the top row, and nothing overlaps ([the turn indicator](../game-page/turn-indicator.md#begin)). | Started game in a 390 × 844 window. | 1. Look at the top of the window. | The pill from 12 px at the left to 12 px at the right; both stones and words whole. | not run |
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

The captured pieces (TURN-05 to TURN-08) were added with them and checked by the tools and tests named in the turn indicator's open questions, not yet by hand.

| ID | P | Device | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TURN-05 | P1 | second player | Each side's captures hang under its half, in the taken army's material, from the first capture ([the pieces each side has taken](../game-page/turn-indicator.md#the-pieces-each-side-has-taken)). | New game. | 1. Look under both pills.<br>2. Play `Ab2-De5` (White's unicorn takes a pawn). | 1: nothing under either pill. 2: as the unicorn starts its glide, White's pill shows a charcoal pawn under White's stone at the left and "+1" beside it; Black's pill shows the same pawn and "+1" under the opponent's stone at the right. | not run |
| TURN-06 | P2 | second player | Kinds are grouped, most valuable first, with counts, and the lead sits on the side ahead ([the pieces each side has taken](../game-page/turn-indicator.md#the-pieces-each-side-has-taken)). | New game. | 1. Play `Ab2-De5`, `Ed4-Ba1`, `Ac2-Cc4`, `Dc4-Dc3`, `Ad2-Dd5`, `Ec4-Dd5`, `Aa1-Ba1`. | White's pill, left: a charcoal unicorn, then a charcoal pawn with "2", then "+1"; right: a porcelain bishop at the outer end, then a porcelain pawn. Black's pill: the same two hauls on the other sides. | not run |
| TURN-07 | P2 | narrow | The captures never cover the tower, and fit under the pill ([the pieces each side has taken](../game-page/turn-indicator.md#the-pieces-each-side-has-taken)). | A long game with many captures, at 360 × 640, 390 × 844, 640 × 360 and 1280 × 720, both seats. | 1. Look at the top of the window. | Upright and wide: the captures in one row under the pill, within its width. On the side (640 × 360): one above the other under the pill at the top left. At no size does a capture row touch a piece or a level, file or rank label. | not run |
| TURN-08 | P2 | mouse | The captures are read, not announced ([the pieces each side has taken](../game-page/turn-indicator.md#the-pieces-each-side-has-taken)). | The position after TURN-06. | 1. Inspect the accessibility tree after the pill.<br>2. Play a capture. | 1: "You have taken a unicorn and 2 pawns; you are 1 ahead." and "Your opponent has taken a bishop and a pawn." as text; the silhouettes hidden. 2: only the move announcement is announced. | not run |

## game-page/move-list.md

These rows were rewritten for the move card at `f7bff4d` and again when the Notation panel was removed (the move card is now never shown as a panel); they have not been run by hand yet.

| ID | P | Device | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LIST-02 | P1 | mouse | No move list shows, but the list is in the page ([begin](../game-page/move-list.md#begin)). | Started game, two moves played. | 1. Look at the bottom left.<br>2. Inspect the accessibility tree. | 1: nothing. 2: a list named "Move history" with the moves. | not run |
| LIST-03 | P2 | mouse | Tab brings up the move box alone ([the move box](../foundations/input-model.md#the-move-box)). | Started game. | 1. Press Tab.<br>2. Press Escape. | 1: the field appears at the bottom left with its hint, focused. 2: it goes. | not run |
| LIST-04 | P3 | narrow | Where the move box appears follows the window ([keyboard, touch, and screen size](../game-page/move-list.md#interactions-with-other-systems)). | Started game, at 390 × 664, 1024 × 768 and 640 × 360. | 1. Press Tab.<br>2. Look at the box. | Upright and in a window no wider than 13:9: the box across the bottom. On its side (640 × 360): at the bottom right, beside the tower. In a wide window: at the bottom left. | not run |

## game-page/error-banner.md

| ID | P | Device | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BANNER-01 | P1 | mouse | The banner shows "Error: {message}" with "✕", stays until dismissed, and comes back with the next error ([the simple case](../game-page/error-banner.md#the-simple-case)). | A full game; a third context on its link. | 1. Click "Join Game".<br>2. Wait 3 s.<br>3. Click "✕".<br>4. Click "Join Game" again. | 1–2: "Error: Game full" stays. 3: gone. 4: back. | pass |
| BANNER-02 | P2 | second player | A later success does not hide the banner ([the answer arrives](../game-page/error-banner.md#the-answer-arrives)). | White to move; provoke "Error: Not your turn" (see MOVE-07). | 1. Let Black move, then White move. | The banner is still there after both moves. | pass (banner after both moves: ["Error: Not your turn✕"]) |
| BANNER-03 | P2 | keyboard | The end-game dialog covers the banner and puts it out of reach ([edge cases](../game-page/error-banner.md#edge-cases)). | New game; an error showing on White's page (see the note at the top). | 1. Play `Ad1-Cc1`, `Dc5-Bc3`, `Bc1-Ad1`, `Bc3-Ab2`.<br>2. On White's page press Tab several times.<br>3. Click where the "✕" shows through. | 1: the end-game dialog opens with focus on "Start new game"; the banner is visible behind the backdrop, darkened. 2: focus never reaches "✕". 3: the banner stays. | pass (focus on open: BUTTON:Start new game; point over the banner covered by the dialog: true; Tab: BODY > BUTTON:Start new game > BODY > BUTTON:Start new game > BODY > BUTTON:Start new game) |
| BANNER-04 | P2 | mouse | The banner is drawn under the promotion dialog and is out of reach while it is open ([cancel and interrupt](../game-page/error-banner.md#cancel-and-interrupt)). | The promotion line (as for PROMO-01); an error showing on White's page. | 1. Open the promotion dialog.<br>2. Click where the "✕" shows through.<br>3. Click "✕". | 1: the banner stays, darkened, under the dialog. 2: the click lands on the dialog's backdrop, so the promotion is cancelled; the banner is unchanged. 3: the banner is dismissed. | pass (1: banner darkened under the backdrop: true; 2: promotion cancelled (the click landed on the backdrop), nothing sent, 0 selected, banner unchanged; 3: "✕" dismissed it) |
| BANNER-05 | P2 | second tab, drop | A rejoin refused because another tab holds the seat shows the replaced dialog, not the banner ([the answer arrives](../game-page/error-banner.md#the-answer-arrives)). | As TAB-02. | 1. Run TAB-02's steps.<br>2. Look at the bottom of the first tab. | The first tab shows the replaced dialog; no "Error: This game is open in another tab" appears in the banner. | pass (first tab: replaced dialog, no banner (no role=alert at all); second tab: board, no dialog) |

Verified against 3D Chess commit `4e18386`
