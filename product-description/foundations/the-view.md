# The view

## Summary

The board screen shows the game as a 3D scene: a tower of five glass levels holding the 125 cells, with the pieces standing on the glass, set in a garden at night and seen by a camera the player can turn round the tower and zoom. This document owns everything about that scene: how the board is oriented for each player (levels are drawn as height, ranks as depth), what the default view shows, how the player turns the view and what that does and does not touch, the colors and shapes of every marker, and when and how moves animate. The view exists only on the board screen, once both seats are taken, and is entirely local: turning it changes nothing on the server and nothing for the opponent. Much of the look can be adjusted in the [settings panel](#the-looks-settings); this document describes it with the default settings.

## The scene

The board screen fills the browser window with a night scene. In the middle stands the tower: five levels, A at the bottom and E at the top, each a square sheet of clear glass edged by a thin border of light in its level's own color, from cyan at A through azure, periwinkle, and orchid to rose at E. Each level is divided into its 25 squares by hairlines of the same color over a faint checker: the light squares are faintly frosted with the level's light and the dark squares left clear. The checker runs through the levels (a cell is dark when the sum of its level, file, and rank indices is even), so a Bishop keeps to one color on every level. The levels are a little further apart than a square is wide, so the whole stack is close to a cube, and every piece stands clear of the level above it. The level the player is pointing at, or holding the selected piece on, brightens its lines, its border, and its letter; the others step back a little.

The board is labelled. The files (a to e) and ranks (1 to 5) are written along the two edges of the bottom level nearest the camera, just outside it (from high above they move to the top level, whose edges are then outermost on screen), and each level's letter, in that level's color, stands beside its own level on the left of the tower. The labels keep to those edges as the view turns, crossfading briefly when they change sides, and a piece standing in front of one hides it.

The pieces are a sculpted Staunton set: White's in near-white porcelain with a soft sheen, Black's in dark charcoal with the details that name each piece (the Rook's battlements, the Bishop's cut, the Unicorn's spiral horn, the Queen's pearls, the King's cross, the Knight's mane and eye) in a lighter pewter, so both armies read clearly against the night. Every piece can be told from the others by its outline alone, from the Pawn, the shortest, to the King, the tallest. Each stands on the glass of its cell, with a thin band of its level's color round its foot, so the level a piece is on can be read from the piece itself. Knights look along the ranks toward the opponent, turned a little to show their profile. The light falls on the pieces from the viewer's side wherever the camera goes, so both armies look the same from both seats and from above.

Around the tower is a garden at night: a dark plain of glossy stone stretching to a misty horizon, carrying a colossal chessboard drawn in faint lines of light, on which twelve colossal chess pieces stand drawn in thin white neon line. Everything in the garden darkens smoothly toward the tower on screen, so nothing out there competes with the board, and a sculpture that comes near the tower in the view sinks into its shade. Overhead is a sparse field of faint stars with eight chess pieces drawn among them as constellations, and now and then a faint shooting star; these are out of sight above the top of the window in every ordinary view and are found by turning the view to look up past the tower.

The scene is still unless something is happening. It moves while the view turns, while a move animates, and while one of the marks of play has its own slow motion: the turning arcs round a capturable piece, the light travelling along the last-move line, the motes round a held piece, and the breathing of a check.

## Orientation

Each player sees the board from their own side. The three board directions are drawn like this, from the default view:

| Board direction | White sees | Black sees |
| --- | --- | --- |
| File a–e | left to right, a on the left | right to left, a on the right |
| Rank 1–5 ("forward") | near to far: rank 1, White's back rank, nearest | far to near: rank 5, Black's back rank, nearest |
| Level A–E ("up") | bottom to top: level A at the bottom | bottom to top: level A at the bottom |

Levels are drawn as height for both players; only files and ranks are turned about for Black, as if Black had walked round the tower to the other side. So each player's army starts in the two rows nearest them: White's on the bottom two levels (the back rank of Rooks, Knights, and King on level A, the Bishops, Unicorns, and Queen on level B, and a row of five Pawns in front of each), Black's on the top two. White looks up the tower at Black's army; Black looks down it at White's. Only positions are turned; the pieces themselves are drawn the same way for both players.

The game's "up" is the screen's up: a pawn stepping *up* a level rises to the level above, and a pawn stepping *forward* moves away from its owner, deeper into the screen. For White, up and forward both lead toward Black's army; for Black, forward leads away into the screen and "up" (toward level A) leads down the tower.

## The default view

Every board screen starts with the camera in front of the tower, a little above the bottom level's plane (18° above the horizon) and turned a little to the player's right (16°), looking at the center of the tower, with the player's own first rank nearest. From there the camera looks between the levels rather than down through them, and pieces on the back rows of one level do not overlap the front rows of the level above. Both players' cameras start in the same direction relative to their own side; the orientation above is what makes each see their own side.

The camera stands at the distance that just fits the whole tower and its labels in the window, whatever the window's shape, with a small margin, and the tower is centered in the part of the window below the turn pill's row at the top. In a narrow window, such as a phone held upright, the camera stands further back and the tower is smaller, but nothing is cut off. The tower stays centered as the view turns and zooms, without the camera ever moving off the tower's center.

The whole view resets to the default only when the board screen is created: on a page load, a reload, a return to the game, and a move from another game's page. It does not reset between moves, on reconnecting, or when the opponent moves. There is no "reset view" control.

**Resizing the window** (including rotating a phone, or opening the browser's side panels) moves the camera, straight along its current line of sight, back to the distance that fits the tower in the new shape. The direction the player has turned to is kept; the zoom is not.

## Turning the view

The player turns the view with the mouse, the wheel, or touch. The camera only ever turns round the tower's center and moves toward or away from it; nothing slides the view sideways.

| Input | Effect |
| --- | --- |
| Left drag | Orbit: the camera circles the tower's center. |
| Right drag | Nothing. |
| Shift, Ctrl, or Cmd with a left drag | Nothing. |
| Shift, Ctrl, or Cmd with a right drag | Orbit. |
| Middle drag, or the wheel | Zoom: the camera moves toward or away from the tower's center. |
| One-finger drag | Orbit. |
| Two-finger pinch | Zoom. |

Limits: the camera can zoom in to about seven tenths of the default distance and out to one and a half times it, whatever the window's shape, so fully zoomed in the nearest levels fill the window and fully zoomed out the tower sits small in the middle of it. Orbit goes all the way round horizontally. Vertically it goes from looking straight down on the tower, where the five levels nest like one board seen through glass, to a little below the horizon, looking up past the tower into the night sky (14° below level when zoomed in, a little less when zoomed out, since the camera always stays above the garden's ground). With the "Look up" setting off it stops 6° above level instead. The arrow keys do nothing.

After a drag is released, the view keeps moving briefly and slows to a stop, like a spinning object with friction.

### Begin

A mouse button, finger, or pen going down on the canvas, or a wheel turn, begins a possible drag. Nothing happens yet, to the view or to the board. A wheel turn skips straight to zooming.

### End without sending

A left button, finger, or pen released within 6 pixels of where it went down is a [press on the board](input-model.md#a-press-acts-on-release), and the board resolves it on release; the view moves by those few pixels at most. A right or middle button released without moving does nothing at all. Nothing about the view is recorded. The view never sends anything to the server, in this or any phase.

### Send

The view's equivalent of sending: the pointer moves while pressed, and the gesture becomes a drag. From here the view follows the pointer. A drag does nothing to the board: it does not select, clear, or play, wherever it started; see [the input model](input-model.md#a-press-acts-on-release).

### While in flight

While dragging, the view follows the pointer continuously: orbit follows the pointer's movement, zoom follows its vertical movement (middle drag) or each wheel notch. The pieces, markers, and selection stay as they are; a move arriving meanwhile animates in the moving view.

### The answer arrives

On release, the drag ends and the view coasts to a stop over a moment. The board ignores the release, since the pointer travelled more than 6 pixels. The new angle and zoom stay until the player changes them, the window is resized (which resets the zoom), or the board screen is rebuilt.

## Markers and colors

The marks of play are drawn in light on the glass of the cells they belong to, and show through every level above them, so a mark three levels down reads as clearly as one on top. Every mark the board draws, and what it means:

| Mark | Looks like | Means |
| --- | --- | --- |
| Hover | One of the player's own pieces that can be selected now lifts a little under the pointer, catches more light, its foot band brightens, and a small soft light gathers on the glass under it. Pieces that cannot be selected do not react. | The piece a press would pick up. |
| Level in focus | The level under the pointer, or the level of the selected piece, brightens its lines, border, and letter; the other levels step back a little. | Where the pointer is, in depth. |
| Selection | The piece rises a little higher than under hover and holds still inside a column of cool white light that grows up out of the glass round it, with a thin circle of the same light round its foot and a few faint motes drifting up. As it is picked up, one ring of light spreads out from its foot and fades. Put down, the column sinks back into the glass. | This piece is [selected](../glossary.md#selection-and-board-state). |
| Destination | A thin gold circle on the glass of the cell, round a slight fill tinted with the level's color. Under the pointer the fill deepens and the circle grows a little. | A [legal destination](../glossary.md#moves-and-the-rules) of the selected piece that is an empty cell. |
| Capture | The same circle in red round the foot of an opponent's piece, with four short red arcs turning slowly round it. | A legal destination that captures that piece. |
| Last-move line | A thin mint line from a small circle on the cell the piece left to a larger mint circle round the piece where it landed, meeting the glass beside that piece, with a soft white light travelling along it from start to end. | The origin and destination of the most recent move. |
| Check | The whole King, cross and all, turns red, lit from below by a red plate of light with eight points on the glass round his foot, with dark obsidian blades edged in red standing round him. The plate strikes when check arrives (it lands a little large, flashes, and sends one wave out) and then breathes slowly. | That King is in [check](game-rules.md#check-checkmate-and-stalemate). A selected King in check keeps his red. |
| Checkmate | The mated King topples. One pulse of light spreads from his foot through all five levels, and the garden's colossal pieces brighten for a breath. | The game is over by checkmate; see [check and the end of the game](../play/check-and-game-end.md). |

A promotion square that a pawn can reach is marked once, like any other destination, though it stands for five moves. Marks give way rather than stack: the last move's small starting circle steps aside for a destination on the same cell, and its landing circle for a capture marker or the selection's own circle; the line itself stays. Seen from straight above the selected piece, a destination directly above or below it widens into a soft pool with no rim, so it never rings the selected piece.

Color is not the only difference between the marks: a destination is a still circle, a capture carries turning arcs, the last move is a line, and a King in check is red all over and ringed by blades. But gold, red, and mint carry most of the meaning; see [accessibility](../cross-cutting/accessibility.md).

### The look's settings

The gear at the top right of the board screen opens the settings panel, where the player can adjust much of what this document describes: the board (the checker's contrast, the grid lines, the levels' borders), the world (the giant board, the sculptures, how far the tower's shade reaches, looking up, the stars, the constellations, and the mist and shooting stars), the pieces (how each shows its level: a foot band, a ring on the glass, or both; the dark army's tone; the edge light; how far a piece lifts under the pointer and when selected; whether a Knight glides straight or leaps over an arc), the selection (the column of light, the motes, a glint on the foot circle, the ring of light on picking up), the markers (the capture marker's style, the last-move line's strength and its travelling light), and check (the blades' style, or none; a small red crown floating over the King; the strength of the check's strike; how long the checkmate pulse takes). Every change applies at once and only in this browser; nothing is sent to the opponent. See [the settings panel](../glossary.md#the-interface).

## Motion

Every move that arrives while the board screen is showing animates on both players' boards, the mover's included, because each board shows a move only when the server returns it (see [the connection model](connection-and-seat.md#a-move-is-shown-only-when-the-server-returns-it)):

- **Glide.** The moving piece travels from its origin to its destination in 460 ms, starting and finishing gently, in a straight line, even for a Knight, and even through pieces and levels in between. Its foot band changes color as it passes from level to level. With the "Knight moves" setting at "Arc", a Knight leaps over an arc instead.
- **Fade.** If the move captured, the captured piece stands until the capturer arrives, then burns away from its crown down behind a thin edge of white light, and its outline, drawn in light, rises a little from it and fades.
- **Promotion.** A promoting pawn glides as the piece it becomes: the new Queen (or other piece) travels from the pawn's cell.
- **Last-move line.** The line moves to the new move the moment the move arrives, and its landing circle draws itself in round the piece as it lands.

**Reduced motion.** When the player's system asks for reduced motion, no move glides and no captured piece burns away: the position simply changes when the move arrives, and the last-move line still shows which two cells it involved. The marks of play hold still too: the capture arcs do not turn, no light travels along the last-move line, and a check does not strike or breathe. The setting is read each time a move lands, so changing it takes effect from the next move.

Moves do not animate when they were already in the record when the board screen appeared: after a reload, a return to the game, or the board appearing for the first time on a rejoin, the position is simply drawn, with the last-move line on the latest move (and a King mated in the final move already lying on his side). After a reconnect, the snapshot animates its last move only if that move is one this board had not yet shown.

The 460 ms assume a smooth frame rate. Each drawn frame advances an animation by at most 33 ms, so on a device that draws fewer than 30 frames per second the glide and the capture take longer. The view's coasting after a drag stretches the same way.

A new move arriving while a glide is still running starts its own glide at once; the earlier piece jumps to its destination. While the tab is hidden, the scene is not drawn and animations pause where they are; when the player returns to the tab, a move that arrived meanwhile glides in from its origin.

A press during a glide can hit the moving piece where it stands; the burning piece cannot be hit at all.

## Modifiers

These apply to turning the view.

| Modifier | At the start | Changes while in flight |
| --- | --- | --- |
| Your color | Decides the orientation for the life of the board screen. The camera's starting position is the same for both colors. | Cannot change. |
| Whose turn it is | No effect on the view. | No effect; an arriving move animates in the moving view. |
| How you reached the page | Every way of reaching the board screen starts at the default view. | Not applicable. |
| Connection state | No effect. The view can be turned while connecting, reconnecting, or replaced (under the dialog it cannot be reached). | No effect. |
| Game state | No effect while the game is in progress, in check, or frozen. Once the game is over, the end-game dialog covers the board and the view can no longer be turned; after a game that ends as the player watches, the dialog waits about 2.8 s for the end to play out, and the view can be turned until it appears. | The game ending mid-drag puts the dialog over the board; see below. |
| Shift, Ctrl, or Cmd held | With the left button, the drag does nothing; with the right button, it orbits. They do not change what a press does to the board. | Pressing or releasing them mid-drag changes nothing; what the drag does is decided when it begins. |
| Input device | Mouse: as in the table above; only a left click without a drag acts on the board. Touch: one finger orbits, two fingers pinch to zoom, and only a one-finger tap acts on the board. Keyboard: no effect; the view cannot be turned from the keyboard. | Adding a second finger switches from orbit to pinch-zoom. |

## Cancel and interrupt

"While in flight" here means while dragging.

| Event | Before sending | While in flight |
| --- | --- | --- |
| Escape or Cancel | No effect. | No effect; the drag continues. |
| Pressing elsewhere or turning the view | Each pointer going down starts its own possible drag or press. | Not possible with one pointer; a second finger joins the gesture (see the last row). |
| Leaving the game page within the app | The view is discarded; returning starts at the default view. | Same. |
| The game ends | The end-game dialog covers the board, and the board behind it is inert; the view stays at its last angle and can no longer be turned. | The dialog appears over the board; the drag may continue under it until release, since the pointer is already captured, but nothing further can start. |
| The server answers with an error | No effect on the view. | No effect. |
| The connection drops | No effect; the view can still be turned. | No effect. |
| The window loses focus or the tab is hidden | No effect; the view keeps its angle. | The drag ends if the browser cancels the pointer; otherwise it ends at the next release. |
| Reload or closing the tab | The view is lost; the next board screen starts at the default view. | Same. |
| The opponent acts | An arriving move animates in the current view; the view does not move. | Same, while the player drags. |
| Another tab takes the seat | The replaced dialog covers the board; the view keeps its angle behind it. | The dialog appears; the drag ends at release. |
| A second touch point or a cancelled touch | A second finger joins the gesture as a pinch-zoom; it never acts on the board. A cancelled touch ends the gesture without acting. | A second finger switches to pinch-zoom; a cancelled touch ends the drag where it is. |

After any interrupt the view stays where it was left, except when the board screen itself is rebuilt. A window resize, which is not an interrupt, resets only the zoom.

## Interactions with other systems

**Seat and turn.** The seat's color fixes the orientation. The turn changes nothing about the view.

**The game record.** The view is never recorded anywhere. What it shows is the position replayed from the record.

**Connection.** Independent of the connection: the view works while disconnected and while replaced (behind the dialog).

**The opponent.** Each player's view is their own. The opponent cannot see where the player is looking, and the player's view does not follow the opponent's moves.

**Other tabs and devices.** Each tab has its own view. A replaced tab keeps its view behind the dialog and still has it after "Play here".

**Game over.** At checkmate the King topples and a pulse of light crosses the tower first; then the end-game dialog covers the board, and the final position stays visible behind its veil, at the angle the player left it, and cannot be turned.

**Stored seat.** The view is not stored; only the seat is.

**Keyboard, touch, and screen size.** The view cannot be turned from the keyboard; a keyboard player plays through the [move box](input-model.md#the-move-box) and sees the board at whatever angle it has. Touch works as described above. The scene fills the window at any size and redraws at once when the window is resized, and the camera moves back to the distance that fits the whole tower in the new shape, so a narrow window or an upright phone shows the whole tower, smaller, rather than cropping it. On a touch screen a tap that just misses a piece or destination goes to it ([tap assist](input-model.md#what-takes-a-press)). See [screen sizes and touch](../cross-cutting/screen-sizes-and-touch.md).

## Edge cases

- **Zoom lost on resize.** A player who zoomed in and then resizes the window, or rotates a phone, finds the camera back at the fitted distance, still facing the same way.
- **Occlusion.** From the default view some cells are hidden behind nearer pieces, and [a piece in front of a destination blocks it](input-model.md#what-takes-a-press). Turning the view, or typing the move in the [move box](input-model.md#the-move-box), is the only way to reach such a cell.
- **Looking up.** Orbiting below the horizon shows the tower from beneath its bottom level and the night sky above it; the pieces' bases are closed, and nothing flips. The camera never goes below the garden's ground.
- **Looking straight down.** From directly above, the five levels nest like one board seen through glass; the level in focus keeps its checker whole while the others ease back, and each level's frost leans toward its own color so the nested checkers can be told apart.
- **A glide through pieces.** Glides take the straight line, so a Knight's jump (unless knights are set to arc) or a long slide passes visually through whatever lies between.

## Open questions and verification

- The look (the tower, the labels, the pieces, the garden, and the marks of hover, selection, destinations, captures, the last move, and check) was checked by eye in screenshots of the running app from both seats, from the default view and from straight above, at commit `bb16fed`. The checkmate pulse, the King's topple, and the capture burning away were read from `client/src/three/scene/fx.tsx` and `pieceMotion.tsx`, not watched.
- The camera controls' behavior (which button does what, damping, the effect of Shift/Ctrl/Cmd, touch gestures) is the 3D library's with panning turned off, and was read from the library, not tried by hand. The vertical limits and the ground clearance are read from `client/src/three/layout.ts`, `scene/palette.ts`, and `scene/stage.tsx`.
- Whether a drag in progress survives the end-game dialog appearing (with the board behind it made inert) is read from how the camera controls capture the pointer; not tried.
- A resize discarding the player's zoom is how `client/src/three/FitCameraToBoard.tsx` works; whether keeping the zoom (and only refitting when the tower would be cut off) is better is a product call.
- Reduced motion is read from `client/src/three/motion.ts` and the scene's marks, and covered by `Board.test.tsx`; not tried with a real system setting. Whether the checkmate pulse and the King's topple also hold still under it was not checked.
- There is no "reset view" control; that may be worth a product call.

Verified against 3D Chess commit `bb16fed`
