# Screen sizes and touch

## Summary

3D Chess is laid out for a desktop browser window, but it opens on a phone or a tablet too, and all of it works there. The page is sized to the device's width and never scrolls. The start screen and the other pre-game screens are a single centered column. The [board screen](../glossary.md#the-product-and-its-screens) is a 3D drawing that fills the visible window at any size, with the camera framed to fit the whole cube whatever the window's shape, and the [HUD](../glossary.md#input) panels arranged along its top and bottom edges in three columns, or in two on a window narrower than 640 pixels, so that they never overlap. On a touch screen a tap is a [press](../glossary.md#input) that acts when the finger lifts, one finger [orbits](../glossary.md#input) the view, and two fingers zoom and pan it without ever acting on the board. This document covers what changes with the window's size and shape, how touch and pens behave, and what the board needs from the device: a browser that can draw 3D (WebGL). What a press does is owned by [the input model](../foundations/input-model.md), and how the view turns by [the view](../foundations/the-view.md#turning-the-view); keyboard and screen reader use are in [accessibility](accessibility.md).

## The page and the window

The page declares itself as wide as the device's screen at a normal scale, so a phone shows it at its own width rather than as a shrunken desktop page. Pinch-zooming the page is not forbidden.

The page never scrolls, on any screen and at any size. Whatever does not fit in the window is cut off, and there is no way to scroll to it. On the board screen this is the intent: the board screen is exactly as tall as the part of the window the browser currently shows (on a phone, the height between the browser's own toolbars, following them as they appear and hide) and exactly as wide as the window. On the start screen, the share-link, join, and joined screens, and the crash screen, content wider or taller than the window would be lost from view, but at phone sizes everything on them fits.

The one text field in the app is the [move box](../glossary.md#the-interface)'s, at the bottom left of the board screen. Tapping it brings up a phone's on-screen keyboard; nothing else does.

## The start screen and the pre-game screens

The start screen, the [share-link screen](../start/waiting-for-an-opponent.md), the [join screen](../start/joining-a-game.md), the joined screen, and the crash screen are each one column, centered both ways, with a margin of 32 px on every side. Their text wraps to the window's width. The title "3D Chess" on the game page's pre-game screens is set smaller below 640 pixels wide, so on a phone it stays on one line; the start screen keeps the larger size, which on the narrowest phones (320 px) may still break onto two lines.

The [share link](../glossary.md#games-and-seats) on the share-link screen, `{origin}/game/{id}`, is shown in bold type in a dark box that wraps it anywhere, between any two characters, so a long address breaks onto as many lines as it needs and never runs off the screen. In a 375 px window a 34-character local address took two lines in a box 311 px wide.

Below the link is a "Copy link" button, which copies the link and then says "Copied" beside it (or "Could not copy; select the link instead" if the browser refused). The button is offered only where the browser lets a page copy text, which means an `https` address or `localhost`. On a plain `http` address, such as a development computer's address on a home network opened from a phone, there is no button, and the link has to be selected by hand: a long press on it, as on any web page text.

## The board at any size

The board screen's 3D drawing fills the whole window and follows it at once when the window is resized, when a phone or tablet is rotated, or when a window is split or snapped. Nothing stretches.

The [default view](../glossary.md#the-view) always looks at the board from the same direction, up and to the right of it, and stands back just far enough for the whole cube to fit in the window with a little room to spare, whatever the window's shape:

- **A landscape window** (wider than it is tall, which includes every ordinary desktop window and a phone on its side) is filled by the cube's height, with background to spare on both sides. Widening it adds background; it does not enlarge the board.
- **A portrait window** (taller than it is wide: a phone held upright, a tablet in portrait, a narrow browser window) is filled by the cube's width, with background above and below. The camera stands further back, so the board looks smaller: about half again as far on a 375 × 667 phone as in a desktop window, and further still on a taller phone. All of the board is in view, including the player's own nearest pieces.

Whenever the window changes size, the camera is framed again: it keeps the direction the player has orbited to, and any pan, but moves back to the distance that fits the new shape, so a zoom the player had made is undone. The farthest the view can be zoomed out also grows with the window: at least 25 units from the point it orbits, or half again the fitted distance on a narrow window, whichever is more. The nearest is 6 units, as always.

The cells, and so the targets for a press, shrink with the board. Measured at the default view as the distance between the centers of two neighboring cells, they are about 57 to 70 px apart in a 1280 × 720 window, 72 to 87 px in an 800 × 900 window, 36 to 42 px on a 375 × 667 phone held upright, and 30 to 36 px on the same phone on its side, where a Pawn is narrower still. Zooming the view in enlarges them.

The board is drawn at the screen's full sharpness on screens of up to twice the ordinary pixel density, which covers most high-density laptops and many phones; on a denser screen it is drawn at twice the ordinary density and scaled up, slightly softer.

## The HUD on narrow windows

The HUD is two bands laid over the board, one along the top and one along the bottom, each 10 px in from the left and right edges. Each band is a grid of three columns when the window is 640 px wide or more, and of two below that:

| Band | 640 px and wider | Narrower than 640 px |
| --- | --- | --- |
| Top, 10 px from the top | [Seat label](../game-page/seat-and-opponent-status.md) at the left, [turn indicator](../game-page/turn-indicator.md) centered, reconnecting banner at the right. | The turn indicator alone on the first row, centered; the seat label at the left and the reconnecting banner at the right on the second. |
| Below the top band | The frozen-board banner, centered, up to 480 px wide. | The same, up to the window's width less 20 px. |
| Bottom, 16 px from the bottom | [Move box](../glossary.md#the-interface) at the left (up to 260 px wide), [error banner](../game-page/error-banner.md) centered, [move list](../game-page/move-list.md) at the right. | The error banner alone on the first row, centered; the move box at the left and the move list at the right on the second, each at most half the width. |

The move list is at most 40% of the window's height and never more than 320 px, and scrolls beyond that.

The panels never overlap at any width. In a 375 × 667 window, measured in headless Chromium, the turn indicator took the top 42 px (10 to 52 px down), the seat label and the reconnecting banner sat side by side from 60 px down, the seat label's text wrapping onto two lines within its half, the error banner sat on its own row above the move box and the move list, and nothing touched. A panel that does not fit its column wraps its text instead.

Only three HUD panels take the pointer: the move box, the error banner, and the move list. A press on them never reaches the board. The seat label, the turn indicator, the reconnecting banner, the frozen-board banner, and the gaps between panels all let presses through to the board behind ([the input model](../foundations/input-model.md#what-takes-a-press)). On a small screen the three that do take the pointer cover a larger share of the board: on a phone on its side, the move list can be 150 px tall at the right, and the move box about 90 px at the left.

Because the board screen is exactly the height the browser shows, the bottom band (the move box, the error banner, and the move list's newest rows) stays above a phone browser's bottom toolbar, and moves up and down with it as the toolbar shows and hides.

## Dialogs on small screens

All three dialogs are centered over a backdrop that covers the whole window, and all fit a phone's width:

- **The [promotion dialog](../play/promotion.md)**: the five piece buttons sit in a row and wrap onto a second (or third) line when the panel is narrow; "Cancel" stays below them. Each piece button is roughly 40 px tall, a comfortable touch target.
- **The [end-game dialog](../play/check-and-game-end.md)**: at most 420 px wide, with at least 16 px between it and the window's edges, and 48 px of padding on each side inside it; on a 375 px screen its heading wraps within about 250 px.
- **The [replaced dialog](../session/second-tab.md)**: at most 420 px wide, with at least 16 px between it and the window's edges, and 32 px of padding on each side inside it; on a 375 px screen its text wraps within about 280 px.

The dialogs do not scroll either. On a phone on its side, each still fits the window's height.

## Touch

### Touch on the board

A touch on the board acts only as a tap: the finger touching down and lifting again within 6 px of where it touched, on the same piece or cell. The board acts when the finger **lifts**, not when it touches down ([the input model](../foundations/input-model.md#a-press-acts-on-release)). Anything else the fingers do turns the view and nothing more:

| Gesture | What happens |
| --- | --- |
| Tap | A press when the finger lifts: selects a piece, clears the selection, or plays a move. |
| One-finger drag | Orbit. It never selects, clears, or plays, wherever it starts, so a selection survives it. |
| Two fingers | Pinching or spreading zooms, and moving both fingers together pans, at the same time. Neither finger is a press: a second finger landing during a one-finger touch turns it into this gesture, and nothing on the board changes. |
| Lifting one of two fingers | The gesture stops. The finger still down does nothing until it too is lifted; a new touch starts a fresh gesture. Lifting the last finger is not a tap. |
| A third finger | The gesture stops, as above; not a press. |
| Double tap | Two taps, each acting on its own. The page does not zoom. |
| Long press | No menu opens. Whether the lift that ends it counts as a tap depends on whether the browser reports it as a click; not tried. |

There is no hover on a touch screen, and the board never uses hover anyway: nothing on the board lights up under a resting mouse either, so touch loses nothing. The start screen's and join screen's buttons grow slightly under a hovering mouse; on a touch screen they never do, and no hover effect sticks after a tap. Taps do not flash the gray highlight some phone browsers draw over tapped elements.

Touches on the board never scroll or zoom the page: the board claims every touch that starts on it for the view.

> Technical note: The camera controls set `touch-action: none` on the element that wraps the 3D drawing, which tells the browser not to pan or zoom the page for touches that begin there (`client/node_modules/three-stdlib/controls/OrbitControls.js`, `connect()`), and they read touches as `ONE: ROTATE, TWO: DOLLY_PAN`. The board itself listens only for clicks, which a browser synthesizes for a single-finger tap and never for a multi-finger gesture, and it ignores a click whose pointer travelled more than 6 px.

### Touch on the HTML panels

Touches on the move box, the error banner, the move list, and the dialogs are ordinary web page touches. A tap is a [click](../glossary.md#input) and acts when the finger lifts. A touch on one of these never reaches the board. A one-finger drag on the move list scrolls it. A touch on the seat label, the turn indicator, or the reconnecting or frozen-board banner is a touch on the board behind it. A pinch on an HTML panel that takes the pointer, or anywhere on the start screen and the pre-game screens, may zoom the whole page, since the page allows it; a page zoomed that way can be zoomed back out only by pinching on such a panel, because a pinch on the board zooms the view instead. See open questions.

The move box's field brings up the on-screen keyboard when tapped. The field turns off the browser's suggestions of earlier entries and its spell checking; a phone that capitalizes the first letter typed does no harm, because cells are read in either case. "Move" is a small button beside it; Enter on the on-screen keyboard also sends the move.

The error banner's "✕" is a single character with no padding, about 16 × 24 px, which is small for a finger. "Cancel" in the promotion dialog is plain text of ordinary size. The other buttons have generous padding.

### Pens

A pen tip acts like a finger or the left mouse button: a tap with the tip is a press when the tip lifts, and a drag with the tip orbits. On pens that report their barrel button as a secondary button, dragging with it held pans and never acts on the board; Shift, Ctrl, or Cmd held on a keyboard turns a tip drag into a pan, as with a mouse. A pen alone cannot zoom: zooming needs a pinch with two fingers, a wheel, or a middle mouse button.

### Mouse and touch together

On a device with both (a laptop with a touch screen, a tablet with a mouse), each input follows its own rules. A press is a press from either.

## Browser zoom, wheels, and trackpads

Browser zoom enlarges every HTML panel but never the board, which always fills the window and is framed to fit it; at high zoom the page behaves like a narrow window, with the HUD in its two-column arrangement. While the pointer is over the board, the wheel with Ctrl, and a trackpad pinch that the browser reports the same way, zoom the view, not the page; over an HTML panel that takes the pointer they zoom the page. See [accessibility](accessibility.md#text-size-and-zoom).

## The 3D requirement and performance

The board is drawn with WebGL, the browser's 3D drawing interface. The start screen and the pre-game screens do not need it, so creating a game, sharing the link, and joining all work on any browser. The need appears only when the game starts and the board screen replaces the joined or share-link screen.

On a browser where 3D drawing is unavailable (turned off, blocked by policy, unsupported by the graphics hardware, or failing), the product has no message of its own. Read from the code, the failure happens in a step the [crash screen](../foundations/screens-and-navigation.md#the-crash-screen) does not watch, so the likely result is a board screen with its HUD panels over an empty dark page, no board, and nothing explaining why; the crash screen is not expected to appear. The move box would still be there, and typed moves would still be sent and listed. Not tried; see open questions.

The board is redrawn only when something changes: while the view is being turned or is still drifting after a drag, while a move glides in, when the window changes size, and when a mark or a piece changes. When nothing changes, nothing is drawn, so an idle board screen costs almost nothing in battery or processor time. The 3D drawing asks the browser for the faster of two graphics processors where a device has both, and draws with smoothed edges.

## Cancel and interrupt

"Before sending" is while a touch gesture is in progress, or while the player is using a screen before a request leaves; "while in flight" is after a request has been sent (a create, a join, or a move). Each row says what the event means on a small screen or a touch device.

| Event | Before sending | While in flight |
| --- | --- | --- |
| Escape or Cancel | A phone or tablet without a keyboard has no Escape. The promotion dialog is cancelled by tapping "Cancel" or the darkened backdrop around the panel. | No effect. Nothing in flight can be cancelled. |
| Pressing elsewhere or turning the view | Only a tap acts on the board; every drag, pinch, or two-finger pan only turns the view, so a selection survives them; see [touch on the board](#touch-on-the-board). Touches on the move box, the error banner, and the move list never reach the board. | The board is [held](../glossary.md#selection-and-board-state): taps on it do nothing and "Move" is disabled, but one- and two-finger gestures still turn the view. |
| Leaving the game page within the app | A tap on "Start new game" or "Back to start" works as a click. Phone browsers may also go back on a swipe from the screen's edge; whether a one-finger drag that starts near the edge of the board goes back instead of orbiting (which would leave the game and [reset](../glossary.md#events-that-end-or-interrupt-a-request) the connection) was not tried. | Same. The answer to the request is lost to this page, as described in each feature's own table. |
| The game ends | The end-game dialog fits any phone; "Start new game" is tapped like any button. A drag already under way may go on turning the view until the finger lifts; no new touch reaches the board. | Same, when the player's own move ends the game. |
| The server answers with an error | Not applicable: nothing sent. | The error banner appears at the bottom center; in a narrow window on a row of its own above the move box and the move list, which it never covers. Its "✕" is a small target. |
| The connection drops | More common on phones (a change of network, the screen locking). The reconnecting banner appears at the top right, beside the seat label on a narrow window, without covering the turn indicator. The board and the move box stop taking input; gestures still turn the view. | Same. How a move in flight is settled is described in [making a move](../play/making-a-move.md#cancel-and-interrupt). |
| The window loses focus or the tab is hidden | On a phone, switching apps or locking the screen hides the tab. Mobile browsers may pause a hidden tab entirely, which the player then sees as a drop when they return: the reconnecting banner, then a [rejoin](../glossary.md#the-connection). A rotation while hidden is applied on return, and the view is framed again for the new shape. A touch in progress is cancelled by the switch. | Same. A move that arrived while the tab was paused is picked up from the snapshot after the rejoin. |
| Reload or closing the tab | Reloading returns the view to the default view, framed to fit the whole board in the window. Whether a downward drag on an HTML area triggers a phone browser's pull-to-refresh on this page, which never scrolls, was not tried. | Same. |
| The opponent acts | The opponent's device and window size make no difference to this player. On a small window the glide is small and easy to miss. | Same. |
| Another tab takes the seat | The replaced dialog fits a phone's width; "Play here" is tapped like any button. | Same. |
| A second touch point or a cancelled touch | A second finger touching down turns a one-finger orbit into a pinch and pan; neither finger acts on the board, and a selection survives. A third finger stops the gesture. A cancelled touch (the system taking over for a notification, an edge gesture, or an app switch) ends the gesture where it is, and acts on nothing. | Taps do nothing while held; the fingers still turn the view, and a cancelled touch ends the gesture. |

After any interrupt, the view keeps its direction and pan unless the board screen itself was rebuilt, and its zoom unless the window changed size, when it is framed again to fit the whole board.

## Interactions with other systems

**Seat and turn.** The seat's color fixes the [orientation](../foundations/the-view.md#orientation) on every screen size. On a narrow window the turn indicator has the top row to itself, and the seat label moves below it.

**The game record.** The move list is capped at 40% of the window's height and 320 px, which on a phone on its side is about six rows; it scrolls with a finger and moves itself to the newest move whenever one is added.

**Connection.** Phones drop connections more often than desktops, through network changes, sleep, and paused background tabs; each drop is handled as described in [the connection and seat model](../foundations/connection-and-seat.md#connection-states).

**The opponent.** Each player's window, device, and view are their own. Nothing about screen size or input is shared, and a player on a phone and a player on a desktop see the same game.

**Other tabs and devices.** A phone is a different browser from a laptop, so the [stored seat](../glossary.md#games-and-seats) does not follow the player: opening the share link on a phone mid-game arrives as a [visitor](../glossary.md#games-and-seats), and "Join Game" there is refused with "Game full" once both seats are taken. A game cannot be moved from one device to another. See [reloading and returning](../session/reload-and-return.md).

**Game over.** The end-game dialog fits any phone; the darkened final position behind it shows the whole board as framed for the window.

**Stored seat.** Kept per browser on every device; see "Other tabs and devices".

**Keyboard, touch, and screen size.** This document's subject for touch and screen size. The keyboard is covered in [accessibility](accessibility.md); on a phone the move box is also a way to play a move whose cell is hard to hit with a finger.

## Edge cases

- **Rotating mid-game.** The board and the HUD rearrange at once, and the view is framed again for the new shape: the direction the player had orbited to is kept, a zoom is undone. A selection, an open promotion dialog, and a glide in progress are all kept.
- **Zooming, then resizing.** Any change of window size, even a small one (a browser's sidebar opening, a phone's toolbar settling), moves the camera back to the fitted distance and undoes the player's zoom.
- **A very short window** (a split screen, a browser with many toolbars) shows a small board, since the board is framed by the height; the move list still takes up to 40% of that height.
- **A very wide window** shows the board at the same size as a narrower one of the same height, with more empty background at the sides.
- **A very tall, narrow window** frames the board by its width, with empty background above and below; the farthest zoom grows with it, so the view can still be zoomed out past the fitted distance.
- **Resizing during a drag.** The view is framed again for the new size, and the drag continues from there.
- **Crossing 640 px.** Resizing a window across 640 px wide rearranges the HUD at once between its three-column and two-column forms.
- **Copying the link from a phone on a home network.** Opened over a plain `http` network address, the share-link screen has no "Copy link"; the link has to be selected by hand, or copied from the address bar, which holds the same address.

## Open questions and verification

- **The pre-game screens on phones.** They are at least as tall as the window as the browser measures it with its toolbars hidden (`min-h-screen`), while the board screen follows the visible height. On a phone whose toolbars are showing, their centered content may sit slightly low, and the page cannot scroll. Not checked on a phone.
- **The on-screen keyboard.** What a phone's on-screen keyboard does to the board screen while the move box's field has focus (whether the visible height shrinks and the board is framed again, or the keyboard simply covers the bottom band) depends on the browser. Not tried.
- **A device without 3D drawing.** The 3D renderer is created in an asynchronous step whose failure the app's crash screen does not catch, so the expected result is an empty board area under the HUD with no message. The end-to-end configuration notes that without a working 3D backend the result is "a blank canvas". Not tried with 3D drawing turned off.
- **Losing the 3D context.** Phone browsers may discard a background page's 3D context; the board is redrawn only when something changes, so after the context is restored the board may stay blank until the view is turned or a move arrives. Read from the libraries; not tried.
- **Page zoom and system gestures on phones.** Whether a pinch on an HTML panel zooms the page, whether an edge swipe that starts on the board goes back, whether pull-to-refresh can fire on this page, and whether a long press on the board ends in a tap were not tried. Whether `touch-action: none` on the board's wrapper stops page zoom in every phone browser was not checked.
- **Two-finger gestures** were read from the code (the board acts only on a click, `client/src/three/tap.ts:16-17`, and a browser does not synthesize one for a multi-finger gesture); touch was emulated one finger at a time, and no real device was used.
- **Pens.** The barrel-button pan is read from how the camera controls map pen buttons; not tried with a pen.
- **Performance on low-end phones** (how smooth orbit and the glide are) was not measured.
- **Measured, in headless Chromium with its default font:** the fitted camera distance (about 14.5 units at 1280 × 720, 800 × 900, and 667 × 375; 21.7 at 375 × 667; 26.0 at 390 × 844), every corner of the cube inside the window at all five sizes, the cell spacing above, the HUD positions at 375 × 667 and 1280 × 720, the share link wrapping at 375 px, and a resize keeping the orbit direction while undoing a zoom. The framing is `client/src/three/FitCameraToBoard.tsx` with the math in `client/src/three/cameraFit.ts`; the HUD is `client/src/screens/GameScreen.tsx:378-436`; the page size is `:334`; the share link and "Copy link" are `:473-482` and `:500-526`.
- Everything else was read from `client/index.html`, `client/src/main.tsx`, `client/src/screens/*.tsx`, `client/src/three/TurnIndicator.tsx`, `client/src/three/tap.ts`, the `Canvas` defaults in `@react-three/fiber` (resize handling, pixel density capped at 2, renderer options), and the camera controls in `@react-three/drei` and `three-stdlib`. `client/src/three/cameraFit.test.ts` checks that the whole board fits a wide window, a square one, an upright phone, and a very tall narrow window from several directions. The end-to-end suite runs only in a desktop-sized window with a mouse; nothing in the repository tests touch on a real device or a missing 3D backend.

Verified against 3D Chess commit `90142a3`
