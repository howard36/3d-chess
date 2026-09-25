# The view

## Summary

The board screen shows the game as a 3D scene: a wireframe cube of 125 cells with the pieces standing inside it, seen by a camera the player can orbit, zoom, and pan. This document owns everything about that scene: how the board is oriented for each player (levels are drawn as depth, not height), what the default view shows, how the player turns the view and what that does and does not touch, the colors and shapes of every marker, and when and how moves animate. The view exists only on the board screen, once both seats are taken, and is entirely local: turning it changes nothing on the server and nothing for the opponent.

## The scene

The board screen fills the browser window with a light gray-blue scene. The 125 cells are outlined by a single dark gray wireframe lattice, drawn faintly so that it does not hide the pieces; the cells themselves are not drawn unless something marks them. Neighboring cells are separated by a narrow gap. A fog matched to the background fades the far side of the lattice slightly, which is the main depth cue besides perspective.

The pieces are turned, Staunton-style shapes: White's in ivory, Black's in dark graphite (neither pure white nor black, so both stay readable under the lighting). The Unicorn is a tall body with a spiral horn. Each piece stands on the floor of its cell rather than floating in its middle, so the tops of pieces in a row are at different heights, from the Pawn (a little over half a cell) to the King (nearly a full cell). Knights are turned to show their profile to the default camera, White's and Black's slightly opposite ways.

Nothing in the scene moves unless something changes: there is no idle animation, and the scene is redrawn only when the view turns, a marker changes, or a move animates.

## Orientation

Each player sees the board from their own side. The three board directions are drawn like this, from the default view:

| Board direction | White sees | Black sees |
| --- | --- | --- |
| File a–e | left to right, a on the left | right to left, a on the right |
| Rank 1–5 ("forward") | bottom to top of the screen: rank 1, White's back rank, at the bottom | top to bottom: rank 5, Black's back rank, at the bottom |
| Level A–E ("up") | near to far: level A nearest the camera | far to near: level E nearest the camera |

So each player sees their own army laid out identically: the back rank of Rooks, Knights, and King at the bottom of the nearest slice, the Bishops, Unicorns, and Queen at the bottom of the slice behind it, and ten Pawns in the row above those, in the two nearest slices. The opponent's army sits at the top of the two farthest slices. Only positions are mirrored for Black; the pieces themselves are drawn the same way for both players.

The consequence players have to learn: **the game's "up" is the screen's "away"**. A pawn stepping *up* a level moves away from its owner, deeper into the screen; a pawn stepping *forward* moves up the screen. The [rules](game-rules.md) speak of levels as vertical, but the view draws them as depth.

The board has no labels: no letters, digits, or level names appear anywhere in the scene. The only place cell names appear is the [move list](../game-page/move-list.md).

## The default view

Every board screen starts with the camera in front of the board, above it and to the right, looking at the center of the cube, with the player's own slices nearest. Most of the cube is in frame, but not all of it: in a typical wide window the nearest bottom edge of the cube, where the player's own back rank stands, runs slightly off the bottom of the window, cutting off the feet of the nearest pieces. The slices are not exactly behind one another from there, so pieces on deeper levels peek out beside the nearer ones. Both players' cameras start in the same place; the orientation above is what makes each see their own side.

The view resets to the default only when the board screen is created: on a page load, a reload, and a return to the game. It does not reset between moves, on reconnecting, or when the opponent moves. There is no "reset view" control.

## Turning the view

The player turns the view with the mouse, the wheel, or touch:

| Input | Effect |
| --- | --- |
| Left drag | Orbit: the camera circles the point it looks at. |
| Right drag | Pan: the camera and the point it looks at slide sideways together. |
| Shift, Ctrl, or Cmd with a left drag | Pan instead of orbit. |
| Shift, Ctrl, or Cmd with a right drag | Orbit instead of pan. |
| Middle drag, or the wheel | Zoom: the camera moves toward or away from the point it looks at. |
| One-finger drag | Orbit. |
| Two-finger drag or pinch | Pan and zoom together. |

Limits: the camera stays between 6 and 25 units from the point it looks at (the cube itself is about 5.4 units across, so fully zoomed in it still sees most of the board, and fully zoomed out the board is small in the middle of the window). Orbit goes all the way around horizontally, and vertically from looking straight down on the board to looking straight up at it, stopping at those two poles. Pan has no limit: the board can be slid off screen entirely, and the camera can end up inside the cube. The arrow keys do nothing.

After a drag is released, the view keeps moving briefly and slows to a stop, like a spinning object with friction.

### Begin

A press on the canvas begins both a possible drag and a [press on the board](input-model.md#a-press-acts-at-once). The board resolves its part immediately: selecting a piece, clearing the selection, or playing a move. The view does nothing yet.

### End without sending

A press released without moving is a click as far as the board is concerned, and the view does not move. Nothing about the view is recorded. The view never sends anything to the server, in this or any phase.

### Send

The view's equivalent of sending: the pointer moves while pressed, and the press becomes a drag. From here the view follows the pointer. Whatever the press did to the board is already done and is not undone by the drag; see [the input model](input-model.md#a-press-acts-at-once).

### While in flight

While dragging, the view follows the pointer continuously: orbit and pan follow the pointer's movement, zoom follows its vertical movement (middle drag) or each wheel notch. The pieces, markers, and selection stay as they are; a move arriving meanwhile animates in the moving view.

### The answer arrives

On release, the drag ends and the view coasts to a stop over a moment. The new angle and zoom stay until the player changes them or the board screen is rebuilt.

## Markers and colors

Every mark the board draws, and what it means:

| Mark | Looks like | Means |
| --- | --- | --- |
| Selection ring | A gold ring on the floor of the selected piece's cell | This piece is [selected](../glossary.md#selection-and-board-state). |
| Selection glow | A faint amber glow on the selected piece itself | Same. |
| Destination fill | A faint amber tint filling the whole cell | A [legal destination](../glossary.md#moves-and-the-rules) of the selected piece. |
| Quiet-move dot | A small amber dot at the center of an empty cell | A legal destination that is an empty cell. |
| Capture ring | A red ring on the floor around an opponent's piece, slightly wider than the selection ring | A legal destination that captures that piece. |
| Last-move fill | A teal tint filling a cell | The origin or the destination of the most recent move. |
| Check glow | A red glow on a King | That King is in [check](game-rules.md#check-checkmate-and-stalemate). It replaces the selection glow if the King is also selected. |

A promotion square that a pawn can reach is marked once, like any other destination, though it stands for five moves. A cell that is both a legal destination and part of the last move shows the amber destination fill, not the teal one. Everything else in the scene (the lattice, the fog, the pieces) is fixed.

Color is the only thing that separates the amber selection marks from the teal last-move fill and the red capture and check marks; see [accessibility](../cross-cutting/accessibility.md).

## Motion

Every move that arrives while the board screen is showing animates on both players' boards, the mover's included, because each board shows a move only when the server returns it (see [the connection model](connection-and-seat.md#a-move-is-shown-only-when-the-server-returns-it)):

- **Glide.** The moving piece travels from its origin to its destination in 300 ms, starting and finishing gently, lifted a fifth of a cell's spacing at the midpoint so that it reads as picked up and set down rather than slid. It follows a straight line through the lattice, even for a Knight.
- **Fade.** If the move captured, the captured piece shrinks into its cell floor and fades out over the same 300 ms while the capturer glides in, then disappears.
- **Promotion.** A promoting pawn glides as the piece it becomes: the new Queen (or other piece) travels from the pawn's cell.
- **Last-move fill.** The teal fill moves to the new move's two cells the moment the move arrives.

Moves do not animate when they were already in the record when the board screen appeared: after a reload, a return to the game, or the board appearing for the first time on a rejoin, the position is simply drawn, with the last-move fill on the latest move. After a reconnect, the snapshot animates its last move only if that move is one this board had not yet shown.

The 300 ms assume a smooth frame rate. Each drawn frame advances an animation by at most 33 ms, so on a device that draws fewer than 30 frames per second the glide and fade take longer: in the scripted pass, with software drawing at about 9 frames per second, a capture's fade ended about 1.5 s after the press. The view's coasting after a drag stretches the same way.

A new move arriving while a glide is still running starts its own glide at once; the earlier piece jumps to its destination. While the tab is hidden, the scene is not drawn and animations pause where they are; when the player returns to the tab, a move that arrived meanwhile glides in from its origin.

A press during a glide can hit the moving piece where it is drawn at that instant; the fading piece cannot be hit at all.

## Modifiers

These apply to turning the view.

| Modifier | At the start | Changes while in flight |
| --- | --- | --- |
| Your color | Decides the orientation for the life of the board screen. The camera's starting position is the same for both colors. | Cannot change. |
| Whose turn it is | No effect on the view. | No effect; an arriving move animates in the moving view. |
| How you reached the page | Every way of reaching the board screen starts at the default view. | Not applicable. |
| Connection state | No effect. The view can be turned while connecting, reconnecting, or replaced (under the dialog it cannot be reached). | No effect. |
| Game state | No effect while the game is in progress, in check, or frozen. Once the game is over, the end-game dialog covers the board and the view can no longer be turned. | The game ending mid-drag puts the dialog over the board; see below. |
| Shift, Ctrl, or Cmd held | With a left press, the drag pans; with a right press, it orbits. They do not change what the press does to the board. | Pressing or releasing them mid-drag does not switch between orbit and pan; the choice is made when the drag begins. |
| Input device | Mouse: as in the table above. Touch: one finger orbits, two fingers pan and zoom. Keyboard: no effect. | Adding a second finger switches from orbit to pan-and-zoom. |

## Cancel and interrupt

"While in flight" here means while dragging.

| Event | Before sending | While in flight |
| --- | --- | --- |
| Escape or Cancel | No effect. | No effect; the drag continues. |
| Pressing elsewhere or turning the view | Each press starts its own possible drag. | Not possible with one pointer; a second finger joins the gesture (see the last row). |
| Leaving the game page within the app | The view is discarded; returning starts at the default view. | Same. |
| The game ends | The end-game dialog covers the board; the view stays at its last angle behind it and can no longer be turned. | The dialog appears over the board; the drag may continue under it until release, since the pointer is already captured, but nothing further can start. |
| The server answers with an error | No effect on the view. | No effect. |
| The connection drops | No effect; the view can still be turned. | No effect. |
| The window loses focus or the tab is hidden | No effect; the view keeps its angle. | The drag ends if the browser cancels the pointer; otherwise it ends at the next release. |
| Reload or closing the tab | The view is lost; the next board screen starts at the default view. | Same. |
| The opponent acts | An arriving move animates in the current view; the view does not move. | Same, while the player drags. |
| Another tab takes the seat | The replaced dialog covers the board; the view keeps its angle behind it. | The dialog appears; the drag ends at release. |
| A second touch point or a cancelled touch | A second finger is a new press on the board, then joins the gesture. | A second finger switches to pan-and-zoom; a cancelled touch ends the drag where it is. |

After any interrupt the view stays where it was left, except when the board screen itself is rebuilt.

## Interactions with other systems

**Seat and turn.** The seat's color fixes the orientation. The turn changes nothing about the view.

**The game record.** The view is never recorded anywhere. What it shows is the position replayed from the record.

**Connection.** Independent of the connection: the view works while disconnected and while replaced (behind the dialog).

**The opponent.** Each player's view is their own. The opponent cannot see where the player is looking, and the player's view does not follow the opponent's moves.

**Other tabs and devices.** Each tab has its own view. A replaced tab keeps its view behind the dialog and still has it after "Play here".

**Game over.** The end-game dialog covers the board; the final position stays visible, darkened, at the angle the player left it, and cannot be turned.

**Stored seat.** The view is not stored; only the seat is.

**Keyboard, touch, and screen size.** The view cannot be turned from the keyboard. Touch works as described above. The scene fills the window at any size and redraws at once when the window is resized. The camera's vertical field of view is fixed, so the cube's size follows the window's height: a narrower window crops the sides of the board rather than shrinking it, and an upright phone cuts off a large part of both sides at the default view. See [screen sizes and touch](../cross-cutting/screen-sizes-and-touch.md).

## Edge cases

- **Panned out of sight.** Pan has no limit and nothing re-centers the view; a player who pans the board off screen must pan it back or reload.
- **Camera inside the cube.** By panning, the camera can end up between cells. Presses then go to whatever is in front of the camera, which may be behind the player's intention; nothing warns about it.
- **Occlusion.** From the default view many cells are hidden behind nearer pieces, and [a piece in front of a destination blocks it](input-model.md#what-takes-a-press). Turning the view is the only way to reach such a cell.
- **Looking from below.** Orbiting under the board shows the pieces from underneath; the pieces' bases are closed, and nothing flips.
- **A glide through pieces.** Glides take the straight line, so a Knight's jump or a long slide passes visually through whatever lies between.

## Open questions and verification

- The colors, sizes, timings, and orientation are read from `client/src/three/` and covered by `client/src/three/Board.test.tsx` and `layout.test.ts`; the look was checked against the end-to-end screenshots' description, not by eye.
- The camera controls' behavior (which button does what, damping, the effect of Shift/Ctrl/Cmd, touch gestures, the vertical limits) is the 3D library's default and was read from the library, not from this repository's tests. Not confirmed by hand.
- Whether a drag in progress survives the end-game dialog appearing is read from how the camera controls capture the pointer; not tried.
- The default view cutting off the nearest bottom edge of the cube was seen in the scripted pass's screenshots at 1280 × 720. Whether the view should be framed so that the player's own back rank is fully visible is a product call.
- The absence of coordinate labels on the board, and the absence of a "reset view" control, may be worth a product call.
- Color is the only cue distinguishing the markers; see accessibility.

Verified against 3D Chess commit `d94507b`
