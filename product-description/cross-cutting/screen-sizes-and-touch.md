# Screen sizes and touch

## Summary

3D Chess is laid out for a desktop browser window, but nothing stops it from opening on a phone or a tablet, and most of it works there. The page is sized to the device's width and never scrolls. The start screen and the other pre-game screens are a single centered column. The [board screen](../glossary.md#the-product-and-its-screens) is a 3D drawing that fills the window at any size and follows every resize and rotation, with the [HUD](../glossary.md#input) panels pinned to its corners and edges. On a touch screen a tap is a [press](../glossary.md#input) that acts the moment the finger touches the screen, one finger [orbits](../glossary.md#input) the view, and two fingers zoom and pan it. This document covers what changes with the window's size and shape, how touch and pens behave, and what the board needs from the device: a browser that can draw 3D (WebGL). What a press does is owned by [the input model](../foundations/input-model.md), and how the view turns by [the view](../foundations/the-view.md#turning-the-view); keyboard and screen reader use are in [accessibility](accessibility.md).

## The page and the window

The page declares itself as wide as the device's screen at a normal scale, so a phone shows it at its own width rather than as a shrunken desktop page. Pinch-zooming the page is not forbidden.

The page never scrolls, on any screen and at any size. Whatever does not fit in the window is cut off, and there is no way to scroll to it. On the board screen this is the intent: the board fills the window. On the start screen, the share-link, join, and joined screens, and the crash screen, it means that content wider or taller than the window is simply lost from view.

There are no text fields anywhere in the app, so a phone's on-screen keyboard never appears.

## The start screen and the pre-game screens

The start screen, the [share-link screen](../start/waiting-for-an-opponent.md), the [join screen](../start/joining-a-game.md), the joined screen, and the crash screen are each one column, centered both ways, with a margin of 32 px on every side. Their text wraps to the window's width. On a very narrow phone the title "3D Chess" breaks onto two lines, "3D" and "Chess". Everything on these screens fits a phone held either way, with one exception.

The exception is the [share link](../glossary.md#games-and-seats) on the share-link screen: `{origin}/game/{id}` in large bold type in a dark box. It has no spaces, and the browser does not break it freely. In a mock-up of the same styles at 375 px wide in Chromium, a 34-character local address stayed on one line, about 517 px wide, and ran off both edges of the screen, cutting off the game id at its end; a longer address broke once, after a slash, and its first line still ran off both edges. Because the column is centered, the overflow is cut off on both sides, and because the page never scrolls, the hidden part cannot be reached. The page's own address, in the address bar, is the same link and can be copied from there. See open questions.

## The board at any size

The board screen's 3D drawing fills the whole window and follows it at once when the window is resized, when a phone or tablet is rotated, or when a window is split or snapped. Nothing stretches: the camera's proportions are updated to the window's, and the current angle and zoom of the [view](../glossary.md#the-view) are kept.

What decides how big the board looks is the window's **height**. At the [default view](../glossary.md#the-view) the board fills almost the whole height of the window whatever its size, and needs a width about equal to that height. So:

- **A landscape window** (wider than it is tall, which includes every ordinary desktop window and a phone on its side) shows the board's full width, with background to spare on both sides. Widening the window adds background; it does not enlarge the board.
- **A portrait window** (taller than it is wide: a phone held upright, a tablet in portrait, a narrow browser window) cuts off both sides of the board. By calculation, a 375 × 667 phone screen shows only about 58% of the board's width, and a 390 × 844 screen about 47%. On the 375 px screen the column of the player's own nearest level at the far left (a Rook and a Pawn) and the column of the opponent's two farthest levels at the far right fall outside the screen. The player has to zoom the view out (a pinch) to see the whole board; the farthest zoom allows it.

> Technical note: The camera's field of view is fixed vertically (40°), and the camera's starting position is the same for every window. The horizontal field of view follows the window's proportions, so a narrow window sees a narrower slice rather than a smaller board.

The cells, and so the targets for a press, shrink with the window's height. By calculation at the default view, a cell nearest the camera is about 100 px wide on an 800 px tall window, about 85 px on an upright phone, and about 48 px on a phone on its side (375 px tall), where the farthest cells are about 30 px and a Pawn is narrower still. Zooming the view in enlarges them.

The board is drawn at the screen's full sharpness on screens of up to twice the ordinary pixel density, which covers most high-density laptops and many phones; on a denser screen it is drawn at twice the ordinary density and scaled up, slightly softer.

## The HUD on narrow windows

The HUD panels are pinned to the window, not to the board, and keep fixed distances from its edges:

| Panel | Where | How wide |
| --- | --- | --- |
| [Seat label](../game-page/seat-and-opponent-status.md) | Top left, 10 px from the edges | Its text: about 220 px with the presence line. |
| [Turn indicator](../game-page/turn-indicator.md) | Top center, 16 px from the top | Its text, but no more than half the window's width. |
| Reconnecting banner | Top right, 10 px from the edges | Its text: about 170 px. |
| Frozen-board banner | Centered, 60 px from the top | Up to 480 px, but no more than half the window's width. |
| [Error banner](../game-page/error-banner.md) | Bottom center, 16 px from the bottom | Its text, but no more than half the window's width. |
| [Move list](../game-page/move-list.md) | Bottom right, 16 px from the bottom and 10 px from the right | Its widest row; at most 40% of the window's height, scrolling beyond that. |

The three centered panels can never be wider than half the window, so on a phone they wrap early: in the mock-up at 375 px, "White to move" wrapped onto two lines, the frozen-board banner's two sentences took about 240 px of height, and a long error took several lines.

> Technical note: The centered panels are placed by putting their left edge at the middle of the window and shifting them back by half their width. The browser sizes such a panel as if only the right half of the window were available.

On a typical desktop window none of the panels touch. On a phone they collide. In the same mock-up at 375 px wide:

- the seat label covers the left part of the turn indicator (the seat label is drawn on top);
- the reconnecting banner, when showing, covers the right part of the turn indicator and the right edge of the seat label, so while reconnecting little of "White to move" or "Black to move" may be visible;
- the frozen-board banner overlaps the bottom of both;
- the error banner covers the left part of the move list, hiding the start of its newest rows until the error is dismissed.

These figures come from a mock-up with the app's styles and a fallback font, not from the app on a phone; see open questions. Every panel except the turn indicator also blocks presses on the part of the board behind it ([the input model](../foundations/input-model.md#what-takes-a-press)), and on a small screen that is a larger share of the board: on a phone on its side, the move list alone can cover 40% of the window's height at the right.

On phones there is a further question: the board screen is sized to the full height the browser can offer, which on some phone browsers is taller than the area left visible by the browser's own toolbars. If so, the bottom of the board screen, with the move list's newest rows and the error banner, sits behind the toolbar, and the page cannot be scrolled to reveal it. Not checked on a phone.

## Dialogs on small screens

All three dialogs are centered over a backdrop that covers the whole window, and all fit a phone's width:

- **The [promotion dialog](../play/promotion.md)**: the five piece buttons sit in a row and wrap onto a second (or third) line when the panel is narrow; "Cancel" stays below them. Each piece button is roughly 40 px tall, a comfortable touch target.
- **The [end-game dialog](../play/check-and-game-end.md)**: at least 300 px wide, including its padding, so it fits a 320 px screen with a little room on each side.
- **The [replaced dialog](../session/second-tab.md)**: at most 420 px wide, with 48 px of padding on each side. On a phone it reaches both edges of the screen and its text wraps into the remaining width (about 280 px on a 375 px screen).

The dialogs do not scroll either. On a phone on its side, each still fits the window's height.

## Touch

### Touch on the board

A touch on the board is a press, exactly like a mouse button: the board acts when the finger **touches down**, not when it lifts ([the input model](../foundations/input-model.md#a-press-acts-at-once)). What the fingers do afterwards turns the view:

| Gesture | What happens |
| --- | --- |
| Tap | A press at the moment the finger touches down: selects a piece, clears the selection, or plays a move. Lifting the finger does nothing more. |
| One-finger drag | The press when the finger touches down, then orbit. |
| Two fingers | Each finger is a press of its own as it touches down. Then pinching or spreading zooms, and moving both fingers together pans, at the same time. |
| Lifting one of two fingers | The gesture stops. The finger still down does nothing until it too is lifted; a new touch starts a fresh gesture. |
| A third finger | A press as it touches down. The gesture stops, as above. |
| Double tap | Two presses. The page does not zoom. |
| Long press | A press; no menu opens. |

The second finger is the hazard. It is a press like any other, resolved by [what takes a press](../foundations/input-model.md#what-takes-a-press) at the point where it touches down: it can clear the selection, select a different piece, or, if it touches a highlighted cell, play that move, before the pinch has begun. The same is true of the first finger of any drag: a one-finger orbit that starts on a highlighted cell plays that move, and one that starts on an empty part of the board clears the selection.

There is no hover on a touch screen, and the board never uses hover anyway: nothing on the board lights up under a resting mouse either, so touch loses nothing. The start screen's and join screen's buttons grow slightly under a hovering mouse; on a touch screen they never do, and no hover effect sticks after a tap. Taps do not flash the gray highlight some phone browsers draw over tapped elements.

Touches on the board never scroll or zoom the page: the board claims every touch that starts on it for the view.

> Technical note: The camera controls set `touch-action: none` on the element that wraps the 3D drawing, which tells the browser not to pan or zoom the page for touches that begin there (`client/node_modules/three-stdlib/controls/OrbitControls.js`, `connect()`), and they read touches as `ONE: ROTATE, TWO: DOLLY_PAN`.

### Touch on the HTML panels

Touches on the HUD panels, the banners, and the dialogs are ordinary web page touches. A tap is a [click](../glossary.md#input) and acts when the finger lifts. A touch on the seat label, the move list, or a banner never reaches the board. A one-finger drag on the move list scrolls it. A pinch on an HTML panel, or anywhere on the start screen and the pre-game screens, may zoom the whole page, since the page allows it; a page zoomed that way can be zoomed back out only by pinching on an HTML area, because a pinch on the board zooms the view instead. See open questions.

The error banner's "✕" is a single character with no padding, about 16 × 24 px, which is small for a finger. "Cancel" in the promotion dialog is plain text of ordinary size. The other buttons have generous padding.

### Pens

A pen is a press like a finger or a mouse button: the board acts when the tip touches. For turning the view, a pen is treated as a mouse with one button: dragging with the tip orbits; on pens that report their barrel button as a secondary button, dragging with it held pans; Shift, Ctrl, or Cmd held on a keyboard turns a tip drag into a pan, as with a mouse. A pen alone cannot zoom: zooming needs a pinch with two fingers, a wheel, or a middle mouse button.

### Mouse and touch together

On a device with both (a laptop with a touch screen, a tablet with a mouse), each input follows its own rules. A press is a press from either.

## Browser zoom, wheels, and trackpads

Browser zoom enlarges every HTML panel but never the board, which always fills the window; at high zoom the page behaves like a narrow window, with the panels colliding as above and the pre-game screens cut off. While the pointer is over the board, the wheel with Ctrl, and a trackpad pinch that the browser reports the same way, zoom the view, not the page; over an HTML panel they zoom the page. See [accessibility](accessibility.md#text-size-and-zoom).

## The 3D requirement and performance

The board is drawn with WebGL, the browser's 3D drawing interface. The start screen and the pre-game screens do not need it, so creating a game, sharing the link, and joining all work on any browser. The need appears only when the game starts and the board screen replaces the joined or share-link screen.

On a browser where 3D drawing is unavailable (turned off, blocked by policy, unsupported by the graphics hardware, or failing), the product has no message of its own. Read from the code, the failure happens in a step the [crash screen](../foundations/screens-and-navigation.md#the-crash-screen) does not watch, so the likely result is a board screen with its HUD panels over an empty dark page, no board, and nothing explaining why; the crash screen is not expected to appear. Not tried; see open questions.

The board is redrawn only when something changes: while the view is being turned or is still drifting after a drag, while a move glides in, and when a mark or a piece changes. When nothing changes, nothing is drawn, so an idle board screen costs almost nothing in battery or processor time. The 3D drawing asks the browser for the faster of two graphics processors where a device has both, and draws with smoothed edges.

## Cancel and interrupt

"Before sending" is while a touch gesture is in progress, or while the player is using a screen before a request leaves; "while in flight" is after a request has been sent (a create, a join, or a move). Each row says what the event means on a small screen or a touch device.

| Event | Before sending | While in flight |
| --- | --- | --- |
| Escape or Cancel | A phone or tablet without a keyboard has no Escape. The promotion dialog is cancelled by tapping "Cancel" or the darkened backdrop around the panel. | No effect. Nothing in flight can be cancelled. |
| Pressing elsewhere or turning the view | Every finger that touches the board is a press, so a tap or the start of any gesture can select, clear, or play a move; see [touch on the board](#touch-on-the-board). Touches on HTML panels never reach the board. | The board is [held](../glossary.md#selection-and-board-state): taps on it do nothing, but one- and two-finger gestures still turn the view. |
| Leaving the game page within the app | A tap on "Start new game" or "Back to start" works as a click. Phone browsers may also go back on a swipe from the screen's edge; whether a one-finger drag that starts near the edge of the board goes back instead of orbiting (which would leave the game and [reset](../glossary.md#events-that-end-or-interrupt-a-request) the connection) was not tried. | Same. The answer to the request is lost to this page, as described in each feature's own table. |
| The game ends | The end-game dialog fits any phone; "Start new game" is tapped like any button. A drag already under way may go on turning the view until the finger lifts; no new touch reaches the board. | Same, when the player's own move ends the game. |
| The server answers with an error | Not applicable: nothing sent. | The error banner appears at the bottom center, wrapped within half the window's width; on a phone it may cover part of the move list, and it may sit behind a phone browser's bottom toolbar. Its "✕" is a small target. |
| The connection drops | More common on phones (a change of network, the screen locking). The reconnecting banner appears at the top right and, on a narrow window, covers part of the turn indicator. The board stops taking input; gestures still turn the view. | Same. How a move in flight is settled is described in [making a move](../play/making-a-move.md#cancel-and-interrupt). |
| The window loses focus or the tab is hidden | On a phone, switching apps or locking the screen hides the tab. Mobile browsers may pause a hidden tab entirely, which the player then sees as a drop when they return: the reconnecting banner, then a [rejoin](../glossary.md#the-connection). A rotation while hidden is applied on return. A touch in progress is cancelled by the switch. | Same. A move that arrived while the tab was paused is picked up from the snapshot after the rejoin. |
| Reload or closing the tab | Reloading returns the view to the default view, which on an upright phone again cuts off the board's sides. Whether a downward drag on an HTML area triggers a phone browser's pull-to-refresh on this page, which never scrolls, was not tried. | Same. |
| The opponent acts | The opponent's device and window size make no difference to this player. On a small window the glide is small and easy to miss. | Same. |
| Another tab takes the seat | The replaced dialog fits a phone's width; "Play here" is tapped like any button. | Same. |
| A second touch point or a cancelled touch | A second finger touching down is a press that can select, clear, or play a move, and then turns the one-finger orbit into a pinch and pan. A third finger is also a press and stops the gesture. A cancelled touch (the system taking over for a notification, an edge gesture, or an app switch) ends the gesture where it is; what its press did is already done. | Presses do nothing while held; the fingers still turn the view, and a cancelled touch ends the gesture. |

After any interrupt, the view keeps its angle and zoom unless the board screen itself was rebuilt, and the window's size and shape still decide how much of the board is visible.

## Interactions with other systems

**Seat and turn.** The seat's color fixes the [orientation](../foundations/the-view.md#orientation) on every screen size. On a narrow window the turn indicator wraps, and the seat label and the reconnecting banner may cover parts of it.

**The game record.** The move list is capped at 40% of the window's height, which on a phone on its side is about six rows; it scrolls with a finger and moves itself to the newest move whenever one is added.

**Connection.** Phones drop connections more often than desktops, through network changes, sleep, and paused background tabs; each drop is handled as described in [the connection and seat model](../foundations/connection-and-seat.md#connection-states).

**The opponent.** Each player's window, device, and view are their own. Nothing about screen size or input is shared, and a player on a phone and a player on a desktop see the same game.

**Other tabs and devices.** A phone is a different browser from a laptop, so the [stored seat](../glossary.md#games-and-seats) does not follow the player: opening the share link on a phone mid-game arrives as a [visitor](../glossary.md#games-and-seats), and "Join Game" there is refused with "Game full" once both seats are taken. A game cannot be moved from one device to another. See [reloading and returning](../session/reload-and-return.md).

**Game over.** The end-game dialog is at least 300 px wide and fits any phone; the darkened final position behind it keeps whatever part of the board the window shows.

**Stored seat.** Kept per browser on every device; see "Other tabs and devices".

**Keyboard, touch, and screen size.** This document's subject for touch and screen size. The keyboard is covered in [accessibility](accessibility.md).

## Edge cases

- **Rotating mid-game.** The board and the HUD rearrange at once; the view's angle and zoom, a selection, an open promotion dialog, and a glide in progress are all kept.
- **The player's own corner at the default view.** By calculation, the corner of the lattice nearest the camera, at the foot of the player's own corner Rook (White's `Ae1`, Black's `Ea5`), falls just below the bottom edge of the window at the default view, at every window size, because the board's vertical framing does not depend on the window's width. On a phone the error banner and the move list may cover the same area.
- **A very short window** (a split screen, a browser with many toolbars) shows a small board, since the board is sized by height; the move list still takes up to 40% of that height.
- **A very wide window** shows the board at the same size as a narrower one of the same height, with more empty background at the sides.
- **Resizing during a drag.** The drag continues against the new size.
- **Only portrait on a phone.** Nothing in the app suggests turning the phone; a player who never does sees the middle of the board and must pinch out to see the rest.

## Open questions and verification

- **The default view assumes a landscape window.** On an upright phone both sides of the board are cut off (by calculation, about 42% of its width on a 375 × 667 screen), including some of the player's own nearest pieces, until the player pinches out. This may be worth treating as a bug rather than documenting. Even in a wide window the default view cuts off the nearest bottom edge of the cube slightly; see [the default view](../foundations/the-view.md#the-default-view).
- **The share link overflows a phone's width.** In a Chromium mock-up of the share-link screen's styles at 375 px, the link ran off both edges and could not be scrolled into view. Not checked in the app itself or with a phone's own fonts. Likely a bug.
- **The HUD collides on a phone.** Panel widths and overlaps at 375 px and 320 px were measured on a mock-up with the app's inline styles in headless Chromium, with a fallback font; the real widths depend on the phone's font. Not checked in the app on a phone. The three centered panels wrapping at half the window's width looks like an unintended side effect of how they are centered.
- **The bottom of the board screen on phones.** The board screen is 100% of the "viewport height", which some phone browsers measure with their toolbars hidden; if so, the move list's newest rows and the error banner sit behind the toolbar and the page cannot scroll to reveal them. Not checked.
- **A device without 3D drawing.** The 3D renderer is created in an asynchronous step whose failure the app's crash screen does not catch, so the expected result is an empty board area under the HUD with no message. The end-to-end configuration notes that without a working 3D backend the result is "a blank canvas". Not tried with 3D drawing turned off.
- **Losing the 3D context.** Phone browsers may discard a background page's 3D context; the board is redrawn only when something changes, so after the context is restored the board may stay blank until the view is turned or a move arrives. Read from the libraries; not tried.
- **The second finger plays moves.** A second finger touching down is a press (see [the input model](../foundations/input-model.md#open-questions-and-verification)); on a phone, where every view change starts with a finger on the board, the chance of an accidental move or a lost selection is higher than with a mouse. Not tried on a touch device.
- **Page zoom and system gestures on phones.** Whether a pinch on an HTML panel zooms the page, whether an edge swipe that starts on the board goes back, and whether pull-to-refresh can fire on this page were not tried. Whether `touch-action: none` on the board's wrapper stops page zoom in every phone browser was not checked.
- **Pens.** The barrel-button pan is read from how the camera controls map pen buttons; not tried with a pen.
- **Performance on low-end phones** (how smooth orbit and the glide are) was not measured.
- Everything else was read from `client/index.html`, `client/src/main.tsx`, `client/src/screens/*.tsx`, `client/src/three/TurnIndicator.tsx`, the `Canvas` defaults in `@react-three/fiber` (resize handling, pixel density capped at 2, renderer options), and the camera controls in `@react-three/drei` and `three-stdlib`. The board's size and cell sizes at each window size were calculated from the camera settings in `client/src/screens/GameScreen.tsx` and the layout in `client/src/three/layout.ts`. The end-to-end suite runs only in a desktop-sized window with a mouse; nothing in the repository tests touch, a phone-sized window, or a missing 3D backend.

Verified against 3D Chess commit `d94507b`
