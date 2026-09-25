# Promotion

## Summary

Promotion is the choice a player makes when one of their pawns reaches a [promotion square](../foundations/game-rules.md#promotion): which piece it becomes. Pressing a promotion square as a pawn's destination opens a small dialog, "Promote to", with one button per piece; the move is sent only when the player picks one, and can be abandoned with Cancel, Escape, or a click outside the dialog. It lives on the board screen, over the board, and appears only on the player's own turn while [the board takes input](../foundations/input-model.md#when-the-board-takes-input). This document owns the dialog, from pressing the promotion square to picking or cancelling; once a piece is picked, the move is in flight exactly as in [making a move](making-a-move.md).

## The simple case

The player's pawn is one step from its promotion square, and they select it. The promotion square is marked like any other destination: one dot, or one capture ring if an opponent's piece stands there. The player presses it.

The board darkens behind a white dialog titled "Promote to", with five buttons, "Queen", "Rook", "Bishop", "Knight", and "Unicorn", and a smaller gray "Cancel" below them. Nothing has been sent yet, and the pawn has not moved; the turn indicator, hidden behind the darkened backdrop, still names the player.

The player clicks "Unicorn". The dialog closes and the move is sent. A moment later, on both boards, a Unicorn glides from the pawn's cell to the promotion square (the pawn does not travel and then change; the new piece travels), the teal trace marks the two cells, the move list shows the move with "=U" after it, for example `Da4–Ea5=U`, and the turn passes to the opponent.

## The interaction, event by event

```mermaid
stateDiagram-v2
    state "Pawn selected" as selected
    state "Promote to (dialog open)" as dialog
    state "Move in flight (board held)" as flight
    state "Your turn, nothing selected" as idle
    [*] --> selected
    selected --> dialog : press the promotion square (selection cleared)
    dialog --> idle : Cancel, Escape, or backdrop click (nothing sent)
    dialog --> idle : position changes or board stops taking input (nothing sent)
    dialog --> flight : pick a piece (move sent)
    flight --> [*] : echo arrives (new piece glides), see making a move
    flight --> idle : error, or drop and the move was not recorded
```

### Begin

The dialog opens when the player presses a promotion square that is a legal destination of their selected pawn, reached by a quiet step or by a capture. Five legal moves lead to that one cell, one per piece; the browser hands all five to the dialog. They are always all five, because which piece a pawn becomes can never make a move legal or illegal.

At the same instant the board clears the selection and its markers, exactly as it does when sending an ordinary move, and the dialog appears:

- a translucent dark backdrop over the whole window;
- a white panel with the heading "Promote to";
- five buttons in a row, in the order Queen, Rook, Bishop, Knight, Unicorn, which wrap onto a second line if the window is narrow;
- a plain gray "Cancel" button below them.

Keyboard focus moves to "Queen". Nothing has been sent, and the board shows the pawn where it was.

### End without sending

The dialog closes without sending in any of these ways:

- **Cancel**: clicking "Cancel".
- **Escape**: pressing Escape while keyboard focus is in the dialog (it is, from the moment it opens, unless the player has clicked somewhere in the panel that is not a button, or tabbed out).
- **The backdrop**: clicking the darkened area outside the white panel. A click on the panel itself, between buttons, does nothing.
- **The position changes**: a new position arrives from the server (a snapshot after a reconnect).
- **The board stops taking input**: the connection drops, another tab takes the seat, or the record freezes. The dialog does not come back when the board takes input again.

In every case nothing is sent and nothing is recorded. The player is back on their own turn with nothing selected: the pawn is not reselected, and the player must press it again to promote (or to move something else instead).

### Send

Clicking one of the five piece buttons (or pressing Enter or Space on it) closes the dialog and sends the move with that piece. From here it is an ordinary move in flight: the board is [held](../glossary.md#selection-and-board-state) and the pawn stays where it is until the server returns the move. See [making a move](making-a-move.md#send).

The server checks the promotion only for its form: it must be one of the five letters Q, R, B, N, and U. It records the move, promotion included, and echoes it to both players.

### While in flight

As in [making a move](making-a-move.md#while-in-flight): the board ignores presses, the view can be turned, and nothing on screen shows the wait. The dialog does not reappear.

### The answer arrives

On the echo, both boards replay the record with the promotion: the chosen piece [glides](../foundations/the-view.md#motion) from the pawn's cell to the promotion square, a captured piece fades under it, the teal trace moves, and the turn passes to the opponent. The [move list](../game-page/move-list.md) shows the move with "=" and the piece's letter: Q for Queen, R for Rook, B for Bishop, N for Knight, U for Unicorn. The new piece is from then on an ordinary piece of its kind. If the promotion gives check or ends the game, that follows as for any move.

An error or a drop is handled as in [making a move](making-a-move.md#the-answer-arrives): an error releases the board with the message in the error banner and the pawn still on its cell; a drop is settled by the next snapshot.

## Modifiers

| Modifier | At the start | Changes while in flight |
| --- | --- | --- |
| Your color | White promotes on rank 5 of level E, Black on rank 1 of level A. The dialog is the same for both. | Cannot change. |
| Whose turn it is | Only on the player's turn; the dialog cannot open otherwise. | The turn changes only when the echo arrives. |
| How you reached the page | No difference. An open dialog never survives a reload or return. | Not applicable. |
| Connection state | The dialog appears only while connected. If the connection drops while it is open, it closes without sending. | A drop is handled as for any move. |
| Game state | In progress or in check: as described (a promotion that does not answer a check is never offered). Over or frozen: no promotion is possible. | Only this move's echo can end the game. |
| Shift, Ctrl, or Cmd held | No effect on the press that opens the dialog, or on the buttons. | No effect. |
| Input device | Mouse or touch: click or tap a button. Keyboard: the dialog is fully usable (Tab between buttons, Enter or Space to pick, Escape to cancel), but the pawn and the square cannot be pressed from the keyboard, so the keyboard can only finish what a pointer began. | No effect. |

## Cancel and interrupt

"Before sending" is while the dialog is open; "while in flight" is after a piece has been picked.

| Event | Before sending | While in flight |
| --- | --- | --- |
| Escape or Cancel | Closes the dialog; nothing sent; nothing selected. Escape works only while keyboard focus is in the dialog. A click on the backdrop does the same. | No effect. The promotion cannot be taken back. |
| Pressing elsewhere or turning the view | The board and the view cannot be reached: the backdrop covers the whole window, and clicking it cancels. The error banner and the reconnecting banner, if showing, sit above the backdrop and can still be clicked. | As in making a move: presses do nothing, the view turns. |
| Leaving the game page within the app | The dialog is lost with the page; nothing sent. | The move is recorded if the server received it; returning shows it in place. |
| The game ends | Cannot happen: nothing can land during the player's own turn. | This move's echo can end the game. |
| The server answers with an error | Not applicable. | The board is released and the error shown; the pawn is still on its cell and nothing is selected. |
| The connection drops | The dialog closes without sending and does not come back. "Reconnecting…" appears. | Settled by the next snapshot, as in making a move. |
| The window loses focus or the tab is hidden | No effect; the dialog stays open, and focus returns to it with the window. | No effect. |
| Reload or closing the tab | The dialog is lost; nothing sent. | The move is recorded if the server received it. |
| The opponent acts | The opponent cannot move during the player's turn. Presence changes do not close the dialog. | Same. |
| Another tab takes the seat | The dialog closes without sending, and the replaced dialog appears. | The echo goes to the other tab; this one learns of the move after "Play here". |
| A second touch point or a cancelled touch | A touch on the backdrop cancels, on a button picks; a cancelled touch does nothing. | No effect. |

## Interactions with other systems

**Seat and turn.** Only the side to move can promote, and only its own pawns.

**The game record.** The promotion is recorded as part of the move (a letter after the destination) and cannot be changed afterwards. Cancelling records nothing.

**Connection.** The dialog exists only while connected; a drop closes it and the choice has to be made again.

**The opponent.** Sees nothing until the move lands, then the new piece gliding in, and the "=" letter in their move list.

**Other tabs and devices.** A replaced tab loses its dialog. The dialog is not shared between tabs.

**Game over.** A promotion can deliver checkmate or stalemate like any move.

**Stored seat.** No role.

**Keyboard, touch, and screen size.** The dialog is keyboard-operable once open, and "Queen" has focus on opening, so Enter promotes to a Queen. Focus is not held inside the dialog: Tab past "Cancel" leaves it, and Escape then no longer works. On a narrow window the five buttons wrap onto two lines.

## Edge cases

- **Every promotion shows the dialog.** There is no automatic Queen and no remembered choice; each promotion asks.
- **Capturing onto the promotion square.** Pressing the opponent's piece on the promotion square opens the dialog like a quiet promotion; the captured piece fades when the move lands.
- **The Queen is the default only for the keyboard.** Focus starts on "Queen", so pressing Enter right away promotes to a Queen; a mouse or touch user has no default.
- **A click inside the panel.** Clicking the white panel between buttons does nothing, but it takes keyboard focus away from the buttons, after which Escape no longer cancels.
- **Promoting to a Knight.** Recorded with the letter N, not K.
- **Several pawns on promotion squares.** Each promotion is its own move with its own dialog; there is no batch.

## Open questions and verification

- Escape works only while focus is inside the dialog, and a click on the panel or a Tab past the last button loses it. There is no focus trap. Read from code; a small accessibility gap, see [accessibility](../cross-cutting/accessibility.md).
- The error and reconnecting banners are drawn above the dialog's backdrop and remain clickable. Read from the drawing order; not confirmed by hand.
- The dialog, its cancel paths, the send, the automatic close on a drop or a new position, and the "=U" in the move list are covered by `client/src/App.test.tsx`, `client/src/three/Board.test.tsx`, and `client/e2e/promotion.spec.ts`.

Verified against 3D Chess commit `d94507b`
