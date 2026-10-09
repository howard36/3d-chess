# The view

## Summary

The board screen shows the game as a 3D scene: a tower of five glass levels holding the 125 cells, with the pieces standing on the glass, set in a garden at night and seen by a camera the player can turn round the tower and zoom. This document owns everything about that scene: how the board is oriented for each player (levels are drawn as height, ranks as depth), the entrance that builds it, what the default view shows, how the player turns the view and what that does and does not touch, the colors and shapes of every marker, and when and how moves animate. The view exists on the board screen of a game against a friend or the computer, once both seats are taken, and in the [tutorial](../learn/the-tutorial.md); the start page's [preview](../glossary.md#the-product-and-its-screens) and the [lobby](../glossary.md#the-product-and-its-screens) draw the same garden but cannot be turned. It is entirely local: turning it changes nothing on the server and nothing for the opponent.

## The scene

The board screen fills the browser window with a night scene. In the middle stands the tower: five levels, A at the bottom and E at the top, each a square sheet of clear glass edged by a thin border of light in its level's own color, from rose at A through orchid, violet, and blue to sky at E (the warm end at the base, the sky at the top; the five are equally vivid). Each level is divided into its 25 squares by hairlines of the same color over a faint checker. The checker runs through the levels (a cell is dark when the sum of its level, file, and rank indices is even), so a Bishop keeps to one color on every level. The levels are 1.35 times a square's width apart, so the whole stack is close to a cube, and every piece stands clear of the level above it.

While the pointer is on a level (a square of it, a piece on it, or a destination marked on it), the other levels step back: their glass, edges, and marks give up a little over half their light, and their pieces take a light haze, while the pointed-at level's pieces stand forward a little. Holding a piece steps nothing back, since its moves to other levels matter as much as those on its own.

The board is labelled. The files (a to e) and ranks (1 to 5) are written along the two edges of the bottom level nearest the camera, just outside it (from high above they move to the top level, whose edges are then outermost on screen). The five level letters, each in its level's color, stand up one corner post of the tower, each just outside its own level's corner. Seen from low or middling heights, the post is a side of the tower with no labels of its own, the far end of the row facing the camera (at the opening view, the near-left corner): one column up the side of the tower, A at the bottom and E at the top, clear of it and as large as the files. Climbing past 55°, the letters move to the corner across from where the files and ranks meet, and from straight above make a short diagonal line, each letter beside its own level's border; they come back below 45°. They change post a few degrees past the point where two edges face the camera equally, all five together in one short crossfade, never in line with the files or the ranks. No two labels overlap. A piece standing in front of a label hides it; the glass and its border never do.

The pieces are a sculpted Staunton set: White's in near-white porcelain, Black's in dark charcoal with the details that name each piece (the Rook's battlements, the Bishop's cut, the Unicorn's spiral horn, the Queen's pearls, the King's cross, the Knight's mane and eye) carved in relief. Every piece can be told from the others by its outline alone, from the Pawn, the shortest, to the King, the tallest. Each stands on the glass of its cell, with a thin band of its level's color round its foot, so the level a piece is on can be read from the piece itself. Knights look along the ranks toward the opponent, turned a little to show their profile. The light falls on the pieces from the viewer's side wherever the camera goes, so both armies look the same from both seats and from above.

Around the tower is a garden at night, all of it dim and colorless near the tower and sunk into its shade on screen, so nothing out there competes with the board: a near court of polished stone with rings of light and stepping stones a knight's jump apart; a colossal chessboard drawn in faint light carrying twelve giant chess pieces outlined in white neon, with a few fallen giants past its edge; a plain running out to a level horizon of hills and mist, with on White's side a far rook's tower with one warm window lit (dark once a game is won) and on Black's another game's tower in the levels' colors. Overhead are stars, a faint Milky Way, and chess pieces drawn among the stars as constellations; these are found by turning the view to look up past the tower. Now and then, while the player turns the view, something rare passes: a shooting star, a satellite, a constellation tracing itself, a lighthouse's sweep.

The scene is still unless something is happening. It moves while the view turns, while a move animates, and while one of the marks of play has its own slow motion: the turning arcs round a capturable piece, the light travelling along the last-move line, and the slow glints on the blades round a King in check.

## The entrance

Every board screen opens with an entrance that builds the scene; the board takes no input until it is over.

- **A game that starts while the page is open** (and was not handed over from the lobby): just under 4 seconds. The night fades up while the camera, starting far out on the opening line of sight, closes in to the default view without the tower's center moving on screen. The tower draws itself in light, level by level from A up, each overlapping the next: a level's edge grows out of its four corners to meet in the middle of each side, its hairlines run in across it, and its glass floods in from the edge. As the tower finishes, both armies form at once, each piece with its mirror image through the center, the back ranks from the royal pair outward and then the pawns, each piece rising from its foot behind a thin line of white light, while a flash and a ring of its level's light spread on the glass at its foot. The labels settle in just after, the letters from A. The turn pill and the captured pieces fade in last, settling down into place as the last pawns form.
- **After the lobby** (a game that started while the lobby was showing, against a friend or the computer): about 3.1 seconds. The lobby's [arrival](../glossary.md#the-product-and-its-screens) has already brought the camera to rest at the default view over level A's glass, so nothing fades up and the camera stands still: levels B to E build on up from A as the armies form.
- **A page that opens on a game already under way** (a reload, a return, a rejoin): the same sequence in about 1.3 seconds, from much nearer.
- **Reduced motion:** the scene only fades in, in 150 ms.

## Orientation

Each player sees the board from their own side. The three board directions are drawn like this, from the default view:

| Board direction | White sees | Black sees |
| --- | --- | --- |
| File a–e | left to right, a on the left | right to left, a on the right |
| Rank 1–5 ("forward") | near to far: rank 1, White's back rank, nearest | far to near: rank 5, Black's back rank, nearest |
| Level A–E ("up") | bottom to top: level A at the bottom | bottom to top: level A at the bottom |

Levels are drawn as height for both players; only files and ranks are turned about for Black, as if Black had walked round the tower to the other side. So each player's army starts in the two rows nearest them: White's on the bottom two levels (the Rooks, Knights, and King in the nearest row of level A with the Bishops, Unicorns, and Queen behind them, and the ten Pawns in the two rows of level B above), Black's on the top two. White looks up the tower at Black's army; Black looks down it at White's. Only positions are turned; the pieces themselves are drawn the same way for both players. The tutorial is always seen from White's side.

The game's "up" is the screen's up: a pawn stepping *up* a level rises to the level above, and a pawn stepping *forward* moves away from its owner, deeper into the screen. For White, up and forward both lead toward Black's army; for Black, forward leads away into the screen and "up" (toward level A) leads down the tower.

## The default view

Every board screen starts with the camera in front of the tower, a little above the bottom level's plane (18° above the horizon) and turned a little to the player's right (16°), looking at the center of the tower, with the player's own first rank nearest. From there the camera looks between the levels rather than down through them. Both players' cameras start in the same direction relative to their own side; the orientation above is what makes each see their own side.

The camera stands at the distance that keeps the whole tower and every label inside the window and below the turn pill's band, with a little to spare, from every height the view can be turned to, not only from the opening. In a narrow window, such as a phone held upright, the camera stands further back and the tower is smaller, but nothing is cut off. The tower's center stands a little above the middle of the room between the turn pill and the bottom of the window, in the middle across, and stays at that one point whatever the player does: the camera only turns round it and moves toward or away from it, and the view never slides. (Seen from low down, where most of a game is played, the tower therefore sits a touch below the middle of that room; from overhead a little above it.) The band under the pill where the captured pieces hang is kept clear from the first move, so a capture never moves the board.

The whole view resets to the default only when the board screen is created: on a page load, a reload, a return to the game, and a move from another game's page. It does not reset between moves, on reconnecting, or when the opponent moves. There is no "reset view" control.

**Resizing the window** (including rotating a phone, or opening the browser's side panels) refits the view to the new shape as a fresh load at that size would frame it, keeping the direction the player has turned to and their zoom (the camera stands at the same multiple of the new fitted distance as it did of the old, within the new limits).

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
| Two-finger pinch | Zoom. A two-finger drag does not pan. |

Limits: the camera can zoom in to seven tenths of the fitted distance and out to one and a half times it, whatever the window's shape. Orbit goes all the way round horizontally. Vertically it goes from looking straight down on the tower, where the five levels nest like one board seen through glass, to 14° below the horizon, looking up past the tower into the night sky (a little less when zoomed out, since the camera always stays above the garden's ground). The arrow keys do nothing.

After a drag is released, the view keeps moving briefly and slows to a stop, like a spinning object with friction, and then holds exactly still.

### Begin

A mouse button, finger, or pen going down on the canvas, or a wheel turn, begins a possible drag. Nothing happens yet, to the view or to the board. A wheel turn skips straight to zooming. During the entrance the view cannot be turned.

### End without sending

A left button, finger, or pen released within 6 pixels of where it went down is a [press on the board](input-model.md#a-press-acts-on-release), and the board resolves it on release; the view moves by those few pixels at most. A right or middle button released without moving does nothing at all. Nothing about the view is recorded. The view never sends anything to the server, in this or any phase.

### Send

The view's equivalent of sending: the pointer moves while pressed, and the gesture becomes a drag. From here the view follows the pointer. A drag does nothing to the board: it does not select, clear, or play, wherever it started; see [the input model](input-model.md#a-press-acts-on-release).

### While in flight

While dragging, the view follows the pointer continuously: orbit follows the pointer's movement, zoom follows its vertical movement (middle drag) or each wheel notch. The pieces, markers, and selection stay as they are; a move arriving meanwhile animates in the moving view. The labels change post as the view crosses their thresholds.

### The answer arrives

On release, the drag ends and the view coasts to a stop over a moment. The board ignores the release, since the pointer travelled more than 6 pixels. The new angle and zoom stay until the player changes them or the board screen is rebuilt.

## Markers and colors

The marks of play are drawn in light on the glass of the cells they belong to, and show through every level above them, so a mark three levels down reads as clearly as one on top. They look the same from every angle. Every mark the board draws, and what it means:

| Mark | Looks like | Means |
| --- | --- | --- |
| Hover | One of the player's own pieces that can be selected now lifts a little under the pointer and catches more light. Pieces that cannot be selected do not lift. | The piece a press would pick up. |
| Level in focus | While the pointer is on a level, the other levels step back (see [the scene](#the-scene)). | Where the pointer is, in depth. |
| Selection | The piece rises higher than under hover and holds still inside a column of cool white light that grows up out of the glass round it, with a thin circle of the same light round its foot. As it is picked up, one ring of light spreads out from its foot and fades. Put down, the column sinks back into the glass. | This piece is [selected](../glossary.md#selection-and-board-state). |
| Destination | A thin gold circle on the glass of the cell, round a slight fill tinted with the level's color. Under the pointer the fill deepens and the circle grows a little. | A [legal destination](../glossary.md#moves-and-the-rules) of the selected piece that is an empty cell. |
| Capture | The same circle in red round the foot of an opponent's piece, with four short red arcs turning slowly round it. | A legal destination that captures that piece. |
| Last-move line | A thin mint line from a small circle on the cell the piece left to a larger mint circle round the piece where it landed, with a soft white light travelling along it. | The origin and destination of the most recent move. |
| Check | The King, cross and all, turns red, lit from below by a crown of red light lying on the glass round his foot, among four clusters of dark obsidian blades with red edges broken up through the glass round his foot; the blades come in with a strike as the check lands and then glint slowly. | That King is in [check](game-rules.md#check-checkmate-and-stalemate). A selected King in check keeps his red. |
| Checkmate | The mated King is knocked over (see [motion](#motion)); as he strikes the glass a pulse of light spreads across his level, the blades sink back into the glass, and the winning army hops in a wave out from him. | The game is over by checkmate; see [check and the end of the game](../play/check-and-game-end.md). |

A promotion square that a pawn can reach is marked once, like any other destination, though it stands for five moves. Marks give way rather than stack: the last move's small starting circle steps aside for a destination on the same cell, and its landing circle for a capture marker or the selection's own circle; the line itself stays.

Color is not the only difference between the marks: a destination is a still circle, a capture carries turning arcs, the last move is a line, and a King in check is red all over and ringed by blades. But gold, red, and mint carry most of the meaning; see [accessibility](../cross-cutting/accessibility.md).

## Motion

Every move that arrives while the board screen is showing animates on both players' boards, the mover's included, because each board shows a move only when the server returns it (see [the connection model](connection-and-seat.md#a-move-is-shown-only-when-the-server-returns-it)):

- **Glide.** The moving piece, rigid, slides from its origin to its destination in a straight line, easing out of its square and into the next, even for a Knight, and even through pieces and levels in between. A longer journey takes longer: from 360 ms for a short step to 560 ms for the longest. Its foot band changes color as it passes from level to level. A piece the player held up starts from that height and settles onto its square on the way.
- **Capture.** As the capturer reaches its victim, the victim's outline flashes, a small ring of light spreads on the glass at its foot, and it is knocked over away from the attacker, burning away as it falls.
- **Check.** A King put in check rocks on his foot as the check lands, and the blades come in.
- **Checkmate.** The mating piece's arrival knocks the King back onto the rim of his base, away from the piece that mated him (turned aside if straight away would take him off the board): fast at first, then slowing almost to a stop at the edge of his balance, where he hangs for a moment before he falls. As he strikes the glass the pulse spreads across his level and, a moment later, the winning army hops in a wave out from him.
- **Promotion.** A promoting pawn glides as the piece it becomes.
- **Last-move line.** The line moves to the new move the moment the move arrives, and its landing circle draws itself in round the piece as it lands.

One more motion answers the player rather than a move: pressing a piece that cannot be picked up now (an opponent's piece, or the player's own while it is not their turn) makes it **shake its head**, once per press. See [the input model](input-model.md#what-takes-a-press).

**Reduced motion.** When the player's system asks for reduced motion, no move glides, nothing is knocked over, nothing rocks or shakes, and no army hops: the position simply changes when the move arrives (a mated King is simply shown fallen), and the last-move line still shows which two cells it involved. The marks of play hold still too. The system setting is read each time a move lands, so changing it takes effect from the next move.

Moves do not animate when they were already in the record when the board screen appeared: after a reload, a return to the game, or the board appearing for the first time on a rejoin, the position is simply drawn, with the last-move line on the latest move (and a King mated in the final move already lying on his side). After a reconnect, the snapshot animates its last move only if that move is one this board had not yet shown.

The timings assume a smooth frame rate. Each drawn frame advances an animation by at most 33 ms, so on a device that draws fewer than 30 frames per second the glide and the capture take longer. The view's coasting after a drag stretches the same way.

A new move arriving while a glide is still running starts its own glide at once; the earlier piece jumps to its destination. While the tab is hidden, the scene is not drawn and animations pause where they are; when the player returns to the tab, a move that arrived meanwhile glides in from its origin.

A press during a glide can hit the moving piece where it stands at rest; a piece being knocked over cannot be hit at all.

## Modifiers

These apply to turning the view.

| Modifier | At the start | Changes while in flight |
| --- | --- | --- |
| Your color | Decides the orientation for the life of the board screen. The camera's starting position is the same for both colors. | Cannot change. |
| Whose turn it is | No effect on the view. | No effect; an arriving move animates in the moving view. |
| How you reached the page | Every way of reaching the board screen starts at the default view, after an entrance that depends on how (see [the entrance](#the-entrance)). | Not applicable. |
| Connection state | No effect. The view can be turned while connecting or reconnecting; while replaced, the dialog covers it. | No effect. |
| Game state | No effect while the game is in progress, in check, or frozen. Once the game is over, the [result card](../glossary.md#the-interface) covers the board; after the player closes it, the view can be turned again to study the final position. After a game that ends as the player watches, the card waits for the end to play out, and the view can be turned until it appears. | The game ending mid-drag puts the card over the board; see below. |
| Shift, Ctrl, or Cmd held | With the left button, the drag does nothing; with the right button, it orbits. They do not change what a press does to the board. | Pressing or releasing them mid-drag changes nothing; what the drag does is decided when it begins. |
| Input device | Mouse: as in the table above; only a left click without a drag acts on the board. Touch: one finger orbits, two fingers pinch to zoom, and only a one-finger tap acts on the board. Keyboard: no effect; the view cannot be turned from the keyboard. | Adding a second finger switches from orbit to pinch-zoom. |

## Cancel and interrupt

"While in flight" here means while dragging.

| Event | Before sending | While in flight |
| --- | --- | --- |
| Escape or Cancel | No effect. | No effect; the drag continues. |
| Pressing elsewhere or turning the view | Each pointer going down starts its own possible drag or press. | Not possible with one pointer; a second finger joins the gesture (see the last row). |
| Leaving the game page within the app | The view is discarded; returning starts at the default view. | Same. |
| The game ends | The result card covers the board, and the board behind it is inert; the view stays at its last angle. Closing the card makes it turnable again. | The card appears over the board; the drag may continue under it until release, since the pointer is already captured, but nothing further can start until the card is closed. |
| The server answers with an error | No effect on the view. | No effect. |
| The connection drops | No effect; the view can still be turned. | No effect. |
| The window loses focus or the tab is hidden | No effect; the view keeps its angle. | The drag ends if the browser cancels the pointer; otherwise it ends at the next release. |
| Reload or closing the tab | The view is lost; the next board screen starts at the default view. | Same. |
| The opponent acts | An arriving move animates in the current view; the view does not move. | Same, while the player drags. |
| Another tab takes the seat | The replaced dialog covers the board; the view keeps its angle behind it. | The dialog appears; the drag ends at release. |
| A second touch point or a cancelled touch | A second finger joins the gesture as a pinch-zoom; it never acts on the board. A cancelled touch, or a finger whose release the browser loses, ends the gesture without acting; a lone finger afterwards still orbits. | A second finger switches to pinch-zoom; a cancelled touch ends the drag where it is. |

After any interrupt the view stays where it was left, except when the board screen itself is rebuilt.

## Interactions with other systems

**Seat and turn.** The seat's color fixes the orientation. The turn changes nothing about the view.

**The game record.** The view is never recorded anywhere. What it shows is the position replayed from the record.

**Connection.** Independent of the connection: the view works while disconnected and keeps its angle while replaced (behind the dialog). A game against the computer has no connection to lose.

**The opponent.** Each player's view is their own. The opponent cannot see where the player is looking, and the player's view does not follow the opponent's moves.

**Other tabs and devices.** Each tab has its own view. A replaced tab keeps its view behind the dialog and still has it after "Play here".

**Game over.** At checkmate the King is knocked over and the winners cheer; at a draw nothing plays out. Then the result card covers the board; closing it leaves the final position to turn and zoom, with "Play again" below the tower.

**Stored seat.** The view is not stored; only the seat is.

**Keyboard, touch, and screen size.** The view cannot be turned from the keyboard; a keyboard player plays through the [move box](input-model.md#the-move-box) and sees the board at whatever angle it has. Touch works as described above. The scene fills the window at any size and is refitted whenever the window changes shape, so a narrow window or an upright phone shows the whole tower, smaller, rather than cropping it. On a touch screen a tap that just misses a piece or destination goes to it ([tap assist](input-model.md#what-takes-a-press)). See [screen sizes and touch](../cross-cutting/screen-sizes-and-touch.md).

## Edge cases

- **Occlusion.** From the default view some cells are hidden behind nearer pieces, and [a piece in front of a destination blocks it](input-model.md#what-takes-a-press). Turning the view, or typing the move in the [move box](input-model.md#the-move-box), is the only way to reach such a cell.
- **Looking up.** Orbiting below the horizon shows the tower from beneath its bottom level and the night sky above it; the pieces' bases are closed, and nothing flips. The camera never goes below the garden's ground.
- **Looking straight down.** From directly above, the five levels nest like one board seen through glass; the level under the pointer keeps its light while the others step back.
- **A glide through pieces.** Glides take the straight line, so a Knight's jump or a long slide passes visually through whatever lies between.
- **Labels changing post.** The level letters jump to another corner as the view turns or climbs past a threshold (with a short crossfade); a player watching for them may notice the change.

## Open questions and verification

- This document was brought up to `24c650c` from the code and `ARCHITECTURE.md` ("Camera", "The board", "The garden"), not checked in the running app: the level colors (`client/src/three/scene/palette.ts`), the step-back of other levels (`scene/focus.ts`, `STEP_BACK` 0.6), the labels' post (`scene/labelAnchors.ts`), the entrance (`three/intro/timeline.ts`), the fit and the lens shift (`three/cameraFit.ts`, `FitCameraToBoard.tsx`), the glide (`three/glide.ts`: 300 ms plus 45 ms per unit of distance, between 360 and 560 ms), the capture, check strike, refused shake, and the mate (`three/pieceMotion.tsx`, `scene/fx.tsx`, `lib/mate.ts`), and the garden (`scene/stage.tsx` and its parts).
- The camera controls' behavior (which button does what, damping, the effect of Shift/Ctrl/Cmd, touch gestures) is the 3D library's with panning turned off, and was read from the library, not tried by hand.
- Whether a drag in progress survives the result card appearing (with the board behind it made inert) is read from how the camera controls capture the pointer; not tried.
- Reduced motion is read from `client/src/three/motion.ts` and the scene; not tried with a real system setting.
- There is no "reset view" control (see [bug triage](../bug-triage.md) B-22).

Drafted against 3D Chess commit `24c650c`
