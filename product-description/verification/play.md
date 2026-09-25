# Verification: play

How to run this file: bring up the local server and client as in [the protocol](README.md#how-to-run-a-pass). Unless a row says otherwise, the setup is a **new game with both seats taken** in two browser contexts, with the view at the default. "Play `X-Y`" means the side to move selects `X` and presses `Y`; lines alternate White, Black, White. The **promotion line** is `Ba2-Ba3`, `Ee4-Ee3`, `Ba3-Ca3`, `Ee3-Ee2`, `Ca3-Da4`, `Ee2-Ee1`, after which White's pawn on `Da4` can capture onto White's promotion square `Ea5`. The **mate line** is `Ad1-Cc1`, `Dc5-Bc3`, `Bc1-Ad1`, `Bc3-Ab2` (Black mates). Device values are defined in [devices and conditions](README.md#devices-and-conditions).

## play/making-a-move.md

| ID | P | Device | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| MOVE-01 | P1 | mouse | Selecting a piece draws the ring, the glow, and a marker per destination ([begin](../play/making-a-move.md#begin)). | New game, White's page. | 1. Press the Queen `Bc1`. | Gold ring under the Queen, faint amber glow on it; 14 destination cells tinted amber: 13 with a dot, `Ec4` with a red capture ring. | pass |
| MOVE-02 | P1 | second player | Pressing a legal destination sends the move; markers vanish; the piece glides; the turn passes ([send](../play/making-a-move.md#send), [the answer arrives](../play/making-a-move.md#the-answer-arrives)). | New game. | 1. On White's page select `Bb2`, press `Bb3`. | Markers vanish at the press. The pawn glides to `Bb3` on both pages; `Bb2` and `Bb3` turn teal; both turn indicators read "Black to move"; both move lists read "1. Bb2–Bb3". | pass |
| MOVE-03 | P1 | second player | The player's pieces cannot be selected on the opponent's turn ([modifiers](../play/making-a-move.md#modifiers)). | After MOVE-02. | 1. On White's page press `Bc2`. | Nothing is selected. | pass |
| MOVE-04 | P1 | mouse | A press on an empty part of the board clears the selection ([end without sending](../play/making-a-move.md#end-without-sending)). | White to move, `Bb2` selected. | 1. Press an empty cell in the cube (for example over `Cc3`), without dragging. | Nothing is selected; no move was sent. | pass |
| MOVE-05 | P2 | keyboard | Escape does not clear a selection ([end without sending](../play/making-a-move.md#end-without-sending)). | `Bb2` selected. | 1. Press Escape. | `Bb2` is still selected. | pass |
| MOVE-06 | P1 | mouse | A capture is played by pressing the opponent's piece itself ([send](../play/making-a-move.md#send)). | New game, White's page. | 1. Select the Queen `Bc1`.<br>2. Press the Black pawn on `Ec4` itself (not the ring). | The Queen glides to `Ec4` and the pawn fades; move list "1. Bc1–Ec4". | pass |
| MOVE-07 | P2 | mouse | A second press on a destination within a few tens of milliseconds also sends the move, and the copy is refused; a slower double press sends one ([while in flight](../play/making-a-move.md#while-in-flight)). | White to move, `Bb2` selected. | 1. Press `Bb3` twice with no pause between presses.<br>2. Dismiss the error, let Black reply, select `Bc2`, and press `Bc3` twice 100 ms apart. | 1: one move recorded, "Error: Not your turn" in the banner. 2: one move recorded, no error. | pass (the first draft said a double press sends one move; the product sent two (0 and 20 ms gaps), the document was revised, and the revised claim passes. 0 ms gap: ["Error: Not your turn✕"]; 100 ms gap: no error) |
| MOVE-08 | P1 | mouse | A right or middle press on a destination plays the move too ([edge cases](../play/making-a-move.md#edge-cases)). | White to move, `Bb2` selected. | 1. Right-click `Bb3`. | The move is played. | pass |
| MOVE-09 | P2 | drop | A move sent just before a drop is settled by the snapshot ([the answer arrives](../play/making-a-move.md#the-answer-arrives)). | White to move, `Bb2` selected. | 1. Press `Bb3` and drop the connection at once.<br>2. Let it reconnect. | After reconnecting: either the move is on the board (it glides in) and "Black to move", or it is not and "White to move" with the board taking input. Record which. | pass (after reconnect: "Black to move", list includes Be2–Be3) |
| MOVE-10 | P2 | mouse | A piece with no legal move is still selectable ([begin](../play/making-a-move.md#begin)). | New game. | 1. Press White's King `Ac1`. | Ring and glow, no destinations. | pass |

Not checkable by hand:

- The held board while a move is in flight: on a local server the echo arrives within a frame, so there is no window to press in. Covered by `client/src/App.test.tsx`.
- "Error: Not your turn" after a reconnect: depends on pressing within one round trip of the connection reopening.

## play/promotion.md

| ID | P | Device | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PROMO-01 | P1 | second player | Pressing the promotion square opens "Promote to" and sends nothing ([begin](../play/promotion.md#begin)). | The promotion line. | 1. On White's page select `Da4`.<br>2. Press `Ea5`. | A dialog "Promote to" with buttons "Queen", "Rook", "Bishop", "Knight", "Unicorn", then "Cancel". The turn indicator behind still reads "White to move"; Black's page is unchanged. | pass |
| PROMO-02 | P1 | keyboard | The dialog tries to focus "Queen", but the press that opened it takes focus back to the page ([begin](../play/promotion.md#begin)). | PROMO-01's dialog open, opened with the mouse. | 1. Read the focused element. | The page body has focus; no dialog button does. | pass (the first draft said "Queen" has focus; the focus log showed focus in and straight out; document revised) |
| PROMO-03 | P1 | mouse | Cancel closes the dialog, sends nothing, and leaves nothing selected ([end without sending](../play/promotion.md#end-without-sending)). | Dialog open. | 1. Click "Cancel".<br>2. Press `Da4`. | 1: dialog gone, nothing selected, still "White to move". 2: `Da4` selects again with its three destinations. | pass |
| PROMO-04 | P1 | keyboard | Escape cancels once focus is in the dialog, which takes one Tab ([end without sending](../play/promotion.md#end-without-sending)). | Dialog open, nothing focused. | 1. Press Escape.<br>2. Press Tab, then Escape. | 1: the dialog stays. 2: "Queen" is focused after the Tab; Escape closes the dialog; nothing sent. | pass (the first draft said Escape works at once; it did not until a Tab; document revised) |
| PROMO-05 | P1 | mouse | A click on the backdrop cancels; a click on the panel between buttons does not ([end without sending](../play/promotion.md#end-without-sending)). | Dialog open. | 1. Click the white panel beside the heading.<br>2. Click the dark backdrop. | 1: dialog stays. 2: dialog gone; nothing sent. | pass |
| PROMO-06 | P2 | keyboard | After a click on the panel, Escape no longer cancels ([edge cases](../play/promotion.md#edge-cases)). | Dialog open. | 1. Click the white panel beside the heading.<br>2. Press Escape. | Record what happens. Per the document: the dialog stays. | pass (after a Tab into the dialog, a click on the panel left focus on BODY; Escape then did nothing) |
| PROMO-07 | P1 | second player | Picking a piece sends the move; the new piece glides from the pawn's cell ([send](../play/promotion.md#send), [the answer arrives](../play/promotion.md#the-answer-arrives)). | Dialog open. | 1. Click "Unicorn". | Dialog gone. On both pages a Unicorn glides from `Da4` to `Ea5`, the Black Rook there fades, both move lists end with `Da4–Ea5=U`, both read "Black to move". | pass (glide seen: 1) |
| PROMO-08 | P2 | keyboard | Enter right after opening does nothing; after one Tab it promotes to a Queen ([edge cases](../play/promotion.md#edge-cases)). | The promotion line, dialog open. | 1. Press Enter.<br>2. Press Tab, then Enter. | 1: nothing happens. 2: the move lists end with `Da4–Ea5=Q`; a Queen stands on `Ea5`. | pass (the first draft said Enter at once promotes to a Queen; it did nothing; document revised) |
| PROMO-09 | P1 | drop | A drop closes the dialog, and it does not come back ([end without sending](../play/promotion.md#end-without-sending)). | Dialog open. | 1. Drop the connection.<br>2. Let it reconnect. | The dialog closes at the drop and is not there after reconnecting; still "White to move"; nothing selected. | pass |
| PROMO-10 | P3 | narrow | The piece buttons wrap on a narrow window ([begin](../play/promotion.md#begin)). | Dialog open in a 375 px window. | 1. Look at the dialog. | The five buttons wrap onto more than one line; the dialog fits the window. | blocked (at 375x667 the harness could not reach the cells needed to play the promotion line (the narrow view crops the board, see SIZE-01)) |

Not checkable by hand:

- The error and reconnecting banners drawn above the dialog's backdrop and clickable: needs an error to arrive while the dialog is open.

## play/the-opponents-move.md

| ID | P | Device | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| OPP-01 | P1 | second player | On the opponent's turn nothing can be selected, and the view still turns ([begin](../play/the-opponents-move.md#begin)). | New game; Black's page. | 1. Press several Black pieces.<br>2. Drag the view. | Nothing selected; the view turns. | pass |
| OPP-02 | P1 | second player | The opponent's move lands with a glide, a fade, the teal trace, the list, and the turn ([the answer arrives](../play/the-opponents-move.md#the-answer-arrives)). | New game; watch Black's page. | 1. White plays `Bc1-Ec4`. | On Black's page: the White Queen glides to `Ec4`, the Black pawn fades, `Bc1` and `Ec4` turn teal, "1. Bc1–Ec4" in the list, "Black to move", Black's King glows red. | pass |
| OPP-03 | P1 | drop | A move made while the player is reconnecting arrives in the snapshot and glides ([the answer arrives](../play/the-opponents-move.md#the-answer-arrives)). | New game. | 1. Drop Black's connection and hold it.<br>2. White plays `Bb2-Bb3`.<br>3. Release Black's connection. | On Black's page after reconnecting: the pawn glides to `Bb3`, "Black to move". | pass (glide wrapper present right after the snapshot: 1) |
| OPP-04 | P1 | second player | A move made while the player was away is in place, without a glide, on return ([the answer arrives](../play/the-opponents-move.md#the-answer-arrives)). | New game. | 1. Close Black's page.<br>2. White plays `Bb2-Bb3`.<br>3. Reopen the link in Black's context. | The pawn is on `Bb3` at once, teal on `Bb2` and `Bb3`, no glide, "Black to move". | pass (checked as: opponent moved, then this player reopened the game; move in place, no glide) |
| OPP-05 | P2 | second player | The opponent going offline and back shows only in the presence line ([end without sending](../play/the-opponents-move.md#end-without-sending)). | White to move; watch Black's page. | 1. Reload White's page. | Black's page: "Opponent: offline", then "Opponent: online"; nothing else changes. | pass |

Not checkable by hand:

- The glide playing when a hidden tab is shown again: headless and occluded windows stop drawing.
- The absence of any sound or browser notification: an absence.

## play/check-and-game-end.md

| ID | P | Device | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| END-01 | P1 | second player | A King in check glows red on both boards and goes out when the check ends ([check](../play/check-and-game-end.md#check)). | New game. | 1. White plays `Bc1-Ec4`.<br>2. Black plays `Ec5-Ec4`. | 1: Black's King red on both pages. 2: no King red. | pass (glow before ["#ff2222","#ff2222"], after ["#000000","#000000"]) |
| END-02 | P1 | second player | Checkmate shows the same heading to both players, with only "Start new game" ([checkmate and stalemate](../play/check-and-game-end.md#checkmate-and-stalemate)). | The mate line. | 1. Read both pages. | Both: "Black wins by checkmate!" and one button, "Start new game". | pass |
| END-03 | P1 | keyboard | The dialog cannot be dismissed ([checkmate and stalemate](../play/check-and-game-end.md#checkmate-and-stalemate)). | END-02. | 1. Press Escape.<br>2. Click the backdrop. | The dialog stays. | pass |
| END-04 | P1 | mouse | Behind the dialog the view cannot be turned ([edge cases](../play/check-and-game-end.md#edge-cases)). | END-02. | 1. Drag across the backdrop.<br>2. Turn the wheel over the move list. | Nothing moves. | pass |
| END-05 | P2 | mouse | Behind the dialog the turn indicator names the mated side ([edge cases](../play/check-and-game-end.md#edge-cases)). | END-02. | 1. Read the turn indicator through the backdrop. | "White to move". | pass |
| END-06 | P1 | second player | "Start new game" goes to the start screen and the opponent sees the player go offline ([send](../play/check-and-game-end.md#send)). | END-02. | 1. On White's page click "Start new game". | White's page: the start screen, "Start New Game" enabled. Black's page (through its backdrop): "Opponent: offline". | pass (END-09 also checked: Start New Game then created a new game with a new id) |
| END-07 | P1 | mouse | A finished game reopens straight to the dialog, without the final glide ([end without sending](../play/check-and-game-end.md#end-without-sending)). | END-02. | 1. Reload Black's page. | The dialog is there as soon as the board appears; no glide. | pass |
| END-08 | P2 | keyboard | Focus is not moved into the dialog ([modifiers](../play/check-and-game-end.md#modifiers)). | END-02. | 1. Read the focused element. | The page body, not "Start new game". | pass |
| END-09 | P2 | mouse | "Start new game" does not create a game ([the answer arrives](../play/check-and-game-end.md#the-answer-arrives)). | END-06. | 1. Click "Start New Game" on the start screen. | A new game page with a new id; the old game is untouched. | pass (checked within END-06: "Start New Game" then created a game with a new id) |

Not checkable by hand:

- "Draw by stalemate!": no short stalemate line from the starting position is known.
- Whether the dialog should be dismissible is a product call.

Verified against 3D Chess commit `d94507b`
