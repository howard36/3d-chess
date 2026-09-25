# The input model

## Summary

This document owns how the player's input reaches the game: what a press on the 3D board does and when, which of the many things under the pointer receives it, when the board accepts presses at all, how HTML controls and the keyboard behave, and what the eleven interrupt events in every document's [cancel and interrupt](../README.md#document-template) table mean. It has no feature of its own; every document about the board or the game page relies on it.

The one rule to remember: **the board acts on the press, not on the release.** Selecting a piece, clearing a selection, and playing a move all happen the instant a button or finger goes down, before anyone can tell whether the player meant to click or to drag the view.

## A press acts at once

A [press](../glossary.md#input) is a pointer going down over the board: the left, middle, or right mouse button, a finger, or a pen. Every one of them is treated the same way, and each is resolved immediately:

- If it lands on a [legal destination](../glossary.md#moves-and-the-rules) of the selected piece, the move is played at once (or, for a promotion square, the [promotion dialog](../play/promotion.md) opens).
- If it lands on one of the player's own pieces that can move now, that piece becomes the [selection](../glossary.md#selection-and-board-state).
- If it lands anywhere else inside the board, the selection is [cleared](../glossary.md#selection-and-board-state).
- If it misses the board entirely (the background around the cube), nothing happens to the selection.

Only then does the press go on to become whatever the pointer does next. If the pointer moves before release, the press becomes a drag and [turns the view](the-view.md#turning-the-view): a left drag orbits, a right drag pans, a middle drag zooms. The drag never undoes what the press already did. In particular:

- A drag that starts on a legal destination has already played that move. Right-dragging to pan across a highlighted cell plays it just the same.
- A drag that starts on an empty part of the board has already cleared the selection. To turn the view while keeping a piece selected, the drag has to start on the background outside the cube, or on the selected piece itself, or be done with the wheel.
- A second finger landing on the board (to pinch or two-finger pan) is a press of its own and is resolved the same way.

The wheel is not a press. Zooming with the wheel, or with a trackpad's scroll or pinch gesture where the browser reports it as a wheel, never selects, clears, or moves anything.

The browser's context menu never opens over the board: a right press is taken by the view.

> Technical note: The board listens for pointer-down events on its 3D objects, while the camera controls listen to the same pointer on the canvas. Both receive every press; neither knows about the other. That is why a press that begins a drag has already acted on the board.

These look like hazards rather than design, and are listed under [open questions](#open-questions-and-verification).

## What takes a press

The board is a lattice of 125 cells seen in perspective, so the point under the pointer usually has several cells and pieces behind it. The press follows the line from the camera through the pointer into the board and meets things in order, nearest first:

1. **The first piece or legal destination on the line takes the press.** Nothing behind it sees the press.
   - A legal destination plays the move. This includes a destination holding an opponent's piece: the cell's surface is in front of the piece standing in it, so the capture is taken, not the piece.
   - One of the player's own pieces that can move now becomes the selection, whether or not another piece was selected; pressing the already selected piece keeps it selected.
   - Any other piece (the opponent's, or any piece while it is not the player's turn) takes the press and does nothing with it.
2. **Every other cell the line enters before that point clears the selection.** A cell a piece stands in is entered before the piece itself, so pressing any piece that cannot be selected clears the current selection. When the press goes on to select a piece or play a move, the clearing makes no difference.
3. **Markers, fills, rings, the lattice lines, and a captured piece that is fading out are never hit.** A press passes through them as if they were not there. A piece in the middle of its [glide](../glossary.md#selection-and-board-state) is hit where it is drawn at that moment.

Two consequences shape how the game feels:

- **A piece in front of a destination blocks it.** If one of the player's own pieces stands between the camera and the destination, pressing there selects that piece instead; if an opponent's piece stands there, the press does nothing except clear the selection. The player has to turn the view until the destination is in clear sight. Empty cells in front of a destination do not block it.
- **Only the destination's own box counts.** A destination's highlighted fill and dot sit inside its cell; pressing just beside the dot, still within the cell, plays the move, while pressing the thin gap between two cells may reach a different cell behind.

The HTML panels laid over the board are in front of all of this. The [turn indicator](../game-page/turn-indicator.md) lets presses through. The [seat label](../game-page/seat-and-opponent-status.md), the [move list](../game-page/move-list.md), and the banners do not: a press on them never reaches the board or the view, whatever lies behind. The promotion dialog, the end-game dialog, and the replaced dialog cover the whole window and block the board completely.

## When the board takes input

[The board takes input](../glossary.md#selection-and-board-state) only while all three of these hold:

1. the connection is *connected* (not connecting, reconnecting, or replaced);
2. the move record is not [frozen](../cross-cutting/broken-game-record.md);
3. none of this player's own moves is in flight (the board is not [held](../glossary.md#selection-and-board-state)).

While it does not, presses on pieces and destinations do nothing, and nothing looks different about the board itself: pieces are drawn as usual, and the only signs are the banner or dialog that explains why and the absence of any reaction to a press. The moment the board stops taking input, any selection is cleared and the promotion dialog closes. The view can always be turned.

Whose turn it is does not decide whether the board takes input. On the opponent's turn the board takes input, but none of the player's pieces can be selected, so presses only clear (there is nothing to clear) or do nothing.

The board also cannot be used while a dialog covers it: the promotion dialog, the end-game dialog, the replaced dialog, and the [crash screen](screens-and-navigation.md#the-crash-screen). These do not change whether the board takes input; they simply stand in front of it.

## HTML controls and the keyboard

Buttons and links behave as they do on any web page: they act on click (release), can be reached with Tab, and are activated with Enter or Space. The app's buttons are "Start New Game", "Join Game", the error banner's "✕" ("Dismiss error"), the five piece buttons and "Cancel" in the promotion dialog, "Start new game" in the end-game dialog, "Play here" in the replaced dialog, and the crash screen's "Back to start" link.

The only key the app handles itself is **Escape**, and only in the promotion dialog, only while keyboard focus is inside it; there it cancels the promotion. There are no keyboard shortcuts, the board cannot be navigated or played from the keyboard, and the arrow keys do not move the view. What this means for players who cannot use a pointer is in [accessibility](../cross-cutting/accessibility.md).

Shift, Ctrl, Cmd, and Alt change nothing about a press on the board or a click on a button. Shift, Ctrl, or Cmd held during a left drag pans the view instead of orbiting it, and during a right drag orbits instead of panning; see [the view](the-view.md#turning-the-view).

## The interrupt events

Every feature document has the same eleven-row [cancel and interrupt](../README.md#document-template) table. Each row means exactly this:

| Row | What counts | What it is, in the glossary's terms |
| --- | --- | --- |
| Escape or Cancel | Escape (handled only by the promotion dialog), the promotion dialog's "Cancel" button, and a click on the promotion dialog's darkened backdrop. No other part of the app has a cancel. | [Cancel](../glossary.md#events-that-end-or-interrupt-a-request) |
| Pressing elsewhere or turning the view | Any press on the board, any drag or wheel turn of the view, and clicks on other HTML controls (dismissing an error, scrolling the move list). | The player doing something else; may clear a selection |
| Leaving the game page within the app | Browser Back or Forward between the app's two pages, the end-game dialog's "Start new game", and the crash screen's "Back to start" (which reloads the app at `/`). Arriving at the start screen by any of these [resets](../glossary.md#events-that-end-or-interrupt-a-request) the connection. | Interrupt |
| The game ends | This browser, replaying the record after a move arrives, finds checkmate or stalemate. The end-game dialog then covers the page. | Interrupt |
| The server answers with an error | The server refuses a request; see [error messages](../cross-cutting/error-messages.md). | [Complete](../glossary.md#events-that-end-or-interrupt-a-request) (refused) |
| The connection drops | Anything that closes the connection without the player asking: the network going away, the server restarting or being redeployed, the one-hour limit, or a server fault. All look the same to the player: the [retry schedule](connection-and-seat.md#connection-states) starts. | Interrupt |
| The window loses focus or the tab is hidden | Switching to another application or tab, or minimizing the window. The connection stays open. Animations pause while the tab is hidden and resume where they left off; the browser may slow the retry schedule in a hidden tab. | Usually no effect |
| Reload or closing the tab | Reload, closing the tab or window, typing another address, or following a link off the app. Everything in the page is lost except the [stored seat](connection-and-seat.md#the-stored-seat); the server notices the connection closing. | Interrupt |
| The opponent acts | The opponent's move arrives, the opponent joins, or the opponent's connection drops or returns. | Interrupt when it changes the position |
| Another tab takes the seat | Another tab or window of the same browser opens the same game, or clicks "Play here" there. This tab becomes [replaced](../session/second-tab.md). | Interrupt |
| A second touch point or a cancelled touch | A second finger landing (itself a press, see above), or the browser or system cancelling a touch in progress. A cancelled touch has already done whatever its press did; cancelling ends only the drag. | Usually no effect |

"Before sending" and "while in flight" are the two columns. A request that has not been sent can be discarded by any interrupt without trace. A request in flight cannot be recalled: an interrupt only decides whether the player sees its answer.

## Open questions and verification

- The press-acts-at-once rule is read from the 3D library's event dispatch and the board's handlers, and is consistent with the end-to-end helpers' model of "the first interactive object on the line takes the click". Whether a middle or right press really selects and moves in every browser was not confirmed by hand.
- A drag intended to turn the view plays a move if it starts on a legal destination. With a Queen or Rook selected, destinations cover much of the board, so a player who selects a piece and then drags to look around can play a move by accident. This may be worth treating as a bug rather than documenting.
- A drag that starts anywhere on the board clears the selection, so the natural sequence "select a piece, turn the view to see where it can go" loses the selection unless the drag starts outside the cube. Same question.
- A second finger landing during a pinch is a press of its own and can play a move. Read from code; not tried on a touch device.
- Whether a trackpad pinch in each browser arrives as a wheel event (safe) or as touch presses (not safe) was not checked.

Verified against 3D Chess commit `d94507b`
