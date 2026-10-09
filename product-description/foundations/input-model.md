# The input model

## Summary

This document owns how the player's input reaches the game: what a press on the 3D board does and when, which of the many things under the pointer receives it, when the board accepts presses at all, how HTML controls, the move box, and the keyboard behave, and what the eleven interrupt events in every document's [cancel and interrupt](../README.md#document-template) table mean. It has no feature of its own; every document about the board or the game page relies on it.

The one rule to remember: **the board acts on a click, not on the pointer going down.** Selecting a piece, clearing a selection, and playing a move all happen when the primary button or finger comes back up where it went down. Anything that moves further first is a drag, and a drag only turns the view.

## A press acts on release

A [press](../glossary.md#input) is a click on the board: the primary (left) mouse button, a finger, or a pen going down and coming back up within 6 pixels of where it went down, on the same piece or cell. Nothing happens while the button is held. On release, the press is resolved:

- If it lands on a [legal destination](../glossary.md#moves-and-the-rules) of the selected piece, the move is played (or, for a promotion square, the [promotion dialog](../play/promotion.md) opens).
- If it lands on one of the player's own pieces that can move now, that piece becomes the [selection](../glossary.md#selection-and-board-state); if it lands on the selected piece itself, the piece is put down and the selection [cleared](../glossary.md#selection-and-board-state).
- If it lands on an empty cell that is not a destination, or misses the pieces and cells altogether (the gap between two levels, the garden, the sky), the selection is cleared.
- If it lands on any other piece (the opponent's, where it is not a capture, or any piece while it is not the player's turn), that piece shakes its head and nothing else happens: the selection stays.

Everything else the pointer can do over the board is a [drag](../glossary.md#input) and only [turns the view](the-view.md#turning-the-view):

- A left drag that travels more than 6 pixels before release orbits the view and does nothing to the board, wherever it started: on a legal destination, on an empty cell, or on a piece. A selection survives it, so "select a piece, then turn the view to see where it can go" works from anywhere on the screen.
- The right button does nothing to the view (with Shift, Ctrl, or Cmd it orbits) and the middle button zooms; neither ever selects, clears, or plays, even without moving. The browser's context menu never opens over the board.
- The wheel, and a trackpad's scroll or pinch where the browser reports it as a wheel, zooms and never touches the selection.
- On a touch screen a one-finger tap is a press. A one-finger drag orbits, and a second finger landing turns the gesture into a pinch that zooms; neither selects, clears, or plays. A tap that just misses what it was aimed at is helped by [tap assist](#what-takes-a-press).

A drag of 6 pixels or less still counts as a press: the view may turn by that small amount and the press acts as well. A press whose pointer ends over a different piece or cell than it started on goes only to what was under the pointer both times; usually that means it does nothing, or only clears the selection.

> Technical note: The board handles the 3D library's click events, which fire only for the primary button and only for an object that was under the pointer both when it went down and when it came up. The board also checks the distance the pointer travelled, because the camera controls listen to the same pointer: anything over 6 pixels is taken as a view drag and ignored.

## What takes a press

The board is a tower of five glass levels seen in perspective, so the point under the pointer usually has several cells and pieces behind it. Each piece takes presses on a fixed outline fitted round it (so a piece that lifts under the pointer cannot slip out from under it), and each cell takes presses only on a thin slab lying on its glass, so a press on a level lands on the square whose glass is under the pointer. The press follows the line from the camera through the pointer into the tower and meets things in order, nearest first:

1. **The first piece or legal destination on the line takes the press.** Nothing behind it sees the press.
   - A legal destination plays the move.
   - An opponent's piece standing on a legal destination is the capture itself: pressing the piece plays the move, as pressing its cell would.
   - One of the player's own pieces that can move now becomes the selection, whether or not another piece was selected; pressing the selected piece again puts it down.
   - Any other piece (the opponent's, where it is not a capture, or any piece while it is not the player's turn) takes the press and shakes its head, once per press, while the board takes input; the selection stays.
2. **An empty cell that is not a destination clears the selection** when the line crosses its glass before reaching a piece or destination. A destination's cell takes a press only on its marked circle: elsewhere on that cell's glass the press passes through to whatever lies beneath it, as if the cell were not there.
3. **A press that reaches no piece and no cell clears the selection**: the gap between two levels, the garden, and the sky all count.
4. **The marks of play, the glass, the borders, the labels, the garden, and a captured piece that is burning away are never hit.** A press passes through them as if they were not there. A piece in the middle of its [glide](../glossary.md#selection-and-board-state) is hit where it stands.

On a touch screen, [tap assist](../glossary.md#input) helps a finger that is wider than the piece it aims at: a tap that reaches nothing the player can act on (an empty cell, the space round the tower, or a piece that cannot be selected) goes instead to the nearest of the player's own selectable pieces or legal destinations whose outline on screen lies within about 22 pixels of the touch. While a piece is held, a destination wins a near tie with another piece, so a tap between them plays the move rather than trading the held piece. A tap out of reach of everything is an ordinary press. A mouse or pen click is never redirected.

Two consequences shape how the game feels:

- **A piece in front of a destination blocks it.** If one of the player's own pieces stands between the camera and the destination, pressing there selects that piece instead; if an opponent's piece that is not a capture stands there, the press does nothing. The player has to turn the view until the destination is in clear sight, or type the move in the [move box](#the-move-box). Empty cells, and the glass of the levels, in front of a destination do not block it.
- **Only the circle counts.** A destination takes the press on its gold circle (a capture, on its red circle or on the piece itself), not on the empty corners of its cell; a press there reaches what lies beneath, such as a circle on a lower level, or clears the selection.

The HTML laid over the board is in front of all of this. Only a few parts of it take the pointer: "How to play" at the top right, the [error banner](../game-page/error-banner.md)'s "✕" in the status column under the turn pill, the [move card](../game-page/move-list.md) at the bottom left while it is shown (which is only while its [move box](#the-move-box) has keyboard focus), "Couldn't load the board" with its "Retry" if the board failed to load, and, after a finished game's result card has been closed, "Play again" below the tower. A press on them never reaches the board or the view. Everything else in the [HUD](../glossary.md#the-interface) lets presses through to the board behind it: the [turn pill](../game-page/turn-indicator.md), with the player's and the opponent's [status](../game-page/seat-and-opponent-status.md) on it, the captured pieces, the reconnecting line, the frozen-board banner, and the empty space around them. The promotion dialog, the [result card](../glossary.md#the-interface), and the replaced dialog cover the whole window and block the board completely.

## When the board takes input

[The board takes input](../glossary.md#selection-and-board-state) only while all four of these hold:

1. the connection is *connected* (not connecting, reconnecting, or replaced);
2. the server has answered this connection's create, join, or [rejoin](connection-and-seat.md#rejoining), so the page holds its seat on the connection it is using; after every reconnect, reload, or "Play here", the board waits for the rejoin's snapshot;
3. the move record is not [frozen](../cross-cutting/broken-game-record.md);
4. none of this player's own moves is in flight (the board is not [held](../glossary.md#selection-and-board-state)).

While it does not, presses on pieces and destinations do nothing (a piece does not even shake its head), the move box sends nothing, and nothing looks different about the board itself: pieces are drawn as usual, and the only signs are the banner or dialog that explains why (or, for the short wait for a snapshot, nothing at all) and the absence of any reaction to a press. The moment the board stops taking input, any selection is cleared and the promotion dialog closes. The view can always be turned.

Whose turn it is does not decide whether the board takes input. On the opponent's turn the board takes input, but none of the player's pieces can be selected, so a press on a piece only makes it shake its head. The board also takes no input while the [entrance](the-view.md#the-entrance) plays. In a game against the computer the connection is always "connected" and every request is answered at once, so only the last two conditions and the entrance ever apply (see [playing the computer](../computer/playing-the-computer.md)). The move box, by contrast, accepts a move only on the player's own turn, and says "Wait for their move." to a move submitted on the opponent's.

The board also cannot be used while a dialog covers it: the promotion dialog, the result card, the replaced dialog, and the [crash screen](screens-and-navigation.md#the-crash-screen). These do not change whether the board takes input; they stand in front of it, and while one of the three dialogs is up, everything behind it (the board and the whole HUD) is inert: it cannot be clicked, reached with Tab, or read by a screen reader.

A second press on a destination right after the first cannot send the move twice: the piece is put down and the move marked as sent the instant of the first press, before the page redraws.

## The move box

The move box is the second way to play a move and the only one that works without a pointer. It is a text field ("Type a move") with a small ↵ button, the field of the [move card](../glossary.md#the-interface). The card is never shown as a panel: it is out of sight, but the move box is the first thing Tab reaches on the board screen, and appears (alone, at the bottom left, with a one-line hint) the moment it has keyboard focus; it goes again when it loses focus with nothing typed, or on Escape. Its full behavior belongs to [making a move](../play/making-a-move.md); for the input model it matters in three ways:

- It is an ordinary HTML form. Typing is always possible; Enter or the ↵ button submits. A move is sent only while the board takes input, the game is not over, and it is the player's turn. On the opponent's turn, and once the game is over, it says "Wait for their move."; on the player's own turn while the board takes no input (a move in flight, a drop, a frozen record, the entrance), a submit does nothing.
- A move typed there is checked against the same rules as a press and is sent exactly as a pressed move is: the board is held until the echo, and a typed promotion names its piece (`=Q`, `=R`, `=B`, `=N`, or `=U`) and is sent without the promotion dialog.
- A move that cannot be played is not sent; a line of text under the field says why.

## HTML controls and the keyboard

Buttons and links behave as they do on any web page: they act on click (release), can be reached with Tab, and are activated with Enter or Space. The app's buttons are:

- on the [home page](../start/the-home-page.md): "Play a friend", "Play the computer", and "How to play" (its only controls);
- on the side choice: "← Home" and "White", "Random", and "Black" (whose kings can also be clicked or tapped), and against the computer then "Easy", "Medium", and "Hard";
- on the invitation to send: "← Home" and "Copy link"; on the invitation to the free seat: "← Home" and "Join game", or "Play a friend" (or "Play the computer") when the game is taken or gone;
- on the board screen: the move box and its ↵ ("Play the move"), "How to play" (a "?" in a narrow window), the error banner's "✕" ("Dismiss error"), "Retry" if the board failed to load, the five piece buttons and "Cancel" in the promotion dialog, "Close" and "Play again" on the result card (and "Play again" below the tower once the card is closed), and "Play here" in the replaced dialog;
- in the [tutorial](../learn/the-tutorial.md): "← Home" (or "← Game"), the lessons, the steps, "Reset", and the next button;
- the crash screen's "Back to start" link.

A disabled button cannot be reached with Tab. On the board screen, Tab goes first to the move box, then its ↵ button, then "How to play"; while an error shows, the error banner's "✕" comes before them.

Each dialog puts keyboard focus on a button when it opens: "Queen" in the promotion dialog, "Play again" on the result card, and "Play here" in the replaced dialog. Enter or Space then answers it at once, and Tab moves between the dialog's buttons only, because everything behind it is inert.

The key the app handles itself is **Escape**: in the promotion dialog it cancels the promotion, on the result card it closes the card, and in a move box that Tab brought up it puts the box away. There are no keyboard shortcuts, the board cannot be navigated from the keyboard, and the arrow keys do not move the view. A keyboard player plays by typing moves into the move box. The canvas itself is described to screen readers as "The 3D board, white side nearest. Pieces are selected and moved with a pointer; to play from the keyboard, press Tab to type a move." (or black). What this means for players who cannot use a pointer is in [accessibility](../cross-cutting/accessibility.md).

Shift, Ctrl, Cmd, and Alt change nothing about a press on the board or a click on a button. Shift, Ctrl, or Cmd held during a left drag stops it turning the view, and during a right drag makes it orbit; see [the view](the-view.md#turning-the-view).

## The interrupt events

Every feature document has the same eleven-row [cancel and interrupt](../README.md#document-template) table. Each row means exactly this:

| Row | What counts | What it is, in the glossary's terms |
| --- | --- | --- |
| Escape or Cancel | Escape, the promotion dialog's "Cancel" button, and a click on the veil round the promotion dialog. Escape and a click outside the result card close it, which ends nothing. No other part of the app has a cancel. | [Cancel](../glossary.md#events-that-end-or-interrupt-a-request) |
| Pressing elsewhere or turning the view | Any press on the board, any drag or wheel turn of the view, and clicks on other HTML controls (dismissing an error, typing in the move box). A press may clear a selection; turning the view never does. | The player doing something else |
| Leaving the game page within the app | Browser Back or Forward to another page or straight to another game's page, "← Home" (before the game starts), "How to play" (to the tutorial), "Play again" and an invitation's "Play a friend" or "Play the computer" (to a side choice), and the crash screen's "Back to start" (which reloads the app at `/`). Leaving a game's page against a friend [resets](../glossary.md#events-that-end-or-interrupt-a-request) the connection. | Interrupt |
| The game ends | This browser, replaying the record after a move arrives, finds checkmate, stalemate, a threefold repetition, or the fifty-move rule. The result card then covers the page. | Interrupt |
| The server answers with an error | The server refuses a request; see [error messages](../cross-cutting/error-messages.md). | [Complete](../glossary.md#events-that-end-or-interrupt-a-request) (refused) |
| The connection drops | Anything that closes the connection without the player asking: the network going away, the server restarting or being redeployed, the one-hour limit, or a server fault. All look the same to the player: the [retry schedule](connection-and-seat.md#connection-states) starts, and after it succeeds the board waits for the rejoin's snapshot before it takes input. | Interrupt |
| The window loses focus or the tab is hidden | Switching to another application or tab, or minimizing the window. The connection stays open. Animations pause while the tab is hidden and resume where they left off; the browser may slow the retry schedule in a hidden tab. | Usually no effect |
| Reload or closing the tab | Reload, closing the tab or window, typing another address, or following a link off the app. Everything in the page is lost except the [stored seat](connection-and-seat.md#the-stored-seat) and the tab's [client id](connection-and-seat.md#the-client-id) (which a reload keeps and closing the tab loses); the server notices the connection closing. | Interrupt |
| The opponent acts | The opponent's move arrives, the opponent joins, or the opponent's connection drops or returns. | Interrupt when it changes the position |
| Another tab takes the seat | Another tab or window of the same browser opens the same game, or clicks "Play here" there; or this tab's connection returns after a drop and finds the seat held by another tab ([seat in use](connection-and-seat.md#last-connection-wins)). This tab becomes [replaced](../session/second-tab.md). | Interrupt |
| A second touch point or a cancelled touch | A second finger landing, which turns a one-finger gesture into a pinch that zooms, or the browser or system cancelling a touch in progress. Neither ever acts on the board; a cancelled touch simply ends the gesture. | Usually no effect |

"Before sending" and "while in flight" are the two columns. A request that has not been sent can be discarded by any interrupt without trace. A request in flight cannot be recalled: an interrupt only decides whether the player sees its answer.

## Open questions and verification

- The click-on-release rule is read from the 3D library's event dispatch and the board's handlers, and covered by `client/src/three/Board.test.tsx` (a drag over 6 pixels and a right or middle button do nothing; 4 pixels of jitter still plays the move). That a press released over a different object goes only to what was under the pointer both times is the 3D library's rule, not tested here. Whether every browser suppresses the click after a right or middle press, and after a two-finger gesture, was not confirmed by hand.
- A second touch landing during a one-finger gesture should never act, because browsers do not produce a click for a multi-touch gesture. Read from code; not tried on a real touch device.
- A drag of 6 pixels or less both nudges the view and acts as a press. Whether that feels right on a trackpad was not checked.
- The double send of a quick second press ([bug-triage B-14](../bug-triage.md)) is fixed: the board puts the piece down at once and the page marks the move in flight before its next render (`held` in `client/src/three/Board.tsx`, `moveInFlight` in `client/src/screens/GameScreen.tsx`, covered by `GameScreen.moveGuard.test.tsx`).
- What takes a press on the tower (the fixed outline round each piece, the thin slab on each cell's glass, a destination's circle alone, pressing a capturable piece to capture it, a refused piece shaking its head, a press on nothing clearing the selection) and tap assist are read from `client/src/three/Board.tsx`, `tapAssist.ts`, and `useTapAssist.ts` at `24c650c`, and covered by `Board.test.tsx`. Tap assist was not tried on a real phone.
- The list of buttons, focus on opening each dialog, and Escape on the result card are read from `client/src/screens/` at `24c650c`, not tried by hand.

Drafted against 3D Chess commit `24c650c`
