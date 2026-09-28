# Screen sizes and touch

## Summary

3D Chess is laid out for a desktop browser window, but it opens on a phone or a tablet too, and all of it works there. The page is sized to the device's width and never scrolls. The start screen and the other pre-game screens are a single centered column. The [board screen](../glossary.md#the-product-and-its-screens) is a 3D drawing that fills the visible window at any size, with the camera framed to fit the whole tower whatever the window's shape, and the [HUD](../glossary.md#input) panels arranged along its top and bottom edges in three columns, or in two on a window narrower than 640 pixels, so that they never overlap. On a touch screen a tap is a [press](../glossary.md#input) that acts when the finger lifts, one finger [orbits](../glossary.md#input) the view, and two fingers zoom and pan it without ever acting on the board. This document covers what changes with the window's size and shape, how touch and pens behave, and what the board needs from the device: a browser that can draw 3D (WebGL). What a press does is owned by [the input model](../foundations/input-model.md), and how the view turns by [the view](../foundations/the-view.md#turning-the-view); keyboard and screen reader use are in [accessibility](accessibility.md).

## The page and the window

The page declares itself as wide as the device's screen at a normal scale, so a phone shows it at its own width rather than as a shrunken desktop page. Pinch-zooming the page is not forbidden.

The page never scrolls, on any screen and at any size. Whatever does not fit in the window is cut off, and there is no way to scroll to it. On the board screen this is the intent: the board screen is exactly as tall as the part of the window the browser currently shows (on a phone, the height between the browser's own toolbars, following them as they appear and hide) and exactly as wide as the window. On the start screen, the share-link, join, and joined screens, and the crash screen, content wider or taller than the window would be lost from view, but at phone sizes everything on them fits.

The one text field in the app is the [move box](../glossary.md#the-interface)'s, in the move card, which a phone shows only with the Notation panel setting on. Tapping it brings up a phone's on-screen keyboard; nothing else does.

## The start screen and the pre-game screens

The start screen, the [share-link screen](../start/waiting-for-an-opponent.md), the [join screen](../start/joining-a-game.md), the joined screen, and the crash screen are each one column, centered both ways, with a margin of 32 px on every side. Their text wraps to the window's width. The title "3D Chess" on the game page's pre-game screens is set smaller below 640 pixels wide, so on a phone it stays on one line; the start screen keeps the larger size, which on the narrowest phones (320 px) may still break onto two lines.

The [share link](../glossary.md#games-and-seats) on the share-link screen, `{origin}/game/{id}`, is shown in bold type in a dark box that wraps it anywhere, between any two characters, so a long address breaks onto as many lines as it needs and never runs off the screen. In a 375 px window a 34-character local address took two lines in a box 311 px wide.

Below the link is a "Copy link" button, which copies the link and then says "Copied" beside it (or "Could not copy; select the link instead" if the browser refused). The button is offered only where the browser lets a page copy text, which means an `https` address or `localhost`. On a plain `http` address, such as a development computer's address on a home network opened from a phone, there is no button, and the link has to be selected by hand: a long press on it, as on any web page text.

## The board at any size

The board screen's 3D drawing fills the whole window and follows it at once when the window is resized, when a phone or tablet is rotated, or when a window is split or snapped. Nothing stretches.

The [default view](../glossary.md#the-view) always looks at the tower from the same direction, a little above its bottom level and to the player's right, and stands back just far enough for the whole tower and its labels to fit in the window with a little room to spare, whatever the window's shape, centered in the part of the window below the turn pill's row:

- **A landscape window** (wider than it is tall, which includes every ordinary desktop window and a phone on its side) is filled by the tower's height, with the garden to spare on both sides. Widening it shows more of the garden; it does not enlarge the board.
- **A portrait window** (taller than it is wide: a phone held upright, a tablet in portrait, a narrow browser window) is filled by the tower's width, with the garden and sky above and below. The camera stands further back, so the board looks smaller. All of the board is in view, including the player's own nearest pieces.

Whenever the window changes size, the camera is framed again: it keeps the direction the player has orbited to but moves back to the distance that fits the new shape, so a zoom the player had made is undone. The zoom limits follow the fit: from about seven tenths of the fitted distance to one and a half times it, on every window shape.

The cells, and so the targets for a press, shrink with the board. The figures measured for the board's earlier look (about 57 to 70 px between neighboring cells in a 1280 × 720 window, 36 to 42 px on a 375 × 667 phone held upright) no longer apply to the tower and have not been measured again. Zooming the view in enlarges them. On a phone the pieces are narrower than a fingertip, so a tap that just misses a piece or destination the player can act on goes to it ([tap assist](../glossary.md#input)): the nearest own selectable piece or legal destination within about 22 px of the touch takes it.

The board is drawn at the screen's full sharpness on screens of up to twice the ordinary pixel density, which covers most high-density laptops and many phones; on a denser screen it is drawn at twice the ordinary density and scaled up, slightly softer.

## The HUD at every size

The HUD is kept to the edges and corners of the window, where the board is not: the board is framed by the window's height in a landscape window, leaving the sides empty, and by its width in a portrait one, leaving the top and bottom empty.

| Part | Wide window (desktop, tablet on its side) | Phone held upright (520 px wide or less) | Short window (480 px tall or less: a phone on its side) |
| --- | --- | --- | --- |
| [Turn pill](../game-page/turn-indicator.md) | Top center, 12 px down, at least 300 px wide and as wide as its words need (in check, a little wider). | Across the top row, from 12 px at the left to the gear at the right (13.5 px words below 400 px; there, in check, the other half keeps only its stone). | Top left, at least 264 px wide. |
| [Captured pieces](../game-page/turn-indicator.md#the-pieces-each-side-has-taken) (from the first capture) | Under the pill, 4 px down, 18 px tall, never wider than the pill: the player's under their stone at the left, the opponent's under theirs at the right. The view is framed below them (the band kept at the top is 82 px rather than 56), from the first move. | The same, across the pill's width; everything taken from both sides, all ten pawns and a lead still fit at 360 px. | Under the pill at the top left, one above the other, the player's first, beside the tower; the view's framing is unchanged. |
| Status column (reconnecting, the [error banner](../game-page/error-banner.md), the frozen-board banner) | Under the pill and the captured pieces, centered. | Under them. | Under them, at the left. |
| Settings gear | Top right, 12 px in. | Top right. | Top right. |
| [Move card](../game-page/move-list.md) (the Notation panel on, or the move box alone while it has focus) | Bottom left, 232 px wide; the moves in two columns, about six rows before it scrolls. | Across the bottom, 12 px in at each side; the moves in one line that scrolls sideways, newest at the right. | Bottom right, beside the tower, narrowed to the free band (160 to 232 px); three rows before it scrolls. |

A window no wider than 13:9 that is not short (a tablet upright, a squarish desktop window such as 700 × 900 or 1024 × 768) is framed by its width like a phone, and the board reaches its bottom corners, so the move card takes the phone's arrangement there too: across the bottom, at most 560 px wide and centered. While it shows, the view is framed to leave that band (100 px) clear: turning the Notation panel on or off frames the view again, as a change of window size does. Where the card sits in a corner, the board is not moved. A list scrolled past its start fades out at that edge rather than cutting a row through.

The move card names the cell under the pointer only in a wide window on a device with hover; on a phone or tablet, and in the phone arrangements, it leaves that line out. Nothing in the HUD overlaps anything else, and none of it covers a piece or a label of the tower at the default view: checked in headless Chromium at 1280 × 720, 1920 × 1080, 1024 × 768, 768 × 1024, 700 × 900, 500 × 1000, 390 × 844, 390 × 664, 360 × 640, 844 × 390, 932 × 430, and 640 × 360, from both seats, in check and late in a game, with the Notation panel on; and, for the captured pieces, at 21 sizes from 360 × 640 to 3440 × 1440 (phones upright and on their side, tablets, desktops, and awkward shapes such as 500 × 1000 and 1280 × 560), from both seats, from the opening to a game stripped to the kings, in check and at the result, with the Notation panel on and off. On a touch screen the pill is 44 px tall, level with the gear.

Only the gear (and its panel), the error banner's "✕", and the move card while it shows take the pointer. A press on them never reaches the board. The pill, the reconnecting line, the frozen-board banner, and the space around them all let presses through to the board behind ([the input model](../foundations/input-model.md#what-takes-a-press)).

Because the board screen is exactly the height the browser shows, the move card stays above a phone browser's bottom toolbar, and moves up and down with it as the toolbar shows and hides.

The settings panel opens under the gear on a wide window; on a phone held upright it is a sheet across the bottom of the screen, up to 46% of its height, scrolling on its own, so the upper half of the board stays in view while a setting is changed. Its groups fold: Play and Board start open and the rest folded, so the panel does not run to several screens. On a touch screen every control in it is at least 44 px tall; a switch is drawn 52 × 32 px and takes presses 44 px tall. Keyboard focus on the gear and the panel's controls shows as the HUD's own soft white halo.

## Dialogs on small screens

All three dialogs are glass cards centered over a veil that covers the whole window, and all fit a phone's width:

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

> Technical note: The camera controls set `touch-action: none` on the element that wraps the 3D drawing, which tells the browser not to pan or zoom the page for touches that begin there (three's own `OrbitControls`, `connect()`), and they read touches as `ONE: ROTATE, TWO: DOLLY_PAN`, with panning turned off, so two fingers only zoom (`client/src/three/CameraControls.tsx`). The board itself listens only for clicks, which a browser synthesizes for a single-finger tap and never for a multi-finger gesture, and it ignores a click whose pointer travelled more than 6 px.

### Touch on the HTML panels

Touches on the move card, the error banner, the settings gear and panel, and the dialogs are ordinary web page touches. A tap is a [click](../glossary.md#input) and acts when the finger lifts. A touch on one of these never reaches the board. A one-finger drag on the move list scrolls it. A touch on the turn pill, or on the reconnecting line or frozen-board banner, is a touch on the board behind it. A pinch on an HTML panel that takes the pointer, or anywhere on the start screen and the pre-game screens, may zoom the whole page, since the page allows it; a page zoomed that way can be zoomed back out only by pinching on such a panel, because a pinch on the board zooms the view instead. See open questions.

The move box's field brings up the on-screen keyboard when tapped. The field turns off the browser's suggestions of earlier entries and its spell checking; a phone that capitalizes the first letter typed does no harm, because cells are read in either case. The ↵ button is a small button beside it; Enter on the on-screen keyboard also sends the move.

The error banner's "✕" is 28 × 28 px, which is small for a finger. "Cancel" in the promotion dialog is plain text of ordinary size. The other buttons have generous padding.

### Pens

A pen tip acts like a finger or the left mouse button: a tap with the tip is a press when the tip lifts, and a drag with the tip orbits. On pens that report their barrel button as a secondary button, dragging with it held does nothing and never acts on the board; Shift, Ctrl, or Cmd held on a keyboard stops a tip drag turning the view, as with a mouse. Tap assist does not apply to a pen. A pen alone cannot zoom: zooming needs a pinch with two fingers, a wheel, or a middle mouse button.

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
| Escape or Cancel | A phone or tablet without a keyboard has no Escape. The promotion dialog is cancelled by tapping "Cancel" or the veil around the card. | No effect. Nothing in flight can be cancelled. |
| Pressing elsewhere or turning the view | Only a tap acts on the board; every drag or pinch only turns the view, so a selection survives them; see [touch on the board](#touch-on-the-board). Touches on the move box, the error banner, and the move list never reach the board. | The board is [held](../glossary.md#selection-and-board-state): taps on it do nothing and the move box sends nothing, but one- and two-finger gestures still turn the view. |
| Leaving the game page within the app | A tap on "Start new game" or "Back to start" works as a click. Phone browsers may also go back on a swipe from the screen's edge; whether a one-finger drag that starts near the edge of the board goes back instead of orbiting (which would leave the game and [reset](../glossary.md#events-that-end-or-interrupt-a-request) the connection) was not tried. | Same. The answer to the request is lost to this page, as described in each feature's own table. |
| The game ends | The end-game dialog fits any phone; "Start new game" is tapped like any button. A drag already under way may go on turning the view until the finger lifts; no new touch reaches the board. | Same, when the player's own move ends the game. |
| The server answers with an error | Not applicable: nothing sent. | The error banner appears under the turn pill (at the top left on a phone on its side), clear of the board's middle. Its "✕" is a small target. |
| The connection drops | More common on phones (a change of network, the screen locking). "Reconnecting…" appears under the turn pill, which dims. The board and the move box stop taking input; gestures still turn the view. | Same. How a move in flight is settled is described in [making a move](../play/making-a-move.md#cancel-and-interrupt). |
| The window loses focus or the tab is hidden | On a phone, switching apps or locking the screen hides the tab. Mobile browsers may pause a hidden tab entirely, which the player then sees as a drop when they return: the reconnecting banner, then a [rejoin](../glossary.md#the-connection). A rotation while hidden is applied on return, and the view is framed again for the new shape. A touch in progress is cancelled by the switch. | Same. A move that arrived while the tab was paused is picked up from the snapshot after the rejoin. |
| Reload or closing the tab | Reloading returns the view to the default view, framed to fit the whole board in the window. Whether a downward drag on an HTML area triggers a phone browser's pull-to-refresh on this page, which never scrolls, was not tried. | Same. |
| The opponent acts | The opponent's device and window size make no difference to this player. On a small window the glide is small and easy to miss. | Same. |
| Another tab takes the seat | The replaced dialog fits a phone's width; "Play here" is tapped like any button. | Same. |
| A second touch point or a cancelled touch | A second finger touching down turns a one-finger orbit into a pinch that zooms; neither finger acts on the board, and a selection survives. A third finger stops the gesture. A cancelled touch (the system taking over for a notification, an edge gesture, or an app switch) ends the gesture where it is, and acts on nothing. | Taps do nothing while held; the fingers still turn the view, and a cancelled touch ends the gesture. |

After any interrupt, the view keeps its direction unless the board screen itself was rebuilt, and its zoom unless the window changed size, when it is framed again to fit the whole board.

## Interactions with other systems

**Seat and turn.** The seat's color fixes the [orientation](../foundations/the-view.md#orientation) on every screen size. The turn pill keeps both stones and the lit half at every width; on a phone held upright it fills the top row beside the gear.

**The game record.** The move list shows only with the Notation panel: on a phone held upright in one sideways-scrolling line, on a phone on its side in three rows; it scrolls with a finger and moves itself to the newest move whenever one is added.

**Connection.** Phones drop connections more often than desktops, through network changes, sleep, and paused background tabs; each drop is handled as described in [the connection and seat model](../foundations/connection-and-seat.md#connection-states).

**The opponent.** Each player's window, device, and view are their own. Nothing about screen size or input is shared, and a player on a phone and a player on a desktop see the same game.

**Other tabs and devices.** A phone is a different browser from a laptop, so the [stored seat](../glossary.md#games-and-seats) does not follow the player: opening the share link on a phone mid-game arrives as a [visitor](../glossary.md#games-and-seats), and "Join Game" there is refused with "Game full" once both seats are taken. A game cannot be moved from one device to another. See [reloading and returning](../session/reload-and-return.md).

**Game over.** The end-game dialog fits any phone; the darkened final position behind it shows the whole board as framed for the window.

**Stored seat.** Kept per browser on every device; see "Other tabs and devices".

**Keyboard, touch, and screen size.** This document's subject for touch and screen size. The keyboard is covered in [accessibility](accessibility.md); on a phone the move box is also a way to play a move whose cell is hard to hit with a finger.

## Edge cases

- **Rotating mid-game.** The board and the HUD rearrange at once, and the view is framed again for the new shape: the direction the player had orbited to is kept, a zoom is undone. A selection, an open promotion dialog, and a glide in progress are all kept.
- **Zooming, then resizing.** Any change of window size, even a small one (a browser's sidebar opening, a phone's toolbar settling), moves the camera back to the fitted distance and undoes the player's zoom.
- **A very short window** (a split screen, a browser with many toolbars) shows a small board, since the board is framed by the height; the HUD takes its short-window form, at the corners.
- **A very wide window** shows the board at the same size as a narrower one of the same height, with more empty background at the sides.
- **A very tall, narrow window** frames the board by its width, with empty background above and below; the farthest zoom grows with it, so the view can still be zoomed out past the fitted distance.
- **Resizing during a drag.** The view is framed again for the new size, and the drag continues from there.
- **Crossing 520 px wide or 480 px tall.** Resizing a window across either rearranges the HUD at once between its desktop, upright-phone, and short-window forms (see the table above).
- **Copying the link from a phone on a home network.** Opened over a plain `http` network address, the share-link screen has no "Copy link"; the link has to be selected by hand, or copied from the address bar, which holds the same address.

## Open questions and verification

- **The pre-game screens on phones.** They are at least as tall as the window as the browser measures it with its toolbars hidden (`min-h-screen`), while the board screen follows the visible height. On a phone whose toolbars are showing, their centered content may sit slightly low, and the page cannot scroll. Not checked on a phone.
- **The on-screen keyboard.** What a phone's on-screen keyboard does to the board screen while the move box's field has focus (whether the visible height shrinks and the board is framed again, or the keyboard simply covers the bottom band) depends on the browser. Not tried.
- **A device without 3D drawing.** The 3D renderer is created in an asynchronous step whose failure the app's crash screen does not catch, so the expected result is an empty board area under the HUD with no message. The end-to-end configuration notes that without a working 3D backend the result is "a blank canvas". Not tried with 3D drawing turned off.
- **Losing the 3D context.** Phone browsers may discard a background page's 3D context; the board is redrawn only when something changes, so after the context is restored the board may stay blank until the view is turned or a move arrives. Read from the libraries; not tried.
- **Page zoom and system gestures on phones.** Whether a pinch on an HTML panel zooms the page, whether an edge swipe that starts on the board goes back, whether pull-to-refresh can fire on this page, and whether a long press on the board ends in a tap were not tried. Whether `touch-action: none` on the board's wrapper stops page zoom in every phone browser was not checked.
- **Two-finger gestures** were read from the code (the board acts only on a click, `client/src/three/tap.ts:16-17`, and a browser does not synthesize one for a multi-finger gesture); touch was emulated one finger at a time, and no real device was used.
- **Pens.** The barrel button's doing nothing is read from how the camera controls map pen buttons with panning off; not tried with a pen.
- **Performance on low-end phones** (how smooth orbit and the glide are) was not measured.
- **Measured, in headless Chromium with its default font, for the board's earlier look** (not measured again for the tower, and in need of re-verification): the fitted camera distance, every corner of the board inside the window at all five sizes, the cell spacing, the HUD positions at 375 × 667 and 1280 × 720, the share link wrapping at 375 px, and a resize keeping the orbit direction while undoing a zoom. The framing is `client/src/three/FitCameraToBoard.tsx` with the math in `client/src/three/cameraFit.ts`; the HUD is `client/src/screens/GameScreen.tsx:384-442`; the page size is `:340`; the share link and "Copy link" are `:483-492` and `:514-540`.
- Everything else was read from `client/index.html`, `client/src/main.tsx`, `client/src/screens/*.tsx`, `client/src/three/TurnIndicator.tsx`, `client/src/three/tap.ts`, the `Canvas` defaults in `@react-three/fiber` (resize handling, pixel density capped at 2, renderer options), and the camera controls in `@react-three/drei` and `three-stdlib`. `client/src/three/cameraFit.test.ts` checks that the whole board fits a wide window, a square one, an upright phone, and a very tall narrow window from several directions. The end-to-end suite runs only in a desktop-sized window with a mouse; nothing in the repository tests touch on a real device or a missing 3D backend.

- The board's look changed at `bb16fed` (the glass tower, the porcelain and charcoal pieces, the gold and red markers, the mint last-move line, the red King in check); this document's mentions of it were brought up to date from the code and [the view](../foundations/the-view.md), not checked in the running app, and need re-verification.

Verified against 3D Chess commit `4e18386`; the HUD's arrangement at each size against `f7bff4d`
