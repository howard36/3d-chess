# Screen sizes and touch

## Summary

3D Chess is laid out for any window, from a 320-pixel phone to a wide desktop, and all of it works on a phone or a tablet. The page is sized to the device's width and never scrolls. Every page is a 3D scene filling the window, with its HTML kept to the room the scene leaves: the home page's menu beside or around the tower, the lobby's heading and buttons above and below the kings, the board screen's [HUD](../glossary.md#the-interface) along its top edge (and the move box along the bottom while it has keyboard focus), and the tutorial's card beside or under the tower. The camera is framed to fit the whole tower whatever the window's shape, so nothing is cropped. On a touch screen a tap is a [press](../glossary.md#input) that acts when the finger lifts, one finger [orbits](../glossary.md#input) the view, and two fingers zoom it without ever acting on the board. This document covers what changes with the window's size and shape, how touch and pens behave, and what the app needs from the device: a browser that can draw 3D (WebGL). What a press does is owned by [the input model](../foundations/input-model.md), and how the view turns by [the view](../foundations/the-view.md#turning-the-view); keyboard and screen reader use are in [accessibility](accessibility.md).

## The page and the window

The page declares itself as wide as the device's screen at a normal scale, so a phone shows it at its own width rather than as a shrunken desktop page. Every page is exactly as tall as the part of the window the browser shows (on a phone, the height between the browser's own toolbars, following them as they appear and hide) and exactly as wide, and never scrolls; whatever does not fit is cut off. The board screen takes no text selection, long-press callout, or double-tap zoom, except in the move box, so a double tap on a phone never zooms the page.

The one text field in the app is the [move box](../glossary.md#the-interface)'s, which is out of sight until it takes keyboard focus, so on a phone it is met through a screen reader or an external keyboard. Once it is reached, tapping it brings up a phone's on-screen keyboard; nothing else does.

## The home page

The [preview](../glossary.md#the-product-and-its-screens) fills the window at any size and is framed on the tower alone, in the room the menu leaves, so the text never covers the tower.

- **A window wider than it is tall** (a desktop, a phone on its side) puts the menu in a column at the left, set in from the window's edge by a gutter (6% of the width, 24 to 112 pixels), over a dark fade that clears just past the tower; the column is 30% of the width (340 to 440 pixels). The title stands above the two tiles side by side and "How to play" under them. In a window 480 pixels tall or less everything is a size down (the title 50 pixels, the tiles 96 tall) in a column of 38% (300 to 340 pixels).
- **A window as tall as it is wide or taller** (a phone held upright) puts the title (64 pixels) above the tower and the tiles and "How to play" under it, at most 480 pixels wide.
- **An upright window 600 pixels wide or more** (a tablet) sets the title and the larger tiles (132 pixels tall) side by side in a band along the bottom, the title at the left, with the tower above.

A tile's name keeps to one line, its size following the tile's width (13 to 17 pixels, 18 on a tablet). The text keeps clear of a phone's notch and rounded corners. The preview takes no touch: a drag or pinch on it never turns the tower.

## The lobby

The side choices, the invitations, and the computer's difficulty stand over the lobby's scene, which fills the window. The kings stand on the glass's middle row, one square apart at every size; in a window narrower than 9:10 they stand smaller and further out, and a narrower window draws the camera back rather than pushing the kings apart. The page's heading stands at the top and "← Home" at the top left.

- **The side buttons** hang just under each king's foot and are sized with the kings as they appear: from a 15-pixel word in a button 92 by 46 pixels under a phone's small kings to a 20-pixel word in one 200 by 60 under a large screen's, never under 44 pixels tall.
- **The difficulty tiles** stand in a row under the kings where the side buttons were; on a phone on its side they are shorter, the robot beside the name.
- **The invitation to send's card** sits at the bottom center, at most 440 pixels wide and 16 pixels clear of each edge. In a short, wide window (at most 500 pixels tall and 13:10 or wider, a phone on its side) it docks at the bottom right instead, 320 pixels wide or 42% of the window's width if that is less, and the kings and the heading stand in the room left of it. The link stays on one line, cut off at its end with an ellipsis when too long; what is copied is still the whole address. "Copy link" is offered only where the browser lets a page copy text (an `https` address or `localhost`); elsewhere the link has to be selected by hand.
- **The invitation to the free seat's "Join game"** stands alone under the kings; its cards ("This game is taken", "No game here") sit where the host's card does.

## The board at any size

The board screen's 3D drawing fills the whole window and follows it at once when the window is resized, when a phone or tablet is rotated, or when a window is split or snapped. Nothing stretches.

The [default view](../glossary.md#the-view) always looks at the tower from the same direction and stands back just far enough for the whole tower and its labels to stay inside the window and below the HUD's band from every height the view can be turned to, whatever the window's shape:

- **A landscape window** (wider than it is tall, which includes every ordinary desktop window and a phone on its side) is filled by the tower's height, with the garden to spare on both sides.
- **A portrait window** (a phone held upright, a tablet in portrait, a narrow browser window) is filled by the tower's width, with the garden and sky above and below. The camera stands further back, so the board looks smaller, but all of it is in view.

Whenever the window changes shape, the camera is framed again as a fresh load at that size would frame it, keeping the direction the player has turned to and their zoom (the same multiple of the new fitted distance, within the new limits). The zoom limits follow the fit: from seven tenths of the fitted distance to one and a half times it, on every window shape.

The cells, and so the targets for a press, shrink with the board; zooming the view in enlarges them. On a phone the pieces are narrower than a fingertip, so a tap that just misses a piece or destination the player can act on goes to it ([tap assist](../glossary.md#input)): the nearest own selectable piece or legal destination within about 22 pixels of the touch takes it.

The board is drawn at the screen's full sharpness on screens of up to twice the ordinary pixel density, within a budget of about 4.5 million pixels, so a very large high-density window is drawn a little softer rather than at a cost it does not need.

## The HUD at every size

The HUD is kept to the edges and corners of the window, where the board is not.

| Part | Wide window (desktop, tablet on its side) | Phone held upright (520 px wide or less) | Short window (480 px tall or less: a phone on its side) |
| --- | --- | --- | --- |
| [Turn pill](../game-page/turn-indicator.md) | Top center, 12 px down, at least 300 px wide and as wide as its words need; 40 px tall (44 on a touch screen). | Across the top row, from 12 px at the left to the "?" at the right (13.5 px words below 400 px). | Top left, at least 264 px wide. |
| "How to play" | Top right, in words; a "?" in a circle in a window under 720 px wide. | A "?" at the top right, beside the pill (40 px on a touch screen). | Top right. |
| [Captured pieces](../game-page/turn-indicator.md#the-pieces-each-side-has-taken) (from the first capture) | Under the pill, never wider than it. The view is framed below them from the first move (the band kept at the top is 84 px rather than 56). | The same, across the pill's width. | Under the pill at the top left, one above the other, beside the tower; the view's framing is unchanged. |
| Status column (reconnecting, the [error banner](../game-page/error-banner.md), the frozen-board banner) | Under the pill and the captured pieces, centered. | Under them. | Under them, at the left. |
| [Move card](../game-page/move-list.md) (the move box alone, only while it has keyboard focus) | Bottom left, 232 px wide. | Across the bottom, 12 px in at each side. | Bottom right, beside the tower, narrowed to the free band (160 to 232 px). |
| "Play again" (after the result card is closed) | Bottom center, 18 px up. | The same. | The same. |

A window no wider than 13:9 that is not short (a tablet upright, a squarish desktop window) is framed by its width like a phone, and the move card takes the phone's arrangement there too: across the bottom, at most 560 px wide and centered. While the box shows, it lies over the board.

Nothing in the HUD overlaps anything else, and none of it covers a piece or a label of the tower; `client/e2e/hudFit.spec.ts` checks every HUD part against every piece and label at eight window sizes. Only "How to play", the error banner's "✕", the move card while it shows, "Retry", and "Play again" take the pointer; the pill, the captured pieces, the reconnecting line, the frozen-board banner, and the space around them let presses through to the board ([the input model](../foundations/input-model.md#what-takes-a-press)).

## Dialogs on small screens

All three dialogs are glass cards centered over a veil that covers the whole window, and all fit a phone's width and, on its side, its height. The [promotion dialog](../play/promotion.md)'s five piece tiles stay in one row, narrowed on a phone 400 pixels wide or less. The [result card](../play/check-and-game-end.md) and the [replaced dialog](../session/second-tab.md) keep a margin from the window's edges, and their text wraps.

## The tutorial

The [tutorial](../learn/the-tutorial.md)'s card keeps one height per layout, so the tower does not jump between lessons: beside the tower, at the left, in a window wide enough for the tower to clear it from every side (and in a short window), 376 pixels tall (396 for the Pawn's steps); otherwise along the bottom, 260 pixels tall (272 on a phone held upright, 284 on one 380 pixels wide or less, where the words take the card's whole width without the figure). The tower is framed in the room the card and "← Home" leave. On a touch screen "Reset" and the next button take a fingertip's 44 pixels. If a window is too short for a lesson, the lesson's words scroll inside the card.

## Touch

### Touch on the board

A touch on the board acts only as a tap: the finger touching down and lifting again within 6 pixels of where it touched, on the same piece or cell. The board acts when the finger lifts ([the input model](../foundations/input-model.md#a-press-acts-on-release)). Anything else the fingers do turns the view and nothing more:

| Gesture | What happens |
| --- | --- |
| Tap | A press when the finger lifts: selects a piece, clears the selection, or plays a move. |
| One-finger drag | Orbit. It never selects, clears, or plays, wherever it starts, so a selection survives it. |
| Two fingers | Pinching or spreading zooms. Moving both fingers together does not pan. Neither finger is a press: a second finger landing during a one-finger touch turns it into this gesture, and nothing on the board changes. |
| Lifting one of two fingers | The gesture stops; a new touch starts a fresh gesture. Lifting the last finger is not a tap. |
| Double tap | Two taps, each acting on its own. The page does not zoom. |
| Long press | No menu or callout opens. |

When a phone browser loses a finger's lift (it happens), the app notices from the next touch, a lost pointer, a blur, or the page being hidden, and forgets that finger, so a lone finger always orbits rather than being read as half of a pinch.

There is no hover on a touch screen. On the side choice a king lifts under a mouse; a tap on a king or its button picks it straight away and leaves no hover behind. Taps do not flash the gray highlight some phone browsers draw over tapped elements. Touches on the board never scroll or zoom the page: the board claims every touch that starts on it for the view.

### Touch on the HTML

Touches on the buttons, the move card, the error banner, and the dialogs are ordinary web page touches: a tap is a [click](../glossary.md#input) and acts when the finger lifts, and it never reaches the board. A touch on the turn pill, the captured pieces, the reconnecting line, or the frozen-board banner is a touch on the board behind it.

The move box's field brings up the on-screen keyboard when tapped; its suggestions and spell checking are off, and a phone that capitalizes the first letter does no harm, because cells are read in either case. Enter on the on-screen keyboard sends the move.

The error banner's "✕" is 28 × 28 pixels, small for a finger. On a touch screen the side buttons are never under 44 pixels tall, the turn pill is 44 pixels tall, "How to play" is a 40-pixel circle, and the tutorial's "Reset" and next button take 44 pixels.

### Pens

A pen tip acts like a finger or the left mouse button: a tap with the tip is a press when the tip lifts, and a drag with the tip orbits. Tap assist does not apply to a pen. A pen alone cannot zoom.

### Mouse and touch together

On a device with both, each input follows its own rules. A press is a press from either.

## Browser zoom, wheels, and trackpads

Browser zoom enlarges every HTML part but never the board, which always fills the window and is framed to fit it; at high zoom the page behaves like a narrow window. While the pointer is over the board, the wheel with Ctrl, and a trackpad pinch that the browser reports the same way, zoom the view, not the page. See [accessibility](accessibility.md#text-size-and-zoom).

## The 3D requirement and performance

Every page draws a 3D scene with WebGL, the browser's 3D drawing interface: the home page's preview, the lobby, the board, and the tutorial. Should the 3D scene's code fail to load (a dropped connection, a deploy that replaced it), each page goes on without it: the home page shows its menu over a dark window, the lobby's pages play on with no scene, the board screen keeps its HUD and move box with "Couldn't load the board" and "Retry", and the tutorial teaches in words. What a browser without WebGL at all shows was not tried; the app has no message of its own for it.

The board is redrawn only when something changes: while the view is being turned or is still drifting, while a move animates, when the window changes size, and when a mark or a piece changes. While the camera rests, the garden is drawn from a copy of itself, so a move or a selection redraws only the tower over it. An idle board screen costs almost nothing in battery or processor time. The home page's preview is the exception: while it moves it is drawn at every frame the browser offers, for as long as the page is open.

## Cancel and interrupt

"Before sending" is while a touch gesture is in progress, or while the player is using a screen before a request leaves; "while in flight" is after a request has been sent (a create, a join, or a move). Each row says what the event means on a small screen or a touch device.

| Event | Before sending | While in flight |
| --- | --- | --- |
| Escape or Cancel | A phone or tablet without a keyboard has no Escape. The promotion dialog is cancelled by tapping "Cancel" or the veil; the result card is closed by its close button or a tap on the veil. | No effect. Nothing in flight can be cancelled. |
| Pressing elsewhere or turning the view | Only a tap acts on the board; every drag or pinch only turns the view, so a selection survives them. | The board is [held](../glossary.md#selection-and-board-state): taps on it do nothing, but gestures still turn the view. |
| Leaving the game page within the app | A tap on "Play again", "How to play", or "← Home" works as a click. Phone browsers may also go back on a swipe from the screen's edge; whether a one-finger drag that starts near the edge of the board goes back instead of orbiting was not tried. | Same. The answer to the request is lost to this page. |
| The game ends | The result card fits any phone; "Play again" is tapped like any button. A drag already under way may go on turning the view until the finger lifts. | Same, when the player's own move ends the game. |
| The server answers with an error | Not applicable: nothing sent. | The error banner appears under the turn pill (at the top left on a phone on its side). Its "✕" is a small target. |
| The connection drops | More common on phones (a change of network, the screen locking). "Reconnecting…" appears under the turn pill, which dims. | Same. |
| The window loses focus or the tab is hidden | On a phone, switching apps or locking the screen hides the tab; mobile browsers may pause it entirely, which the player then sees as a drop when they return. A rotation while hidden is applied on return. A touch in progress is cancelled by the switch, and the app forgets it. | Same. |
| Reload or closing the tab | Reloading returns the view to the default view. Whether a phone browser's pull-to-refresh fires on this page, which never scrolls, was not tried. | Same. |
| The opponent acts | The opponent's device and window size make no difference to this player. | Same. |
| Another tab takes the seat | The replaced dialog fits a phone's width; "Play here" is tapped like any button. | Same. |
| A second touch point or a cancelled touch | A second finger turns a one-finger orbit into a pinch that zooms; neither finger acts on the board, and a selection survives. A cancelled touch ends the gesture where it is, and acts on nothing. | Taps do nothing while held; the fingers still turn the view. |

## Interactions with other systems

**Seat and turn.** The seat's color fixes the [orientation](../foundations/the-view.md#orientation) on every screen size. The turn pill keeps both stones and the lit half at every width.

**The game record.** The move list is never drawn, at any window size; it is in the page for screen readers.

**Connection.** Phones drop connections more often than desktops, through network changes, sleep, and paused background tabs; each drop is handled as described in [connection loss](../session/connection-loss.md).

**The opponent.** Each player's window, device, and view are their own.

**Other tabs and devices.** A phone is a different browser from a laptop, so the [stored seat](../glossary.md#games-and-seats) does not follow the player: opening the share link on a phone mid-game arrives as a [visitor](../glossary.md#games-and-seats), told "This game is taken". A game against the computer stays in the browser that played it.

**Game over.** The result card fits any phone; closed, it leaves the final position to turn with one finger and "Play again" at the bottom.

**Stored seat.** Kept per browser on every device.

**Keyboard, touch, and screen size.** This document's subject for touch and screen size. The keyboard is covered in [accessibility](accessibility.md).

## Edge cases

- **Rotating mid-game.** The board and the HUD rearrange at once, and the view is framed again for the new shape, keeping its direction and zoom. A selection, an open promotion dialog, and a glide in progress are kept.
- **A very short window** (a split screen) shows a small board, since the board is framed by the height; the HUD takes its short-window form, at the corners.
- **A very wide window** shows the board at the same size as a narrower one of the same height, with more garden at the sides.
- **Crossing 520 pixels wide, 720 wide, or 480 tall** rearranges the HUD at once between its forms.
- **Copying the link from a phone on a home network.** Opened over a plain `http` network address, the invitation to send has no "Copy link"; the link has to be selected by hand, or copied from the address bar.

## Open questions and verification

- **The on-screen keyboard.** What a phone's on-screen keyboard does to the board screen while the move box's field has focus depends on the browser. Not tried.
- **A device without 3D drawing.** Not tried; the app has no message for it.
- **Losing the 3D context.** Phone browsers may discard a background page's 3D context; whether the board is redrawn at once when it comes back was not tried.
- **Page zoom and system gestures on phones** (an edge swipe starting on the board, pull-to-refresh) were not tried.
- **Performance on low-end phones** was not measured here; the repository's benchmark suite measures the board's frames in software rendering only.
- Read from `client/index.html`, `client/src/index.css` (the `.landing`, `.lobby`, `.hud`, and `.learn` rules), `client/src/screens/landingLayout.ts`, `client/src/screens/learn/learnLayout.ts`, `client/src/three/cameraFit.ts`, `FitCameraToBoard.tsx`, `pixelBudget.ts`, `useTouchSafeControls.ts`, `CameraControls.tsx`, `tapAssist.ts`, and `client/src/three/lobby/lobbyMotion.ts` at `24c650c`. `client/src/three/cameraFit.test.ts`, `cameraSweep.test.tsx`, `client/e2e/hudFit.spec.ts`, `client/e2e/learn.spec.ts`, and `client/e2e/touchCamera.spec.ts` check the framing, the HUD's fit, the tutorial at six sizes, and a lost finger. Nothing here was checked on a real phone for this refresh.

Drafted against 3D Chess commit `24c650c`
