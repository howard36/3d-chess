# Accessibility

## Summary

3D Chess is built for a player who can see the screen and use a pointer. The game itself happens on the 3D [board](../glossary.md#the-board), and the board can be used only by [pressing](../glossary.md#input) it with a mouse, a finger, or a pen: it cannot be reached, navigated, or played from the keyboard, the [view](../glossary.md#the-view) cannot be turned from the keyboard, and the board tells a screen reader nothing. Everything around the board is ordinary HTML. The buttons that create and join a game, the [error banner](../glossary.md#the-interface)'s dismiss button, the [promotion dialog](../play/promotion.md), "Start new game", "Play here", and the [crash screen](../foundations/screens-and-navigation.md#the-crash-screen)'s link can all be reached with Tab and used with Enter or Space, and several messages are marked so that a screen reader announces them when they appear. This document collects what the product offers and lacks for keyboard users, screen reader users, players with low vision or a color vision deficiency, and players sensitive to motion. How a press works is owned by [the input model](../foundations/input-model.md); window size, touch, and the 3D requirement by [screen sizes and touch](screen-sizes-and-touch.md).

## Who can do what

| Player | Can | Cannot |
| --- | --- | --- |
| Pointer and sight (mouse, touch, or pen) | Everything the product offers. | Nothing is withheld. |
| Keyboard only | Create a game ("Start New Game"), join one ("Join Game"), dismiss an error, pick or cancel in a promotion dialog that a pointer opened, leave a finished game ("Start new game"), take the seat back ("Play here"), and leave the crash screen ("Back to start"). | Select a piece, play a move, or turn the view. The game cannot be played at all. |
| Screen reader | Hear errors, the [frozen-board banner](broken-game-record.md), the crash screen, and the start screen's connection status when they appear; read the [seat label](../game-page/seat-and-opponent-status.md), [turn indicator](../game-page/turn-indicator.md), and [move list](../game-page/move-list.md) by moving through the page; use every HTML control. | Perceive the position, a selection, the legal destinations, check, or an arriving move, except by reading the move list; learn that the game has ended, except by finding the end-game dialog's text. |
| Low vision | Enlarge the HTML panels with browser zoom; bring the board closer by zooming the view with the wheel, a middle drag, or a pinch. | Enlarge the board with browser zoom (it always fills the window), or scroll to content that zoom pushes out of the window. |
| Color vision deficiency | Tell White's pieces from Black's, which differ in lightness. | Tell the selection and destination marks from the [last-move trace](../glossary.md#selection-and-board-state), or a selected King from a King in [check](../glossary.md#moves-and-the-rules), by anything but hue. |
| Sensitive to motion | Avoid most motion by not turning the view; nothing moves by itself except an arriving move. | Turn off the [glide](../glossary.md#selection-and-board-state), the [fade](../glossary.md#selection-and-board-state), or the view's drift after a drag. The app ignores the system's "reduce motion" setting. |

## Keyboard

### What Tab reaches

Tab moves keyboard focus through the page's HTML buttons and its one link, in page order, and through nothing else:

| Screen | Reachable with Tab |
| --- | --- |
| [Start screen](../glossary.md#the-product-and-its-screens) | "Start New Game". While it reads "Creating Game..." it is disabled and skipped. |
| Share-link screen | Nothing. The [share link](../glossary.md#games-and-seats) is plain text, not a link, and there is no copy button. |
| Join screen | "Join Game". |
| Joined screen | Nothing. |
| Board screen | Nothing on the board. The error banner's "✕" when an error shows; the five piece buttons and "Cancel" while the promotion dialog is open; "Start new game" while the [end-game dialog](../play/check-and-game-end.md) shows. |
| Any game page screen, when [replaced](../glossary.md#events-that-end-or-interrupt-a-request) | "Play here", after every control that comes earlier in the page, including controls the [replaced dialog](../session/second-tab.md) covers. |
| Crash screen | "Back to start", a link. |

The error banner's "✕" is on every game page screen, not only the board screen, whenever an error is showing. The seat label, the turn indicator, the banners' text, the headings, and the board are never focusable. When the move list is long enough to scroll, some browsers make it reachable with Tab so that the arrow keys can scroll it; the app does nothing to allow or prevent this (see open questions).

"Start New Game" and "Join Game" show a thick blue ring whenever they have focus, including just after a mouse click. The other buttons and the link show the browser's own focus outline.

### What the keyboard cannot do

- **Play.** There is no keyboard equivalent of a press on the board: no way to select a piece, see its legal destinations, or play a move, and no text field to type a move into. A keyboard user can create or join a game and then watch the board appear, but can never move.
- **Turn the view.** The arrow keys, Page Up and Down, and + and − do nothing to the view. The board cannot take focus, so no key reaches it.

  > Technical note: The camera controls can pan the view with the arrow keys, but only if the app asks for it. It does not (the `OrbitControls` wrapper's `keyEvents` option defaults to off and `client/src/screens/GameScreen.tsx` does not set it), and the canvas has no tab stop in any case.

- **Close the end-game or replaced dialog.** Neither has a close control for anyone; the keyboard is no different.
- **Copy the share link from the page.** The link can be selected only with a pointer. It is the same address as the page itself, so copying it from the browser's address bar (Ctrl+L or Cmd+L, then copy) gives the same link.
- **Use shortcuts.** There are none. Shift, Ctrl, Cmd, and Alt change nothing on their own ([the input model](../foundations/input-model.md#html-controls-and-the-keyboard)).

### Escape

Escape is the only key the app handles itself, and only in the promotion dialog, only while keyboard focus is inside it; there it cancels the promotion exactly like "Cancel". Focus is inside the dialog from the moment it opens, and stops being inside it when the player tabs out of it or clicks the white panel anywhere but a button. Escape anywhere else does nothing: it does not clear a [selection](../glossary.md#selection-and-board-state), dismiss the error banner, or close the end-game or replaced dialog.

## Focus

Nothing is focused when any page loads, and the app moves focus in exactly one place:

- **The promotion dialog** puts focus on its first button, "Queen", as it opens, but the press on the board that opened it takes focus back to the page a moment later, so the dialog opens with nothing focused: Escape, Enter, and Space do nothing until the player presses Tab, which reaches "Queen" first ([promotion](../play/promotion.md#begin); confirmed in the scripted pass). Focus is not held in the dialog: Tab past "Cancel" leaves it (to the error banner's "✕" if one is showing, then to the browser's own controls), Shift+Tab from "Queen" leaves it backwards, and a click on the panel between buttons drops focus to the page. Once focus is outside, Escape no longer cancels. When the dialog closes, by a pick, a cancel, or because the board stopped taking input, focus is not put anywhere: it falls to the page itself, and the next Tab starts again from the top of the page.
- **The end-game dialog** does not take focus. A keyboard user has to Tab to "Start new game"; on the board screen it is normally the first stop, since nothing before it is focusable unless an error is showing or the move list has become a tab stop.
- **The replaced dialog** does not take focus either, and does not stop Tab from reaching what it covers. Controls earlier in the page come first: the end-game dialog's "Start new game" and the error banner's "✕", both hidden behind the replaced dialog's backdrop, can be reached and activated with Enter even though they cannot be clicked. "Start new game" reached this way leaves the game for the start screen.
- **A control that disappears** (clicking "Join Game", "✕", "Play here", a piece button, "Cancel", or "Start New Game" as the page changes) takes focus with it. Focus drops to the page and nothing moves it to the new content.
- **Page changes** within the app (the start screen to a new game, a game back to the start screen) move no focus and do not change the page title, so nothing signals the change to a keyboard or screen reader user.

## Screen readers

### What is marked for assistive technology

| Element | Marked as | What a screen reader is told |
| --- | --- | --- |
| Start screen error, "Error: {message}" | alert | Announced when it appears. |
| Start screen status, "Connecting to server…" or "Reconnecting to server…" | status | A change from one to the other is announced politely. The line shown as the page loads is usually not announced, and its disappearance on connecting is not. |
| Error banner, "Error: {message}", and its "✕" | alert; the button is named "Dismiss error" | Announced when it appears. The button is read as "Dismiss error", not as the ✕ glyph. |
| Reconnecting banner, "Reconnecting…" | status | Meant to be announced politely. It is added to the page together with its text, which some screen readers do not announce; see open questions. |
| Frozen-board banner | alert | Announced when it appears, including on a page load that shows a frozen board. |
| Crash screen | alert (heading, sentence, and link) | Announced when it replaces the page. |
| Promotion dialog | dialog, modal, named "Promote to" | Entered as a dialog named "Promote to", with buttons "Queen", "Rook", "Bishop", "Knight", "Unicorn", and "Cancel". A screen reader that honors the modal marking hides the rest of the page while it is open. |
| Replaced dialog | alert dialog, named "This game is open in another tab" | Named by its heading. Its sentence is not linked to it as a description, it is not marked modal, and it does not take focus, so whether it is announced when it appears depends on the screen reader. |
| End-game dialog | nothing | An ordinary heading ("White wins by checkmate!", "Black wins by checkmate!", or "Draw by stalemate!") and a button appear. Nothing announces them. |
| Move list | an ordered list named "Move history" | Read when the user reaches it, one row per numbered White–Black pair. New rows are not announced. |
| Seat label, its presence line, and the turn indicator | plain text | Read when the user reaches them. Changes are never announced. |
| The board | a drawing surface with no text alternative | Nothing. |

The start screen, the share-link, join, and joined screens have one heading, "3D Chess"; the crash screen's heading is "Something went wrong"; the board screen has no heading of its own, only the dialogs' titles. No page has landmarks (main content, navigation), so a screen reader user moves through each page element by element.

### What a screen reader user cannot learn

- **The position.** The board exposes no piece, cell, or square. The only text form of the game is the move list, in [cell notation](../glossary.md#the-board), from which the position would have to be rebuilt by replaying every move mentally from the [starting position](../foundations/game-rules.md#the-starting-position). The move list is hidden until the first move.
- **A selection, the legal destinations, or the last move.** The [move markers](../glossary.md#selection-and-board-state) and the last-move trace have no text. The newest move is the last entry in the move list.
- **Check.** Shown only by the red [check glow](../glossary.md#selection-and-board-state). No text anywhere on the page says "check".
- **An arriving move.** The opponent's move glides in silently; the move list gains an entry and the turn indicator changes, and neither is announced.
- **The opponent joining.** The share-link screen is replaced by the board screen without an announcement.
- **Presence.** "Opponent: online" and "Opponent: offline" change silently.
- **The end of the game.** Not announced; see the end-game dialog above. Because it is not marked as a dialog, a screen reader can still read the seat label, the turn indicator, and every row of the move list behind it, which a pointer user cannot scroll once the dialog is up ([check and the end of the game](../play/check-and-game-end.md#edge-cases)).

## Color and contrast

### Marks told apart only by color

Every mark on the board is described in [the view](../foundations/the-view.md#markers-and-colors). How each pair differs:

| Pair | What tells them apart |
| --- | --- |
| Selection glow (amber) and check glow (red) on a King | Color only. A selected King in check shows only the red. |
| Destination fill (amber) and last-move trace (teal) | Color only: both tint a whole cell. On a shared cell the amber replaces the teal. |
| Selection ring (gold) and capture ring (red) | Color, and a small difference in width (the capture ring is slightly wider). |
| Quiet-move dot (amber) and the rings | Shape as well as color: a dot at the cell's center, not a ring on its floor. |
| White's pieces (ivory) and Black's pieces (graphite) | Lightness. Readable without color. |

Check is conveyed only by the red glow: no text, no sound, no icon. For a player with a red–green color vision deficiency, the red marks (the check glow and the capture ring) against the amber and gold ones are the pairs most at risk; this was not tested with a simulation.

### Contrast, by calculation from the colors in the code

The marks are drawn in flat, unlit colors, so their contrast against the plain scene background can be worked out; the fog fades marks on far cells further toward the background. The pieces are shaded by the scene's lighting, so their figures are only a guide.

| Mark or text | Against | Contrast ratio |
| --- | --- | --- |
| Selection ring (gold) | the scene background | about 1.0 : 1 |
| Quiet-move dot (amber) | the scene background | about 1.1 : 1 |
| Destination fill | the last-move trace | about 1.1 : 1 |
| Capture ring (red) | the scene background | about 1.8 : 1 |
| Lattice lines | the scene background | about 1.8 : 1 |
| White's pieces (base color) | the scene background | about 1.4 : 1 |
| Black's pieces (base color) | the scene background | about 6.8 : 1 |
| Seat label text | its dark box | about 11 : 1 (presence line about 8 : 1) |
| Turn indicator text | its light box | about 15 : 1 |
| Move list moves | its dark box | about 6.8 : 1 |
| Move list row numbers (dimmed, 13 px) | its dark box | about 3.6 : 1 |
| Reconnecting banner text (white on amber) | its box | about 2.8 : 1 |
| Error banner and frozen-board banner text (white on red) | their box | about 6.2 : 1 |
| Promotion dialog's "Cancel" (gray on white) | the panel | about 7.5 : 1 |

The HUD boxes are translucent; their figures are computed over the plain scene background and shift slightly over a piece or the lattice. Two consequences: the selection ring and the destination dots have almost the same lightness as the background, so to a player who perceives little color (or in a grayscale display mode) they nearly disappear; and the "Reconnecting…" text and the move numbers fall below the 4.5 : 1 usually asked of text this size.

### Controls that do not look like controls

The buttons in the three dialogs (the five piece buttons, "Cancel", "Start new game", "Play here") and the error banner's "✕" have no border or background of their own. The page's base styles remove the browser's default button look, and these buttons set only a font size and padding, so, read from the styles, they appear as plain words. On a mouse, the pointer does not change over them. This was not checked by eye; see open questions.

## Motion

The motion in the product:

- **The glide and the fade.** Every arriving move, on both boards, animates for 300 ms; a capture fades the captured piece at the same time ([the view](../foundations/the-view.md#motion)). They play for the opponent's moves as well as the player's own.
- **The view's drift.** After a drag is released, the view keeps moving briefly and slows to a stop.
- **Button hover.** "Start New Game" and "Join Game" grow slightly and turn a little gray over 200 ms while a mouse is over them. Devices without hover (touch screens) never show it.

Nothing else moves: there is no idle animation, nothing blinks or flashes, and the board is redrawn only when something changes. There is no setting to reduce or turn off motion, and the app does not respond to the operating system's "reduce motion" preference: the glide, the fade, and the drift play the same whatever it says.

## Text size and zoom

Text on the page is sized in two ways. Some panels use fixed sizes that ignore the browser's default font size: the turn indicator (20 px), the presence line (13 px), the move list (13 px), the promotion dialog's piece buttons (16 px), and "Start new game" and "Play here" (18 px). Everything else follows the browser's default font size: the start screen, the share-link, join, and joined screens, the crash screen, the seat label's first line, the three banners, and the dialogs' titles and sentences. Raising the browser's default font size therefore enlarges some panels and leaves others, including the move list and the turn indicator, as they were.

Browser zoom (Ctrl or Cmd with + and −) enlarges every HTML panel, but not the board: the board always fills the window, whatever the zoom. The only way to make the board bigger is to [zoom the view](../foundations/the-view.md#turning-the-view), down to the view's closest limit. Ctrl with the wheel, and a trackpad pinch that the browser reports the same way, zoom the view rather than the page while the pointer is over the board; over the HTML panels they zoom the page as usual, and the keyboard zoom works everywhere.

The page never scrolls. At high zoom the HUD panels grow into one another as they do on a narrow window, and on the start screen and the pre-game screens, content that no longer fits the window is cut off with no way to scroll to it; see [screen sizes and touch](screen-sizes-and-touch.md).

The dialogs' titles ("Promote to", the end-game heading, and "This game is open in another tab") are, read from the styles, the same size and weight as ordinary text: the base styles reset headings, and these do not set their own size.

## Page language and title

Every page declares its language as English, and all on-screen text is English. The page title is "3D Chess — Online Multiplayer" on every page and never changes, so neither a page change nor anything in the game (the opponent joining, a move, the end) is reflected in the tab or announced through it.

## Cancel and interrupt

"Before sending" is while a keyboard or screen reader user is using a control or reading the page, before a request leaves the browser; "while in flight" is after a request has been sent (a create, a join, or a move). Each row says what the event means for focus, keyboard reach, and what assistive technology is told.

| Event | Before sending | While in flight |
| --- | --- | --- |
| Escape or Cancel | Escape cancels the promotion dialog only while focus is inside it; "Cancel" is reachable with Tab and works with Enter or Space. Either way focus falls to the page, and a screen reader is not told the dialog closed. Escape does nothing anywhere else. | No effect. Nothing in flight can be cancelled from the keyboard or any other input. |
| Pressing elsewhere or turning the view | A press on the board or a click on a non-focusable part of the page takes focus off any button. A click on the promotion panel between buttons does the same, after which Escape no longer works. The wheel changes nothing about focus. | No effect on focus. The board is [held](../glossary.md#selection-and-board-state); presses do nothing and nothing says so. |
| Leaving the game page within the app | "Start new game" (keyboard-reachable), "Back to start", or browser Back (Alt+Left or Cmd+[ on the keyboard) change the page without moving focus or changing the title; a screen reader is not told the page changed. | Same. The answer to the request is lost to this page, as described in each feature's own table. |
| The game ends | Not announced. The end-game dialog appears without taking focus; a keyboard user must Tab to "Start new game". A screen reader user finds the result only by reaching its heading, which names a color, not "you". | Same when the player's own move ends the game: the move lands, the board changes silently, and the dialog appears without focus. |
| The server answers with an error | Not applicable: nothing sent. An error answering the page's own automatic rejoin is announced as an alert like any other. | The error is announced as an alert, on the start screen or in the error banner. Focus is not moved; the banner's "✕" ("Dismiss error") can be reached with Tab, and dismissing it drops focus to the page. |
| The connection drops | The start screen's status line changes to "Reconnecting to server…" and is announced politely. On the game page the reconnecting banner appears (possibly not announced; low contrast), the board stops taking input without any text saying so, and an open promotion dialog closes, taking focus with it. | Same. Nothing announces whether a move in flight was recorded; the next snapshot changes the board silently. |
| The window loses focus or the tab is hidden | No effect. The browser remembers which control had focus and restores it when the window returns; an open promotion dialog keeps whichever of its buttons had focus, if any. | No effect. Anything that arrived while the tab was hidden is not announced on return, and the unchanging title gives no sign of it. |
| Reload or closing the tab | Focus starts over: nothing is focused after the reload. | Same. |
| The opponent acts | The opponent's moves, joining, leaving, and returning are never announced; the move list, turn indicator, and presence line change silently. Focus is not disturbed. | Same. |
| Another tab takes the seat | The replaced dialog appears as an alert dialog without taking focus. Tab reaches the covered "Start new game" and "✕" before "Play here". An open promotion dialog closes, taking focus with it. | Same. The answer goes to the other tab, and this one says nothing about it. |
| A second touch point or a cancelled touch | No accessibility effect of its own: a second finger is a press like any other ([screen sizes and touch](screen-sizes-and-touch.md#touch)). With a touch screen reader running, the board offers nothing to explore. | No effect. |

After any interrupt, focus is either where it was or on the page itself; the app never moves it to whatever appeared.

## Interactions with other systems

**Seat and turn.** The seat label ("You are playing as white.", color in lower case) and the turn indicator are plain text that a screen reader reads when it reaches them. Neither change is announced, so a screen reader user has to reread the turn indicator to learn that it is their turn.

**The game record.** The move list is the only text form of the record and of the position. It is marked as a list named "Move history" but is not a live region; every move played since the page loaded, by either side, is added silently.

**Connection.** The start screen's connection status and the game page's reconnecting banner are marked as status messages, and every error is marked as an alert. That the board does not take input while disconnected is shown by nothing but the banner.

**The opponent.** Nothing the opponent does is announced: not their joining, not their moves, not their presence.

**Other tabs and devices.** The replaced dialog is the only alert dialog in the product. It does not take focus or block the keyboard from the controls it covers.

**Game over.** The end-game dialog has no dialog role, no focus, and no announcement. Its heading names the winning color, and a player has to know their own color, from the seat label, to read it as a win or a loss.

**Stored seat.** No accessibility aspect: the [rejoin](../glossary.md#the-connection) that the stored seat triggers needs no input from the player.

**Keyboard, touch, and screen size.** This document covers the keyboard. Touch, window size, and the 3D requirement are in [screen sizes and touch](screen-sizes-and-touch.md); on a small window the board's cells, and so the press targets, are smaller.

## Edge cases

- **No stray promotion, and no quick one.** Because the dialog opens with nothing focused, a stray Enter or Space does not promote, but neither can a keyboard user confirm "Queen" without a Tab first.
- **Tab on the board screen finds nothing.** With no error, no dialog, and a short move list, Tab on the board screen goes straight from the page to the browser's own controls.
- **Hidden controls still work from the keyboard.** Under the replaced dialog, the end-game dialog's "Start new game" and the error banner's "✕" can be reached and used with the keyboard, though a mouse cannot reach them.
- **Tab can leave a modal dialog.** The promotion dialog is marked modal for screen readers, but nothing stops Tab from leaving it for the error banner's "✕" and the browser's controls.
- **The focus ring after a click.** "Start New Game" and "Join Game" show their blue ring after a mouse click as well as after Tab, because the ring follows focus, not keyboard use.
- **The join screen says nothing about the game.** A screen reader user arriving from a share link hears the heading "3D Chess" and a "Join Game" button; nothing names the game or the player who sent the link.
- **The joined screen is silent.** "Joined game, waiting for start..." replaces the "Join Game" button without an announcement, and normally lasts only a fraction of a second before the board screen, also unannounced.
- **The share link is read, not followed.** A screen reader reads the share link as text; it is not a link and there is nothing to activate.

## Open questions and verification

- **The game cannot be played without a pointer.** No keyboard equivalent exists for selecting a piece or playing a move, and the board gives a screen reader nothing but silence. This is the largest gap, and whether and how to close it (a text move entry, a keyboard cursor over cells, a described position) is a product decision.
- **Check is shown only by color**, and the destination fill and the last-move trace differ only in hue. The selection ring and the destination dots have almost no lightness contrast with the background (about 1 : 1 by calculation). Likely worth treating as defects; not tested with a color vision simulation.
- **The end-game dialog has no dialog role, no focus, and no announcement**; the replaced dialog has an alert dialog role but takes no focus, is not marked modal, and lets the keyboard reach the controls it covers. Read from `client/src/screens/EndGameModal.tsx` and `client/src/screens/GameScreen.tsx`. Likely worth treating as defects.
- **The promotion dialog does not keep focus**, so Escape stops working once focus leaves it, and closing the dialog does not return focus anywhere. Read from `client/src/screens/PromotionPicker.tsx`; no test covers focus or Escape.
- **Whether "Reconnecting…" is announced.** The banner is a status message that is added to the page together with its text; several screen readers announce only changes to a status region that already exists. Not tried with a screen reader. The same question applies to whether the replaced dialog is announced when it appears.
- **The promotion dialog's focus is lost as it opens** (`client/src/screens/PromotionPicker.tsx:16-19`): the scripted pass logged focus moving into "Queen" and straight out again, leaving the page body focused. Checked in Chromium only.
- **Contrast figures are calculated**, from the colors in `client/src/three/theme.ts` and the HUD styles, for flat colors over the plain scene background; they were not measured on screen. The reconnecting banner (about 2.8 : 1) and the move numbers (about 3.6 : 1) are below the usual 4.5 : 1 for text.
- **The dialogs' buttons may not look like buttons**, and the dialogs' titles may look like ordinary text: both read from the base styles, which strip the browser's default button and heading styling. Not checked by eye.
- **No reduced-motion support.** A search of `client/src` and `client/index.html` finds no reference to the reduce-motion preference. The glide is short, but the drift after a drag cannot be turned off either.
- **Mixed text sizing.** Some HUD panels use fixed pixel sizes and ignore the browser's default font size. Not checked with a changed default size.
- **The move list's reach and reading.** Whether a scrolling move list becomes a tab stop depends on the browser. Whether Safari keeps its list semantics (its style removes the list bullets, which Safari can take as "not a list"), and how screen readers pronounce entries such as `Ab2–Ab3` and the en dash, were not tried.
- **What a screen reader says about the board's drawing surface** (nothing, or an unlabeled element) was not tried.
- The roles and names are covered by `client/src/App.test.tsx` (the alert, status, dialog "Promote to", and alert dialog "This game is open in another tab") and `client/src/components/ErrorBoundary.test.tsx` (the crash screen's alert and "Back to start" link). Everything else was read from `client/src/screens/*.tsx`, `client/src/components/ErrorBoundary.tsx`, `client/src/three/Board.tsx`, `client/src/three/TurnIndicator.tsx`, `client/src/three/theme.ts`, `client/index.html`, the `OrbitControls` wrapper in `@react-three/drei`, and Tailwind's base styles. No part of this document was tried with a keyboard or a screen reader.

Verified against 3D Chess commit `d94507b`
