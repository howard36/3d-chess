# Accessibility

## Summary

3D Chess is built around a 3D [board](../glossary.md#the-board) that is used with a pointer: a mouse, a finger, or a pen. The board itself cannot be reached, navigated, or played from the keyboard, and the [view](../glossary.md#the-view) cannot be turned from the keyboard. Around the board everything is ordinary HTML, and since the board cannot be played without a pointer, the page offers a second way to play: the [move box](../glossary.md#the-interface) at the bottom left, where a move is typed in the same cell notation the move list uses ("Ab2-Ab3", with "=Q" and the like for a promotion) and sent with Enter. With it, a keyboard or screen reader user can play a whole game. The buttons that create and join a game, "Copy link", the [error banner](../glossary.md#the-interface)'s dismiss button, the three dialogs, and the [crash screen](../foundations/screens-and-navigation.md#the-crash-screen)'s link can all be reached with Tab and used with Enter or Space. Each dialog takes keyboard focus as it opens and puts everything behind it out of reach, and the turn, check, presence, errors, and the result are announced to screen readers as they change. What remains visual only is the board itself: the position, the selection, the legal destinations, and the last move. This document collects what the product offers and lacks for keyboard users, screen reader users, players with low vision or a color vision deficiency, and players sensitive to motion. How a press works is owned by [the input model](../foundations/input-model.md); window size, touch, and the 3D requirement by [screen sizes and touch](screen-sizes-and-touch.md).

## Who can do what

| Player | Can | Cannot |
| --- | --- | --- |
| Pointer and sight (mouse, touch, or pen) | Everything the product offers. | Nothing is withheld. |
| Keyboard only | Create a game ("Start New Game"), copy the share link ("Copy link", where offered), join one ("Join Game"), play every move by typing it in the move box, promote by typing the piece's letter, dismiss an error, answer the promotion dialog if a pointer opened it, leave a finished game ("Start new game"), take the seat back ("Play here"), and leave the crash screen ("Back to start"). | Select a piece on the board, see its legal destinations, or turn the view. |
| Screen reader | Hear each change of turn and each check, the opponent coming and going, errors, the result of the game, the [frozen-board banner](broken-game-record.md), the crash screen, and the start screen's connection status; read the [seat label](../game-page/seat-and-opponent-status.md) and the [move list](../game-page/move-list.md); play by typing moves in the move box and hear why a move was refused; use every HTML control. | Perceive the position, a selection, the legal destinations, or the last move, except by reading the move list and replaying it mentally; learn which moves are legal except by trying them. |
| Low vision | Enlarge the HTML panels with browser zoom; bring the board closer by zooming the view with the wheel, a middle drag, or a pinch; read check in words on the turn indicator. | Enlarge the board with browser zoom (it always fills the window), or scroll to content that zoom pushes out of the window. |
| Color vision deficiency | Tell White's pieces from Black's, which differ in lightness; read check in words on the turn indicator. | Tell the selection and destination marks from the [last-move trace](../glossary.md#selection-and-board-state), or a selected King from a King in [check](../glossary.md#moves-and-the-rules), on the board by anything but hue. |
| Sensitive to motion | Turn off the [glide](../glossary.md#selection-and-board-state) and the [fade](../glossary.md#selection-and-board-state) with the system's "reduce motion" setting, which the app follows; avoid the rest by not turning the view. | Turn off the view's drift after a drag, or the start screen's button hover. |

## Keyboard

### What Tab reaches

Tab moves keyboard focus through the page's HTML buttons, its one text field, and its one link, in page order. Disabled buttons are skipped. While a dialog is up, Tab reaches only that dialog's buttons (and the browser's own controls), because everything behind it is inert.

| Screen | Reachable with Tab |
| --- | --- |
| [Start screen](../glossary.md#the-product-and-its-screens) | "Start New Game". While it reads "Creating Game..." it is disabled and skipped. |
| Share-link screen | "Copy link", where the browser allows copying (an `https` address or `localhost`). The [share link](../glossary.md#games-and-seats) itself is plain text, not a link. |
| Join screen | "Join Game". |
| Joined screen | Nothing. |
| Board screen, no dialog | The move box's field; its "Move" button, when the player may move and the field is not empty; the error banner's "✕" when an error shows. Nothing on the board. |
| Board screen, promotion dialog open | The five piece buttons and "Cancel". |
| Board screen, end-game dialog up | "Start new game". |
| Any game page screen, when [replaced](../glossary.md#events-that-end-or-interrupt-a-request) | "Play here". On the board screen, the end-game dialog's "Start new game" too if that dialog is also up, since it is not part of what the replaced dialog puts out of reach. On the share-link, join, and joined screens, the error banner's "✕" too, if an error shows. |
| Crash screen | "Back to start", a link. |

The seat label, the turn indicator, the banners' text, the headings, and the board are never focusable. When the move list is long enough to scroll, some browsers make it reachable with Tab so that the arrow keys can scroll it; the app does nothing to allow or prevent this (see open questions).

"Start New Game", "Join Game", and "Copy link" show a thick blue ring whenever they have focus, including just after a mouse click. The other buttons, the field, and the link show the browser's own focus outline.

### Playing from the keyboard

The move box is a small dark panel at the bottom left of the board screen, labelled "Type a move (e.g. Ab2-Ab3)", with a text field and a "Move" button. A move is two cells, level-file-rank, in either case, with a hyphen, an en dash, an "x", spaces, or nothing between them: `Ab2-Ab3`, `ab2 ab3`, and `Ab2Ab3` are the same move. A promotion adds the piece's letter, Q, R, B, N, or U, with or without "=": `Da4-Ea5=U`. Enter in the field or the "Move" button submits.

A move that is legal is sent exactly as a click on the board would send it, and the field empties; the board is then [held](../glossary.md#selection-and-board-state) until the move lands, and focus stays in the field, ready for the next move. A move that cannot be played is not sent; a line under the field says why ("You have no piece on Ab2.", "The piece on Ab2 cannot move to Ab5.", and the others listed in [error messages](error-messages.md#explained-by-the-move-box)), the field is marked invalid, and the text stays to be corrected. A typed promotion is sent directly, without the promotion dialog; a promotion typed without a letter is refused with "Say which piece to promote to: add =Q, =R, =B, =N or =U."

The field can be typed in at any time, but the move is checked and sent only while the player may move: on their own turn, with the board taking input, and the game not over. At any other time "Move" is disabled and Enter does nothing, with no message.

### What the keyboard cannot do

- **Use the board.** There is no keyboard cursor over the cells, no way to select a piece or see its legal destinations, and the board cannot take focus. The move box is the keyboard's way to play.
- **Turn the view.** The arrow keys, Page Up and Down, and + and − do nothing to the view.

  > Technical note: The camera controls can pan the view with the arrow keys, but only if the app asks for it. It does not (the `OrbitControls` wrapper's `keyEvents` option defaults to off and `client/src/screens/GameScreen.tsx` does not set it), and the canvas has no tab stop in any case.

- **Close the end-game or replaced dialog.** Neither has a close control for anyone; the keyboard is no different.
- **Use shortcuts.** There are none. Shift, Ctrl, Cmd, and Alt change nothing on their own ([the input model](../foundations/input-model.md#html-controls-and-the-keyboard)).

### Escape

Escape is the only key the app handles itself, and only in the promotion dialog, while keyboard focus is inside it; there it cancels the promotion exactly like "Cancel". Focus is inside the dialog from the moment it opens, and stays there unless the player tabs out to the browser's own controls or clicks the white panel anywhere but a button. Escape anywhere else does nothing: it does not clear a [selection](../glossary.md#selection-and-board-state), empty the move box, dismiss the error banner, or close the end-game or replaced dialog.

## Focus

Nothing is focused when any page loads. The app moves focus in three places, the three dialogs, and puts the rest of the page out of reach while each is up:

- **The promotion dialog** puts focus on its first button, "Queen", as it opens. It opens on the click that plays the pawn to its promotion square, after the browser has finished with that click, so focus stays on "Queen": Enter or Space picks the Queen at once, Escape cancels, and Tab moves to "Rook", "Bishop", "Knight", "Unicorn", and "Cancel" ([promotion](../play/promotion.md#begin)). The board and the HUD behind it are inert, so Tab past "Cancel" goes to the browser's own controls and then back to "Queen". When the dialog closes, by a pick, a cancel, or because the board stopped taking input, focus is not put anywhere: it falls to the page itself, and the next Tab starts again from the top of the page.
- **The end-game dialog** puts focus on "Start new game" as it opens, so Enter or Space leaves the game at once. The board and the HUD behind it, the move box included, are inert.
- **The replaced dialog** puts focus on "Play here" as it opens, so Enter or Space takes the seat back at once. On the board screen the board and the HUD behind it are inert; on the share-link, join, and joined screens the page's content is. What it does not cover is listed in [what Tab reaches](#what-tab-reaches).
- **The move box** keeps focus in its field after a move is sent or refused, so a keyboard player types the next move without Tab.
- **A control that disappears** (clicking "Join Game", "✕", "Play here", a piece button, "Cancel", or "Start New Game" as the page changes) takes focus with it. Focus drops to the page and nothing moves it to the new content.
- **Page changes** within the app (the start screen to a new game, a game back to the start screen) move no focus and do not change the page title, so nothing signals the change to a keyboard or screen reader user.

## Screen readers

### What is marked for assistive technology

| Element | Marked as | What a screen reader is told |
| --- | --- | --- |
| Start screen error, "Error: {message}" | alert | Announced when it appears. |
| Start screen status, "Connecting to server…" or "Reconnecting to server…" | status | A change from one to the other is announced politely. The line shown as the page loads is usually not announced, and its disappearance on connecting is not. |
| Share-link screen's copy status, "Copied" or "Could not copy; select the link instead" | status | Announced politely after a click on "Copy link". |
| Error banner, "Error: {message}", and its "✕" | alert; the button is named "Dismiss error" | Announced when it appears. The button is read as "Dismiss error", not as the ✕ glyph. |
| Reconnecting banner, "Reconnecting…" | status | Meant to be announced politely. It is added to the page together with its text, which some screen readers do not announce; see open questions. |
| Frozen-board banner | alert | Announced when it appears, including on a page load that shows a frozen board. |
| Crash screen | alert (heading, sentence, and link) | Announced when it replaces the page. |
| The board | an image, named "The 3D board, white side nearest. Pieces are selected and moved with a pointer; to play from the keyboard, type moves in the move box." ("black side nearest" for Black) | Its name, which points to the move box. Nothing about the position. |
| Turn indicator, "White to move", "Black to move", with " — in check" | status, polite live region | Each change is announced without interrupting: every move that lands, by either player, and every check. |
| Seat label | plain text | Read when the user reaches it. |
| Its presence line, "Opponent: online" or "Opponent: offline" | status | Changes are announced politely. It is added to the page together with its first text, which some screen readers do not announce. |
| Move box | a form named "Type a move"; the field labelled "Type a move (e.g. Ab2-Ab3)"; a "Move" button; a status line for problems | The field's label is read on reaching it. A refused move's explanation is announced politely, is linked to the field as its description, and the field is marked invalid. |
| Move list | an ordered list named "Move history" | Read when the user reaches it, one row per numbered White–Black pair. New rows are not announced; the turn indicator's change is the sign that a move landed. |
| Promotion dialog | dialog, modal, named "Promote to" | Entered as a dialog named "Promote to", with focus on "Queen" and buttons "Queen", "Rook", "Bishop", "Knight", "Unicorn", and "Cancel". Everything behind it is hidden from the screen reader. |
| End-game dialog | dialog, modal, named by its heading | Entered as a dialog named "White wins by checkmate!", "Black wins by checkmate!", or "Draw by stalemate!", with focus on "Start new game". Everything behind it is hidden. |
| Replaced dialog | alert dialog, modal, named "This game is open in another tab", described by its sentence | Entered with focus on "Play here"; its sentence is read as the description. What is behind it is hidden, as listed under [focus](#focus). |

The start screen, the share-link, join, and joined screens have one heading, "3D Chess"; the crash screen's heading is "Something went wrong"; the board screen has no heading of its own, only the dialogs' titles. No page has landmarks (main content, navigation), so a screen reader user moves through each page element by element.

### What a screen reader user cannot learn

- **The position.** The board exposes no piece, cell, or square; its name says only which side is nearest and where to type. The only text form of the game is the move list, in [cell notation](../glossary.md#the-board), from which the position would have to be rebuilt by replaying every move mentally from the [starting position](../foundations/game-rules.md#the-starting-position). The move list is hidden until the first move.
- **A selection, the legal destinations, or the last move.** The [move markers](../glossary.md#selection-and-board-state) and the last-move trace have no text. The newest move is the last entry in the move list. Which moves are legal can be learned only by typing one and reading the move box's answer.
- **An arriving move, in detail.** The opponent's move glides in silently and the move list gains an entry without an announcement; what is announced is the turn indicator's new text, which says a move landed but not which.
- **The opponent joining.** The share-link screen is replaced by the board screen without an announcement of its own.

## Color and contrast

### Marks told apart only by color

Every mark on the board is described in [the view](../foundations/the-view.md#markers-and-colors). How each pair differs:

| Pair | What tells them apart |
| --- | --- |
| Selection glow (amber) and check glow (red) on a King | Color only, on the board. A selected King in check shows only the red. Check is also said in words by the turn indicator. |
| Destination fill (amber) and last-move trace (teal) | Color only: both tint a whole cell. On a shared cell the amber replaces the teal. |
| Selection ring (gold) and capture ring (red) | Color, and a small difference in width (the capture ring is slightly wider). |
| Quiet-move dot (amber) and the rings | Shape as well as color: a dot at the cell's center, not a ring on its floor. |
| White's pieces (ivory) and Black's pieces (graphite) | Lightness. Readable without color. |

On the board, check is conveyed only by the red glow; the turn indicator's " — in check" is the one statement of it that does not depend on color. For a player with a red–green color vision deficiency, the red marks (the check glow and the capture ring) against the amber and gold ones are the pairs most at risk; this was not tested with a simulation.

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
| Move box label (dimmed, 13 px) | its dark box | about 5.5 : 1 |
| Move box field text | the field | about 5.3 : 1 |
| Move box "Move" button | its white background | about 16 : 1 (drawn at half opacity while disabled) |
| Reconnecting banner text (white on amber) | its box | about 2.8 : 1 |
| Error banner and frozen-board banner text (white on red) | their box | about 6.2 : 1 |
| Promotion dialog's "Cancel" (gray on white) | the panel | about 7.5 : 1 |

The HUD boxes are translucent; their figures are computed over the plain scene background and shift slightly over a piece or the lattice. Two consequences: the selection ring and the destination dots have almost the same lightness as the background, so to a player who perceives little color (or in a grayscale display mode) they nearly disappear; and the "Reconnecting…" text and the move numbers fall below the 4.5 : 1 usually asked of text this size.

### Controls that do not look like controls

The buttons in the three dialogs (the five piece buttons, "Cancel", "Start new game", "Play here") and the error banner's "✕" have no border or background of their own. The page's base styles remove the browser's default button look, and these buttons set only a font size and padding, so, read from the styles, they appear as plain words. On a mouse, the pointer does not change over them. The move box's "Move" button and "Copy link" do have a white background and rounded corners. This was not checked by eye; see open questions.

## Motion

The motion in the product:

- **The glide and the fade.** Every arriving move, on both boards, animates for 300 ms; a capture fades the captured piece at the same time ([the view](../foundations/the-view.md#motion)). They play for the opponent's moves as well as the player's own.
- **The view's drift.** After a drag is released, the view keeps moving briefly and slows to a stop.
- **Button hover.** "Start New Game" and "Join Game" grow slightly and turn a little gray over 200 ms while a mouse is over them. Devices without hover (touch screens) never show it.

Nothing else moves: there is no idle animation, nothing blinks or flashes, and the board is redrawn only when something changes.

When the operating system (or the browser) asks for reduced motion, the glide and the fade do not play: an arriving move simply appears in its new cell, a captured piece simply disappears, and the teal last-move trace still shows which two cells the move joined. The preference is read whenever the board is updated, so changing it takes effect from the next move. The view's drift and the buttons' hover growth are not affected by it, and there is no setting of the app's own.

## Text size and zoom

Text on the page is sized in two ways. Some panels use fixed sizes that ignore the browser's default font size: the turn indicator (20 px), the presence line (13 px), the move list (13 px), the move box (13 px), the promotion dialog's piece buttons (16 px), and "Start new game" and "Play here" (18 px). Everything else follows the browser's default font size: the start screen, the share-link, join, and joined screens, the crash screen, the seat label's first line, the three banners, and the dialogs' titles and sentences. Raising the browser's default font size therefore enlarges some panels and leaves others, including the move list, the move box, and the turn indicator, as they were.

Browser zoom (Ctrl or Cmd with + and −) enlarges every HTML panel, but not the board: the board always fills the window, whatever the zoom, and is framed to fit it. The only way to make the board bigger is to [zoom the view](../foundations/the-view.md#turning-the-view), down to the view's closest limit. Ctrl with the wheel, and a trackpad pinch that the browser reports the same way, zoom the view rather than the page while the pointer is over the board; over the HTML panels that take the pointer (the move box, the error banner, and the move list) they zoom the page as usual, and the keyboard zoom works everywhere.

The page never scrolls. Zooming in makes the page narrower in the browser's terms, so at high zoom the HUD switches to its narrow arrangement (the turn indicator and the error banner on rows of their own) exactly as in a narrow window, and its panels do not overlap. On the start screen and the pre-game screens, content that no longer fits the window is cut off with no way to scroll to it; see [screen sizes and touch](screen-sizes-and-touch.md).

The dialogs' titles ("Promote to", the end-game heading, and "This game is open in another tab") are, read from the styles, the same size and weight as ordinary text: the base styles reset headings, and these do not set their own size.

## Page language and title

Every page declares its language as English, and all on-screen text is English. The page title is "3D Chess — Online Multiplayer" on every page and never changes, so neither a page change nor anything in the game (the opponent joining, a move, the end) is reflected in the tab.

## Cancel and interrupt

"Before sending" is while a keyboard or screen reader user is using a control or reading the page, before a request leaves the browser; "while in flight" is after a request has been sent (a create, a join, or a move). Each row says what the event means for focus, keyboard reach, and what assistive technology is told.

| Event | Before sending | While in flight |
| --- | --- | --- |
| Escape or Cancel | Escape cancels the promotion dialog while focus is inside it, which it is from the moment it opens; "Cancel" works with Enter or Space. Either way focus falls to the page, and a screen reader is not told the dialog closed. Escape does nothing anywhere else, and does not empty the move box. | No effect. Nothing in flight can be cancelled from the keyboard or any other input. |
| Pressing elsewhere or turning the view | A press on the board or a click on a non-focusable part of the page takes focus off the move box or a button. A click on the promotion panel between buttons does the same, after which Escape no longer works. The wheel changes nothing about focus. | No effect on focus. The board is [held](../glossary.md#selection-and-board-state): presses do nothing and "Move" is disabled; the turn indicator still names the player, and nothing says the move is on its way. |
| Leaving the game page within the app | "Start new game" (focused when the end-game dialog opens), "Back to start", or browser Back (Alt+Left or Cmd+[ on the keyboard) change the page without moving focus or changing the title; a screen reader is not told the page changed. | Same. The answer to the request is lost to this page, as described in each feature's own table. |
| The game ends | The end-game dialog opens with focus on "Start new game" and is announced as a dialog named by its result. The board, the HUD, and the move box behind it are inert. | Same when the player's own move ends the game: the move lands and the dialog takes focus from the move box. |
| The server answers with an error | Not applicable: nothing sent. An error answering the page's own automatic rejoin is announced as an alert like any other; a rejoin refused because another tab holds the seat opens the replaced dialog instead, which takes focus. | The error is announced as an alert, on the start screen or in the error banner. Focus is not moved; the banner's "✕" ("Dismiss error") can be reached with Tab, and dismissing it drops focus to the page. |
| The connection drops | The start screen's status line changes to "Reconnecting to server…" and is announced politely. On the game page the reconnecting banner appears (possibly not announced; low contrast), the board and the move box stop taking input without any text saying so, and an open promotion dialog closes, taking focus with it. | Same. Nothing announces whether a move in flight was recorded; the next snapshot changes the board silently, and the turn indicator announces its new text if the turn changed. |
| The window loses focus or the tab is hidden | No effect. The browser remembers which control had focus and restores it when the window returns; an open promotion dialog keeps whichever of its buttons had focus. | No effect. Anything that arrived while the tab was hidden is announced as it arrives, if the screen reader is reading that tab; the unchanging title gives no sign of it. |
| Reload or closing the tab | Focus starts over: nothing is focused after the reload. | Same. |
| The opponent acts | The opponent's moves are announced through the turn indicator, and their leaving and returning through the presence line; their joining is not announced. Focus is not disturbed, so a player typing in the move box keeps typing. | Same. |
| Another tab takes the seat | The replaced dialog opens with focus on "Play here" and is announced as an alert dialog with its sentence. An open promotion dialog closes. The same happens when this tab's connection returns and finds the seat held by the other tab. | Same. The answer goes to the other tab, and this one says nothing about it. |
| A second touch point or a cancelled touch | No accessibility effect of its own; a second finger never acts on the board ([screen sizes and touch](screen-sizes-and-touch.md#touch)). With a touch screen reader running, the board offers nothing to explore, and the move box is the way to play. | No effect. |

After any interrupt, focus is where it was, on the page itself, or on the first button of a dialog that opened; the app never moves it to anything else that appeared.

## Interactions with other systems

**Seat and turn.** The seat label ("You are playing as white.", color in lower case) is plain text that a screen reader reads when it reaches it. The turn indicator is a live region, so each change of turn is announced; a screen reader user still has to know their own color, from the seat label, to hear "White to move" as "your move". The move box's "Move" works only on the player's turn.

**The game record.** The move list is the only text form of the record and of the position. It is marked as a list named "Move history" but is not a live region; every move played since the page loaded, by either side, is added silently, while the turn indicator announces that one landed.

**Connection.** The start screen's connection status and the game page's reconnecting banner are marked as status messages, and every error is marked as an alert. That the board and the move box do not take input while disconnected, or while a rejoin is answered, is shown by nothing but the banner and the disabled "Move".

**The opponent.** The opponent's moves are announced through the turn indicator, and their connection through the presence line. Their joining is not announced.

**Other tabs and devices.** The replaced dialog is an alert dialog that takes focus and hides what is behind it. On the board screen, an end-game dialog under it can still be reached with Tab.

**Game over.** The end-game dialog is a modal dialog named by its result and takes focus on its only button. Its heading names the winning color, and a player has to know their own color, from the seat label, to read it as a win or a loss.

**Stored seat.** No accessibility aspect: the [rejoin](../glossary.md#the-connection) that the stored seat triggers needs no input from the player.

**Keyboard, touch, and screen size.** This document covers the keyboard. Touch, window size, and the 3D requirement are in [screen sizes and touch](screen-sizes-and-touch.md); on a small window the board's cells, and so the press targets, are smaller, and the move box is an alternative there too.

## Edge cases

- **A quick promotion.** Because the promotion dialog opens with focus on "Queen", Enter or Space right after the click that opened it promotes to a Queen. A player who pressed the key meaning something else gets a Queen.
- **Typing ahead.** The move box can be typed in during the opponent's turn; Enter does nothing until the opponent's move lands, and the move is then judged against the new position.
- **Tab on the board screen.** With no error and no dialog, Tab on the board screen reaches the move box's field, then "Move" if the player may move and has typed something, and then the browser's own controls.
- **Not everything behind the replaced dialog is out of reach.** On the board screen the end-game dialog's "Start new game", and on the pre-game screens the error banner's "✕", can still be reached with Tab behind the replaced dialog, though a mouse cannot reach them.
- **The focus ring after a click.** "Start New Game", "Join Game", and "Copy link" show their blue ring after a mouse click as well as after Tab, because the ring follows focus, not keyboard use.
- **The join screen says nothing about the game.** A screen reader user arriving from a share link hears the heading "3D Chess" and a "Join Game" button; nothing names the game or the player who sent the link.
- **The joined screen is silent.** "Joined game, waiting for start..." replaces the "Join Game" button without an announcement, and normally lasts only a fraction of a second before the board screen, also unannounced except for what its live regions say.
- **The share link is read, not followed.** A screen reader reads the share link as text; it is not a link. "Copy link", where offered, copies it.
- **Several moves at once.** A snapshot that brings several moves (after a reconnect or "Play here") changes the turn indicator once, so a screen reader hears only the final side to move.

## Open questions and verification

- **The board itself stays pointer-only.** The decision recorded in [B-09](../bug-triage.md#b-09-the-game-cannot-be-played-without-a-pointer-and-dialogs-and-cues-are-not-accessible) was typed moves rather than keyboard navigation of the 3D board. A keyboard or screen reader player can play, but can learn the position only from the move list, and legal moves only by trying them. Whether a described position or a keyboard cursor over cells is wanted is a product call.
- **Check on the board is shown only by color**, and the destination fill and the last-move trace differ only in hue. The selection ring and the destination dots have almost no lightness contrast with the background (about 1 : 1 by calculation). Likely worth treating as defects; not tested with a color vision simulation.
- **Tab past the replaced dialog.** The end-game dialog is outside the part of the page the replaced dialog makes inert (`client/src/screens/GameScreen.tsx:332-335` and `:449-450`), and on the pre-game screens so is the error banner (`:460-495`). Read from code; not tried.
- **Whether "Reconnecting…" and the presence line's first report are announced.** Both are status regions that are added to the page together with their text; several screen readers announce only changes to a region that already exists. Not tried with a screen reader. The turn indicator exists from the moment the board appears, so its changes are not affected.
- **Contrast figures are calculated**, from the colors in `client/src/three/theme.ts` and the HUD styles, for flat colors over the plain scene background; they were not measured on screen. The reconnecting banner (about 2.8 : 1) and the move numbers (about 3.6 : 1) are below the usual 4.5 : 1 for text.
- **The dialogs' buttons may not look like buttons**, and the dialogs' titles may look like ordinary text: both read from the base styles, which strip the browser's default button and heading styling. Not checked by eye.
- **Reduced motion covers the glide and the fade only.** `client/src/three/motion.ts:22-25` reads the preference, and `client/src/three/Board.tsx:131-132` skips the animation when it is set; the view's drift and the buttons' hover growth ignore it. Covered by "skips the glide and the fade when the player prefers reduced motion" in `client/src/three/Board.test.tsx`; not tried with the system setting.
- **Silence when the move box may not send.** Enter on the opponent's turn does nothing and says nothing (`client/src/screens/MoveInput.tsx:25`). The disabled "Move" button tells a sighted user; a screen reader user hears nothing. A product call.
- **Mixed text sizing.** Some HUD panels use fixed pixel sizes and ignore the browser's default font size. Not checked with a changed default size.
- **The move list's reach and reading.** Whether a scrolling move list becomes a tab stop depends on the browser. Whether Safari keeps its list semantics (its style removes the list bullets, which Safari can take as "not a list"), and how screen readers pronounce entries such as `Ab2–Ab3` and the en dash, were not tried.
- **What a screen reader says about the board** (its name as an image) was not tried.
- The roles, names, and focus are covered by `client/src/App.test.tsx` (the alert, status, dialog "Promote to", the replaced dialog's focus on "Play here" and the inert game behind it, the turn indicator's polite live region with " — in check", and the move box), `client/src/components/ErrorBoundary.test.tsx` (the crash screen's alert and "Back to start" link), and the unit tests of the move box's parser (`client/src/game/typedMove.test.ts`). Focus on "Queen" when the promotion dialog opens and on "Start new game" in the end-game dialog was seen in headless Chromium. Everything else was read from `client/src/screens/*.tsx`, `client/src/components/ErrorBoundary.tsx`, `client/src/three/Board.tsx`, `client/src/three/TurnIndicator.tsx`, `client/src/three/motion.ts`, `client/src/three/theme.ts`, `client/index.html`, the `OrbitControls` wrapper in `@react-three/drei`, and Tailwind's base styles. No part of this document was tried with a screen reader.

Verified against 3D Chess commit `90142a3`
