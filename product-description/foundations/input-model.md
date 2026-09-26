# The input model

## Summary

This document owns how the player's input reaches the game: what a press on the 3D board does and when, which of the many things under the pointer receives it, when the board accepts presses at all, how HTML controls, the move box, and the keyboard behave, and what the eleven interrupt events in every document's [cancel and interrupt](../README.md#document-template) table mean. It has no feature of its own; every document about the board or the game page relies on it.

The one rule to remember: **the board acts on a click, not on the pointer going down.** Selecting a piece, clearing a selection, and playing a move all happen when the primary button or finger comes back up where it went down. Anything that moves further first is a drag, and a drag only turns the view.

## A press acts on release

A [press](../glossary.md#input) is a click on the board: the primary (left) mouse button, a finger, or a pen going down and coming back up within 6 pixels of where it went down, on the same piece or cell. Nothing happens while the button is held. On release, the press is resolved:

- If it lands on a [legal destination](../glossary.md#moves-and-the-rules) of the selected piece, the move is played (or, for a promotion square, the [promotion dialog](../play/promotion.md) opens).
- If it lands on one of the player's own pieces that can move now, that piece becomes the [selection](../glossary.md#selection-and-board-state).
- If it lands anywhere else inside the board, the selection is [cleared](../glossary.md#selection-and-board-state).
- If it misses the board entirely (the background around the cube), nothing happens to the selection.

Everything else the pointer can do over the board is a [drag](../glossary.md#input) and only [turns the view](the-view.md#turning-the-view):

- A left drag that travels more than 6 pixels before release orbits the view and does nothing to the board, wherever it started: on a legal destination, on an empty cell, or on a piece. A selection survives it, so "select a piece, then turn the view to see where it can go" works from anywhere on the screen.
- The right button pans and the middle button zooms; neither ever selects, clears, or plays, even without moving. The browser's context menu never opens over the board.
- The wheel, and a trackpad's scroll or pinch where the browser reports it as a wheel, zooms and never touches the selection.
- On a touch screen a one-finger tap is a press. A one-finger drag orbits, and a second finger landing turns the gesture into a pinch or two-finger pan; neither selects, clears, or plays.

A drag of 6 pixels or less still counts as a press: the view may turn by that small amount and the press acts as well. A press whose pointer ends over a different piece or cell than it started on goes only to what was under the pointer both times; usually that means it does nothing, or only clears the selection.

> Technical note: The board handles the 3D library's click events, which fire only for the primary button and only for an object that was under the pointer both when it went down and when it came up. The board also checks the distance the pointer travelled, because the camera controls listen to the same pointer: anything over 6 pixels is taken as a view drag and ignored.

## What takes a press

The board is a lattice of 125 cells seen in perspective, so the point under the pointer usually has several cells and pieces behind it. The press follows the line from the camera through the pointer into the board and meets things in order, nearest first:

1. **The first piece or legal destination on the line takes the press.** Nothing behind it sees the press.
   - A legal destination plays the move. This includes a destination holding an opponent's piece: the cell's surface is in front of the piece standing in it, so the capture is taken, not the piece.
   - One of the player's own pieces that can move now becomes the selection, whether or not another piece was selected; pressing the already selected piece keeps it selected.
   - Any other piece (the opponent's, or any piece while it is not the player's turn) takes the press and does nothing with it.
2. **Every other cell the line enters before that point clears the selection.** A cell a piece stands in is entered before the piece itself, so pressing any piece that cannot be selected clears the current selection. When the press goes on to select a piece or play a move, the clearing makes no difference.
3. **Markers, fills, rings, the lattice lines, and a captured piece that is fading out are never hit.** A press passes through them as if they were not there. A piece in the middle of its [glide](../glossary.md#selection-and-board-state) is hit where it is drawn at that moment.

Two consequences shape how the game feels:

- **A piece in front of a destination blocks it.** If one of the player's own pieces stands between the camera and the destination, pressing there selects that piece instead; if an opponent's piece stands there, the press does nothing except clear the selection. The player has to turn the view until the destination is in clear sight, or type the move in the [move box](#the-move-box). Empty cells in front of a destination do not block it.
- **Only the destination's own box counts.** A destination's highlighted fill and dot sit inside its cell; pressing just beside the dot, still within the cell, plays the move, while pressing the thin gap between two cells may reach a different cell behind.

The HTML panels laid over the board are in front of all of this. Only three of them take the pointer: the [move box](#the-move-box) at the bottom left, the [error banner](../game-page/error-banner.md) at the bottom center, and the [move list](../game-page/move-list.md) at the bottom right. A press on them never reaches the board or the view. Everything else in the [HUD](../glossary.md#input) lets presses through to the board behind it: the [turn indicator](../game-page/turn-indicator.md), the [seat label](../game-page/seat-and-opponent-status.md), the reconnecting banner, the frozen-board banner, and the empty space between panels. The promotion dialog, the end-game dialog, and the replaced dialog cover the whole window and block the board completely.

## When the board takes input

[The board takes input](../glossary.md#selection-and-board-state) only while all four of these hold:

1. the connection is *connected* (not connecting, reconnecting, or replaced);
2. the server has answered this connection's create, join, or [rejoin](connection-and-seat.md#rejoining), so the page holds its seat on the connection it is using; after every reconnect, reload, or "Play here", the board waits for the rejoin's snapshot;
3. the move record is not [frozen](../cross-cutting/broken-game-record.md);
4. none of this player's own moves is in flight (the board is not [held](../glossary.md#selection-and-board-state)).

While it does not, presses on pieces and destinations do nothing, the move box's "Move" button is disabled, and nothing looks different about the board itself: pieces are drawn as usual, and the only signs are the banner or dialog that explains why (or, for the short wait for a snapshot, nothing at all) and the absence of any reaction to a press. The moment the board stops taking input, any selection is cleared and the promotion dialog closes. The view can always be turned.

Whose turn it is does not decide whether the board takes input. On the opponent's turn the board takes input, but none of the player's pieces can be selected, so presses only clear (there is nothing to clear) or do nothing. The move box, by contrast, accepts a move only on the player's own turn.

The board also cannot be used while a dialog covers it: the promotion dialog, the end-game dialog, the replaced dialog, and the [crash screen](screens-and-navigation.md#the-crash-screen). These do not change whether the board takes input; they stand in front of it, and while one of the three dialogs is up, everything behind it (the board and the whole HUD) is inert: it cannot be clicked, reached with Tab, or read by a screen reader.

A very fast second press on a destination can still send the move twice, if it arrives before the page has redrawn after the first; the copy is refused with "Not your turn". See [open questions](#open-questions-and-verification).

## The move box

The move box, at the bottom left of the board screen, is the second way to play a move and the only one that works without a pointer. It is a small dark panel labelled "Type a move (e.g. Ab2-Ab3)", with a text field and a "Move" button. Its full behavior belongs to [making a move](../play/making-a-move.md); for the input model it matters in three ways:

- It is an ordinary HTML form. Typing is always possible; Enter or the "Move" button submits, and the button is disabled unless the board takes input, the game is not over, it is the player's turn, and the field is not empty.
- A move typed there is checked against the same rules as a press and is sent exactly as a pressed move is: the board is held until the echo, and a typed promotion names its piece (`=Q`, `=R`, `=B`, `=N`, or `=U`) and is sent without the promotion dialog.
- A move that cannot be played is not sent; a line of text under the field says why.

## HTML controls and the keyboard

Buttons and links behave as they do on any web page: they act on click (release), can be reached with Tab, and are activated with Enter or Space. The app's buttons are "Start New Game", "Join Game", "Copy link" on the share-link screen, the move box's "Move", the error banner's "✕" ("Dismiss error"), the five piece buttons and "Cancel" in the promotion dialog, "Start new game" in the end-game dialog, "Play here" in the replaced dialog, and the crash screen's "Back to start" link. A disabled button cannot be reached with Tab.

Each dialog puts keyboard focus on its first button when it opens: "Queen" in the promotion dialog, "Start new game" in the end-game dialog, and "Play here" in the replaced dialog. Enter or Space then answers it at once, and Tab moves between the dialog's buttons only, because everything behind it is inert.

The only key the app handles itself is **Escape**, and only in the promotion dialog, while keyboard focus is inside it (which it is from the moment the dialog opens); there it cancels the promotion. There are no keyboard shortcuts, the board cannot be navigated from the keyboard, and the arrow keys do not move the view. A keyboard player plays by typing moves into the move box. The canvas itself is described to screen readers as a picture of the board that says which side is nearest and points to the move box. What this means for players who cannot use a pointer is in [accessibility](../cross-cutting/accessibility.md).

Shift, Ctrl, Cmd, and Alt change nothing about a press on the board or a click on a button. Shift, Ctrl, or Cmd held during a left drag pans the view instead of orbiting it, and during a right drag orbits instead of panning; see [the view](the-view.md#turning-the-view).

## The interrupt events

Every feature document has the same eleven-row [cancel and interrupt](../README.md#document-template) table. Each row means exactly this:

| Row | What counts | What it is, in the glossary's terms |
| --- | --- | --- |
| Escape or Cancel | Escape (handled only by the promotion dialog), the promotion dialog's "Cancel" button, and a click on the promotion dialog's darkened backdrop. No other part of the app has a cancel. | [Cancel](../glossary.md#events-that-end-or-interrupt-a-request) |
| Pressing elsewhere or turning the view | Any press on the board, any drag or wheel turn of the view, and clicks on other HTML controls (dismissing an error, scrolling the move list, typing in the move box). A press may clear a selection; turning the view never does. | The player doing something else |
| Leaving the game page within the app | Browser Back or Forward to the start screen or straight to another game's page, the end-game dialog's "Start new game", and the crash screen's "Back to start" (which reloads the app at `/`). Each of these [resets](../glossary.md#events-that-end-or-interrupt-a-request) the connection. | Interrupt |
| The game ends | This browser, replaying the record after a move arrives, finds checkmate or stalemate. The end-game dialog then covers the page. | Interrupt |
| The server answers with an error | The server refuses a request; see [error messages](../cross-cutting/error-messages.md). | [Complete](../glossary.md#events-that-end-or-interrupt-a-request) (refused) |
| The connection drops | Anything that closes the connection without the player asking: the network going away, the server restarting or being redeployed, the one-hour limit, or a server fault. All look the same to the player: the [retry schedule](connection-and-seat.md#connection-states) starts, and after it succeeds the board waits for the rejoin's snapshot before it takes input. | Interrupt |
| The window loses focus or the tab is hidden | Switching to another application or tab, or minimizing the window. The connection stays open. Animations pause while the tab is hidden and resume where they left off; the browser may slow the retry schedule in a hidden tab. | Usually no effect |
| Reload or closing the tab | Reload, closing the tab or window, typing another address, or following a link off the app. Everything in the page is lost except the [stored seat](connection-and-seat.md#the-stored-seat) and the tab's [client id](connection-and-seat.md#the-client-id) (which a reload keeps and closing the tab loses); the server notices the connection closing. | Interrupt |
| The opponent acts | The opponent's move arrives, the opponent joins, or the opponent's connection drops or returns. | Interrupt when it changes the position |
| Another tab takes the seat | Another tab or window of the same browser opens the same game, or clicks "Play here" there; or this tab's connection returns after a drop and finds the seat held by another tab ([seat in use](connection-and-seat.md#last-connection-wins)). This tab becomes [replaced](../session/second-tab.md). | Interrupt |
| A second touch point or a cancelled touch | A second finger landing, which turns a one-finger gesture into a pinch or two-finger pan, or the browser or system cancelling a touch in progress. Neither ever acts on the board; a cancelled touch simply ends the gesture. | Usually no effect |

"Before sending" and "while in flight" are the two columns. A request that has not been sent can be discarded by any interrupt without trace. A request in flight cannot be recalled: an interrupt only decides whether the player sees its answer.

## Open questions and verification

- The click-on-release rule is read from the 3D library's event dispatch and the board's handlers, and covered by `client/src/three/Board.test.tsx` (a drag over 6 pixels and a right or middle button do nothing; 4 pixels of jitter still plays the move). That a press released over a different object goes only to what was under the pointer both times is the 3D library's rule, not tested here. Whether every browser suppresses the click after a right or middle press, and after a two-finger gesture, was not confirmed by hand.
- A second touch landing during a one-finger gesture should never act, because browsers do not produce a click for a multi-touch gesture. Read from code; not tried on a real touch device.
- Whether a trackpad pinch in each browser arrives as a wheel event or as touches does not matter for the board any more (neither acts on it), but which of zoom or pan it produces was not checked.
- A drag of 6 pixels or less both nudges the view and acts as a press. The threshold is chosen to absorb a finger's jitter; whether it feels right on a trackpad was not checked.
- Two presses on a destination before the page redraws both send the move ([bug-triage B-14](../bug-triage.md), low). With presses now acting on release, a normal double click is probably slow enough for the redraw to come first; not measured.
- The seat label, the reconnecting banner, and the frozen-board banner let presses through to the board, because only the move box, the error banner, and the move list take the pointer. That is read from the page's styles; whether it is intended for the seat label was not asked.

Verified against 3D Chess commit `90142a3`
