# Accessibility

## Summary

3D Chess is built around a 3D [board](../glossary.md#the-board) that is used with a pointer: a mouse, a finger, or a pen. The board itself cannot be reached, navigated, or played from the keyboard, and the [view](../glossary.md#the-view) cannot be turned from the keyboard. Around the board everything is ordinary HTML, and since the board cannot be played without a pointer, the page offers a second way to play: the [move box](../glossary.md#the-interface), where a move is typed in the same cell notation the move list uses ("Ab2-Ab3", with "=Q" and the like for a promotion) and sent with Enter. It is out of sight until it has focus, but it is the first thing Tab reaches on the board screen and appears as soon as it has focus. With it, a keyboard or screen reader user can play a whole game, and every move that lands is announced ("White bishop Ad2 takes pawn on Dd5. Check. Your move."). The buttons that create and join a game, "Copy link", the [error banner](../glossary.md#the-interface)'s dismiss button, the three dialogs, and the [crash screen](../foundations/screens-and-navigation.md#the-crash-screen)'s link can all be reached with Tab and used with Enter or Space. Each dialog takes keyboard focus as it opens and puts everything behind it out of reach, and the turn, check, presence, errors, and the result are announced to screen readers as they change. What remains visual only is the board itself: the position, the selection, the legal destinations, and the last move. This document collects what the product offers and lacks for keyboard users, screen reader users, players with low vision or a color vision deficiency, and players sensitive to motion. How a press works is owned by [the input model](../foundations/input-model.md); window size, touch, and the 3D requirement by [screen sizes and touch](screen-sizes-and-touch.md).

## Who can do what

| Player | Can | Cannot |
| --- | --- | --- |
| Pointer and sight (mouse, touch, or pen) | Everything the product offers. | Nothing is withheld. |
| Keyboard only | Create a game ("Start a game"), copy the share link ("Copy link", where offered), join one ("Join Game"), play every move by typing it in the move box (Tab brings it up), promote by typing the piece's letter, dismiss an error, answer the promotion dialog if a pointer opened it, leave a finished game ("Start new game"), take the seat back ("Play here"), and leave the crash screen ("Back to start"). | Select a piece on the board, see its legal destinations, or turn the view. |
| Screen reader | Hear every move as it lands, with the piece, what it took, check, and whose move it is now; the opponent coming and going; errors; the result of the game; the [frozen-board banner](broken-game-record.md), the crash screen, and the start screen's connection status; hear a one-sentence description of the start screen's preview; read the [turn pill](../game-page/turn-indicator.md)'s description ("You play White. Your move.") and the [move list](../game-page/move-list.md), which is in the page whether or not it is shown; play by typing moves in the move box and hear why a move was refused; use every HTML control. | Perceive the position, a selection, the legal destinations, or the last move, except by reading the move list and replaying it mentally; learn which moves are legal except by trying them. |
| Low vision | Enlarge the HTML panels with browser zoom; bring the board closer by zooming the view with the wheel, a middle drag, or a pinch; read check as a "CHECK" badge on the turn pill. | Enlarge the board with browser zoom (it always fills the window), or scroll to content that zoom pushes out of the window. |
| Color vision deficiency | Tell White's pieces from Black's, which differ in lightness; read check as a "CHECK" badge on the turn pill. | Tell the selection and destination marks from the [last-move trace](../glossary.md#selection-and-board-state), or a selected King from a King in [check](../glossary.md#moves-and-the-rules), on the board by anything but hue. |
| Sensitive to motion | Turn off the [glide](../glossary.md#selection-and-board-state) and the [fade](../glossary.md#selection-and-board-state) with the system's "reduce motion" setting, which the app follows, and with it the start screen's [preview](../glossary.md#the-product-and-its-screens), which then holds still (the preview has no pause of its own); avoid the rest by not turning the view. | Turn off the view's drift after a drag, the join screen's button hover, or the small breathing dot beside the start screen's connection status and "Creating game…". |

## Keyboard

### What Tab reaches

Tab moves keyboard focus through the page's HTML buttons, its one text field, and its one link, in page order. Disabled buttons are skipped. While a dialog is up, Tab reaches only that dialog's buttons (and the browser's own controls), because everything behind it is inert.

| Screen | Reachable with Tab |
| --- | --- |
| [Start screen](../glossary.md#the-product-and-its-screens) | "Start a game" only. While it shows a create waiting ("Connecting…", "Reconnecting…", "Creating game…") it stays reachable (and keeps focus if it had it) but does nothing. The preview itself is never reached. |
| Share-link screen | "Copy link", where the browser allows copying (an `https` address or `localhost`). The [share link](../glossary.md#games-and-seats) itself is plain text, not a link. |
| Join screen | "Join Game". |
| Joined screen | Nothing. |
| Board screen, no dialog | The error banner's "✕" when an error shows; the move box's field (which appears when it takes focus) and its ↵ button. Nothing on the board. |
| Board screen, promotion dialog open | The five piece buttons and "Cancel". |
| Board screen, end-game dialog up | "Start new game". |
| Any game page screen, when [replaced](../glossary.md#events-that-end-or-interrupt-a-request) | "Play here" only. Everything else on the page is out of reach behind it, including an end-game dialog under it and the error banner's "✕". |
| Crash screen | "Back to start", a link. |

The turn pill, the banners' text, the headings, and the board are never focusable. When the move list is long enough to scroll, some browsers make it reachable with Tab so that the arrow keys can scroll it; the app does nothing to allow or prevent this (see open questions).

"Join Game" and "Copy link" show a thick blue ring whenever they have focus, including just after a mouse click. "Start a game" shows a ring of light only when focused from the keyboard. The other buttons, the field, and the link show the browser's own focus outline.

### Playing from the keyboard

The move box is the text field of the [move card](../glossary.md#the-interface), labelled "Type a move, like Bb1-Cb1" for screen readers, with a ↵ button ("Play the move") beside it. The card is out of sight, but the field is the first tab stop on the board screen: pressing Tab brings the card up with the field alone and a hint ("e.g. Bb1-Cb1, then Enter · Esc to hide"), and Escape, or leaving the field empty, puts it away again.

A move is two cells, level-file-rank, in either case, with a hyphen, an en dash, an "x", spaces, or nothing between them: `Ab2-Ab3`, `ab2 ab3`, and `Ab2Ab3` are the same move. A promotion adds the piece's letter, Q, R, B, N, or U, with or without "=": `Da4-Ea5=U`. Enter in the field or the ↵ button submits.

A move that is legal is sent exactly as a click on the board would send it, and the field empties; the board is then [held](../glossary.md#selection-and-board-state) until the move lands, and focus stays in the field, ready for the next move. A move that cannot be played is not sent; a line under the field says why ("You have no piece on Ab2.", "The piece on Ab2 cannot move to Ab5.", and the others listed in [error messages](error-messages.md#explained-by-the-move-box)), the field is marked invalid, and the text stays to be corrected. A move submitted on the opponent's turn is not sent either, and the line says "Wait for their move." A typed promotion is sent directly, without the promotion dialog; a promotion typed without a letter is refused with "Say which piece to promote to: add =Q, =R, =B, =N or =U."

The field can be typed in at any time. While the board takes no input (a move in flight, a drop, a frozen record) or the game is over, a submit does nothing and says nothing.

### What the keyboard cannot do

- **Use the board.** There is no keyboard cursor over the cells, no way to select a piece or see its legal destinations, and the board cannot take focus. The move box is the keyboard's way to play.
- **Turn the view.** The arrow keys, Page Up and Down, and + and − do nothing to the view.

  > Technical note: The camera controls could turn the view with the arrow keys only if the app asked for it. It does not (panning is turned off and the controls are never given keys, `client/src/three/CameraControls.tsx`), and the canvas has no tab stop in any case.

- **Close the end-game or replaced dialog.** Neither has a close control for anyone; the keyboard is no different.
- **Use shortcuts.** There are none. Shift, Ctrl, Cmd, and Alt change nothing on their own ([the input model](../foundations/input-model.md#html-controls-and-the-keyboard)).

### Escape

Escape is the only key the app handles itself, and only in the promotion dialog, while keyboard focus is inside it; there it cancels the promotion exactly like "Cancel". Focus is inside the dialog from the moment it opens, and stays there unless the player tabs out to the browser's own controls or clicks the dialog's card anywhere but a button. Escape anywhere else does nothing: it does not clear a [selection](../glossary.md#selection-and-board-state), empty the move box, dismiss the error banner, or close the end-game or replaced dialog.

## Focus

Nothing is focused when any page loads. The app moves focus in three places, the three dialogs, and puts the rest of the page out of reach while each is up:

- **The promotion dialog** puts focus on its first button, "Queen", as it opens. It opens on the click that plays the pawn to its promotion square, after the browser has finished with that click, so focus stays on "Queen": Enter or Space picks the Queen at once, Escape cancels, and Tab moves to "Rook", "Bishop", "Knight", "Unicorn", and "Cancel" ([promotion](../play/promotion.md#begin)). The board and the HUD behind it are inert, so Tab past "Cancel" goes to the browser's own controls and then back to "Queen". When the dialog closes, by a pick, a cancel, or because the board stopped taking input, focus is not put anywhere: it falls to the page itself, and the next Tab starts again from the top of the page.
- **The end-game dialog** puts focus on "Start new game" as it opens, so Enter or Space leaves the game at once. The board and the HUD behind it, the move box included, are inert.
- **The replaced dialog** puts focus on "Play here" as it opens, so Enter or Space takes the seat back at once. Everything behind it is inert: on the board screen the board, the HUD, and an end-game dialog if one is up; on the share-link, join, and joined screens the page's content and the error banner. When "Play here" is clicked the dialog closes at once, while the new connection opens, and focus falls to the page.
- **The move box** keeps focus in its field after a move is sent or refused, so a keyboard player types the next move without Tab. It appears when it takes focus and hides again when focus leaves it with nothing typed (or on Escape).
- **A control that disappears** (clicking "Join Game", "✕", "Play here", a piece button, "Cancel", or "Start a game" as the page changes) takes focus with it. Focus drops to the page and nothing moves it to the new content.
- **Page changes** within the app (the start screen to a new game, a game back to the start screen) move no focus and do not change the page title, so nothing signals the change to a keyboard or screen reader user.

## Screen readers

### What is marked for assistive technology

| Element | Marked as | What a screen reader is told |
| --- | --- | --- |
| Start screen error, "Couldn't start a game: {message}" | alert, never shown (visually hidden; also the start button's tooltip) | Announced when it appears. The button meanwhile reads "Try again". |
| Start screen status, "Connecting to server…" or "Reconnecting to server…" | status, never shown (visually hidden, always in the page, empty otherwise) | Filled only after a click on "Start a game" while the connection is not open, when the button reads "Connecting…" or "Reconnecting…". It and a change from one to the other are announced politely; its emptying, when the request is sent, is not. Before a click the page says nothing about the connection. |
| "Start a game" while a game is being created | a button named "Connecting…" or "Reconnecting…" while the click waits for the connection, then "Creating game…", marked unavailable and busy | Read as "Creating game…, dimmed" (or "unavailable") where the reader reports it; focus stays on it. The knight and the breathing dot are hidden. After an error it is named "Try again" and available again. |
| Start screen preview | hidden | The picture is skipped. In its place the page holds a sentence only a screen reader reads: "Preview: a sample game plays itself on the five-level tower and ends in checkmate by White." |
| Share-link screen's copy status, "Copied" or "Could not copy; select the link instead" | status | Announced politely after a click on "Copy link". |
| Error banner, the message, and its "✕" | alert; the message is read as "Error: {message}"; the button is named "Dismiss error" | Announced when it appears. The button is read as "Dismiss error", not as the ✕ glyph. |
| Reconnecting line, "Reconnecting…" | status, in the page before the line appears | Announced politely when it appears. |
| Frozen-board banner | alert | Announced when it appears, including on a page load that shows a frozen board. |
| Crash screen | alert (heading, sentence, and link) | Announced when it replaces the page. |
| The board | an image, named "The 3D board, white side nearest. Pieces are selected and moved with a pointer; to play from the keyboard, press Tab to type a move." ("black side nearest" for Black) | Its name, which points to the move box. Nothing about the position. |
| Turn pill | plain text, with a description for screen readers: "You play White. Your move." ("Black to move", ", in check", "Your opponent is offline.", or the result) | Read when the user reaches it. Its changes are not announced by the pill itself; the move announcement says them. |
| Captured pieces | plain text after the pill, one sentence per side with anything to say: "You have taken a unicorn and 2 pawns; you are 1 ahead." and "Your opponent has taken a bishop and a pawn." (nothing before the first capture); the silhouettes, counts, and "+N" are hidden from screen readers | Read when the user reaches them. Not a live region: their changes are not announced, since the move announcement already names every piece taken. |
| Move announcement | status, polite live region, in the page from the moment the board is | Each move that lands, by either player: "White pawn Bb1 to Cb1. Black to move.", with "takes {piece} on {cell}", ", promotes to {piece}", "Check.", or the result ("Checkmate. You win."). A snapshot that brings several moves announces only the last. |
| Presence | status, in the page from the moment the board is | "Your opponent is offline." and "Your opponent is online." as they change, the first report included. |
| Move box | a form named "Type a move"; the field labelled "Type a move, like Bb1-Cb1"; a "Play the move" button; a status line for problems | The field's label is read on reaching it (it is the first tab stop). A refused move's explanation, and "Wait for their move.", are announced politely; the explanation is linked to the field as its description, and the field is marked invalid. |
| Move list | an ordered list named "Move history", always visually hidden | Read when the user reaches it, one row per numbered White–Black pair. New rows are not announced; the move announcement says each move. |
| Promotion dialog | dialog, modal, named "Promote to" | Entered as a dialog named "Promote to", with focus on "Queen" and buttons "Queen", "Rook", "Bishop", "Knight", "Unicorn", and "Cancel". Everything behind it is hidden from the screen reader. |
| End-game dialog | dialog, modal, named by its heading and described by the line under it | Entered as a dialog named "You win", "You lose", or "Draw", described as "by checkmate" or "by stalemate", with focus on "Start new game". Everything behind it is hidden. |
| Replaced dialog | alert dialog, modal, named "This game is open in another tab", described by its sentence | Entered with focus on "Play here"; its sentence is read as the description. What is behind it is hidden, as listed under [focus](#focus). |

The start screen, the share-link, join, and joined screens have one heading, "3D Chess"; the crash screen's heading is "Something went wrong"; the board screen has no heading of its own, only the dialogs' titles. Only the start screen has a landmark: the whole page is its main content. The other pages have none (main content, navigation), so a screen reader user moves through each page element by element.

### What a screen reader user cannot learn

- **The position.** The board exposes no piece, cell, or square; its name says only which side is nearest and where to type. The only text form of the game is the move list, in [cell notation](../glossary.md#the-board), from which the position would have to be rebuilt by replaying every move mentally from the [starting position](../foundations/game-rules.md#the-starting-position). The move list is visually hidden always, and empty until the first move.
- **A selection, the legal destinations, or the last move.** The [move markers](../glossary.md#selection-and-board-state) and the last-move trace have no text. The newest move is the last entry in the move list. Which moves are legal can be learned only by typing one and reading the move box's answer.
- **An arriving move, in full.** The move announcement says the piece, its two cells, what it took, and check; what a screen reader cannot learn is where that leaves every other piece, except by replaying the list.
- **The opponent joining.** The share-link screen is replaced by the board screen without an announcement of its own.

## Color and contrast

### Marks told apart only by color

Every mark on the board is described in [the view](../foundations/the-view.md#markers-and-colors). How each pair differs:

| Pair | What tells them apart |
| --- | --- |
| Selection and check on a King | Shape as well as color: a selected piece rises into a column of white light; a King in check turns red all over and is ringed by dark blades over a red eight-pointed plate. A selected King in check shows both. Check is also shown as a "CHECK" badge on the turn pill, and said by the move announcement. |
| Destination (gold circle) and capture (red circle) | Color, and motion: a capture's circle carries four arcs turning slowly round the piece (held still under reduced motion), and it stands round a piece rather than on an empty cell. |
| Destination and last-move trace (mint) | Shape as well as color: the last move is a line between two cells with circles at its ends, not a lone circle. |
| White's pieces (porcelain) and Black's pieces (charcoal) | Lightness. Readable without color. |
| The five levels (cyan, azure, periwinkle, orchid, rose) | Color, and position: each level is at its own height in the tower and its letter stands beside it. A piece's foot band shows its level by color only. |

On the board, check is conveyed by the King's red and by the blades round him; the turn pill's "CHECK" badge and the move announcement's "Check." are the statements of it that do not depend on color. For a player with a red–green color vision deficiency, the red capture circle against the gold destination circle is the pair most at risk, with the turning arcs as the only other cue; this was not tested with a simulation.

### Contrast, by calculation from the colors in the code

The board's contrast figures that stood here were calculated from the colors of the board's earlier look and no longer apply: the marks are now light drawn on dark glass over a night scene, and the pieces are porcelain and charcoal. They have not been recalculated. The figures below are for the HUD only.

| Mark or text | Against | Contrast ratio |
| --- | --- | --- |
| Turn pill, the lit half's words | its dark glass | about 17 : 1 (the other half's muted words about 5.3 : 1) |
| "CHECK" badge (red) | its dark glass | about 7 : 1 |
| Move list, the latest move | its dark glass | about 17 : 1 |
| Move list, earlier moves and the row numbers (muted) | its dark glass | about 5.3 : 1 |
| Move box placeholder "Type a move" and its hint "e.g. Bb1-Cb1, then Enter · Esc to hide" (muted) | its dark glass | about 5.3 : 1 |
| Move box field text | the field | about 17 : 1 |
| A refused move's explanation (soft red) | its dark glass | about 8.6 : 1 |
| Move box ↵ button, ready | its white background | about 16 : 1 (muted, without a background, until a move is typed on the player's turn) |
| Error and frozen-board notices | their dark glass | about 17 : 1 (the red rule beside them is decoration) |

The HUD boxes are translucent glass; their figures shift slightly over a bright part of the board (the muted text stays above 4.5 : 1, about 4.9 : 1 over the lit scene). Every text in the HUD reaches the 4.5 : 1 usually asked of text this size.

### Controls that do not look like controls

The dialogs' buttons now look like controls: the promotion dialog's five pieces are bordered tiles, and "Start new game" and "Play here" have a thin border of light. "Cancel" in the promotion dialog is plain muted text, and the error banner's "✕" is a small glyph. The move box's ↵ button is muted until a move is typed on the player's turn. Read from the HUD styles at `bb16fed`; not checked by eye.

## Motion

The motion in the product:

- **The glide and the fade.** Every arriving move, on both boards, glides for 460 ms; a capture burns the captured piece away as the capturer arrives ([the view](../foundations/the-view.md#motion)). They play for the opponent's moves as well as the player's own. Some marks of play also move slowly while they are up: the arcs round a capturable piece turn, a light travels along the last-move line, motes drift round a held piece, and a check strikes and then breathes. At checkmate the King topples and a pulse spreads across his level.
- **The view's drift.** After a drag is released, the view keeps moving briefly and slows to a stop.
- **The start screen's preview.** The glass tower turns slowly (a full turn in about 90 seconds) while a sample game plays itself on it with the board screen's own glide, capture, check, and mate, and a black veil fades over the window and away between one game and the next, every 44 seconds or so, for as long as the page is open ([creating a game](../start/creating-a-game.md#the-preview)). Nothing on the page stops it except the system's reduced-motion setting: there is no pause (see open questions). Nothing on the page names the preview's result.
- **The start button's rim.** A rim of light in the five levels' colors turns round "Start a game" for as long as the start screen is open, once every 9 seconds, and fast (a turn in under a second and a half) while a create is waiting ("Connecting…", "Reconnecting…", or "Creating game…"). Under a hovering mouse the button lifts and swells a little, and its knight hops.
- **Button hover.** "Join Game" grows slightly and turns a little gray over 200 ms while a mouse is over it; "Start a game" lifts and swells a little over 200 ms, and its knight hops. Devices without hover (touch screens) never show it.
- **The breathing dot.** A small light breathes in the start button, in the knight's place, while it reads "Connecting…", "Reconnecting…" or "Creating game…", and beside the game page's "Reconnecting…".

Nothing else moves: nothing blinks or flashes, and the board screen is redrawn only when something changes.

On the start screen, reduced motion makes the preview a still picture of the game's final position (the mating move's line and the check showing, the black King left standing), with no turning, no veil, and no repeat; the start button's rim holds still, its knight does not hop, and its hover appears without fading. Changing the setting while the start screen is open takes effect at once. The start screen's breathing dot is not affected by it (see open questions).

When the operating system (or the browser) asks for reduced motion, the glide and the fade do not play: an arriving move simply appears in its new cell, a captured piece simply disappears, and the last-move line still shows which two cells the move joined. The marks of play hold still too. The preference is read whenever the board is updated, so changing it takes effect from the next move. The view's drift and the join screen's hover growth are not affected by it, and the app has no motion setting of its own.

## Text size and zoom

Text on the page is sized in two ways. The HUD uses fixed sizes that ignore the browser's default font size: the turn pill (14.5 px, 13.5 px on the narrowest phones), the move card (13 px), the notices under the pill (13 to 13.5 px), the promotion dialog's tiles (11.5 px under the piece), and the dialogs' titles (20 to 24 px). The start screen uses fixed sizes too (its title 26 to 52 px with the window, the button's label smaller). Everything else follows the browser's default font size: the share-link, join, and joined screens, and the crash screen. Raising the browser's default font size therefore enlarges the game page's pre-game screens and leaves the start screen and the board screen's HUD as they were.

Browser zoom (Ctrl or Cmd with + and −) enlarges every HTML panel, but not the board: the board always fills the window, whatever the zoom, and is framed to fit it. The only way to make the board bigger is to [zoom the view](../foundations/the-view.md#turning-the-view), down to the view's closest limit. Ctrl with the wheel, and a trackpad pinch that the browser reports the same way, zoom the view rather than the page while the pointer is over the board; over the HTML panels that take the pointer (the move box, the error banner, and the move list) they zoom the page as usual, and the keyboard zoom works everywhere.

The page never scrolls. Zooming in makes the page narrower in the browser's terms, so at high zoom the HUD takes its phone arrangement (the pill across the top row, the move box across the bottom while it shows) exactly as in a narrow window, and its parts do not overlap. On the start screen and the pre-game screens, content that no longer fits the window is cut off with no way to scroll to it; see [screen sizes and touch](screen-sizes-and-touch.md).

The dialogs' titles ("Promote to", the end-game heading, and "This game is open in another tab") are, read from the styles, the same size and weight as ordinary text: the base styles reset headings, and these do not set their own size.

## Page language and title

Every page declares its language as English, and all on-screen text is English. The page title is "3D Chess — Online Multiplayer" on every page and never changes, so neither a page change nor anything in the game (the opponent joining, a move, the end) is reflected in the tab.

## Cancel and interrupt

"Before sending" is while a keyboard or screen reader user is using a control or reading the page, before a request leaves the browser; "while in flight" is after a request has been sent (a create, a join, or a move). Each row says what the event means for focus, keyboard reach, and what assistive technology is told.

| Event | Before sending | While in flight |
| --- | --- | --- |
| Escape or Cancel | Escape cancels the promotion dialog while focus is inside it, which it is from the moment it opens; "Cancel" works with Enter or Space. Either way focus falls to the page, and a screen reader is not told the dialog closed. Escape does nothing anywhere else, and does not empty the move box. | No effect. Nothing in flight can be cancelled from the keyboard or any other input. |
| Pressing elsewhere or turning the view | A press on the board or a click on a non-focusable part of the page takes focus off the move box or a button. A click on the promotion panel between buttons does the same, after which Escape no longer works. The wheel changes nothing about focus. | No effect on focus. The board is [held](../glossary.md#selection-and-board-state): presses do nothing and the move box sends nothing; the turn pill still lights the player's half, and nothing says the move is on its way. |
| Leaving the game page within the app | "Start new game" (focused when the end-game dialog opens), "Back to start", or browser Back (Alt+Left or Cmd+[ on the keyboard) change the page without moving focus or changing the title; a screen reader is not told the page changed. | Same. The answer to the request is lost to this page, as described in each feature's own table. |
| The game ends | The end-game dialog opens with focus on "Start new game" and is announced as a dialog named by its result. The board, the HUD, and the move box behind it are inert. | Same when the player's own move ends the game: the move lands and the dialog takes focus from the move box. |
| The server answers with an error | Not applicable: nothing sent. An error answering the page's own automatic rejoin is announced as an alert like any other; a rejoin refused because another tab holds the seat opens the replaced dialog instead, which takes focus. | The error is announced as an alert, on the start screen or in the error banner. Focus is not moved; the banner's "✕" ("Dismiss error") can be reached with Tab, and dismissing it drops focus to the page. |
| The connection drops | On the start screen nothing is said unless a create is waiting, when the button's label changes to "Reconnecting…" and the hidden status's "Reconnecting to server…" is announced politely. On the game page the reconnecting line appears under the dimmed turn pill and is announced politely; the board and the move box stop taking input without any text saying so, and an open promotion dialog closes, taking focus with it. | Same. Nothing announces whether a move in flight was recorded; the next snapshot changes the board silently, and the move announcement speaks for any move that lands. |
| The window loses focus or the tab is hidden | No effect. The browser remembers which control had focus and restores it when the window returns; an open promotion dialog keeps whichever of its buttons had focus. | No effect. Anything that arrived while the tab was hidden is announced as it arrives, if the screen reader is reading that tab; the unchanging title gives no sign of it. |
| Reload or closing the tab | Focus starts over: nothing is focused after the reload. | Same. |
| The opponent acts | The opponent's moves are announced as they land, and their leaving and returning through the presence status; their joining is not announced. Focus is not disturbed, so a player typing in the move box keeps typing. | Same. |
| Another tab takes the seat | The replaced dialog opens with focus on "Play here" and is announced as an alert dialog with its sentence. An open promotion dialog closes. The same happens when this tab's connection returns and finds the seat held by the other tab. | Same. The answer goes to the other tab, and this one says nothing about it. |
| A second touch point or a cancelled touch | No accessibility effect of its own; a second finger never acts on the board ([screen sizes and touch](screen-sizes-and-touch.md#touch)). With a touch screen reader running, the board offers nothing to explore, and the move box is the way to play. | No effect. |

After any interrupt, focus is where it was, on the page itself, or on the first button of a dialog that opened; the app never moves it to anything else that appeared.

## Interactions with other systems

**Seat and turn.** The turn pill carries a description for screen readers, "You play White. Your move.", read when the user reaches it; every move announcement ends with whose move it is now, relative to the player ("Your move." or "Black to move."). The move box sends a move only on the player's turn and says "Wait for their move." otherwise.

**The game record.** The move list is the only text form of the whole record and of the position. It is a list named "Move history", in the page, out of sight; it is not a live region, but every move is announced as it lands by the move announcement.

**Connection.** The start screen's connection status (shown only while a create waits for the connection) and the game page's reconnecting banner are marked as status messages, and every error is marked as an alert. That the board and the move box do not take input while disconnected, or while a rejoin is answered, is shown by nothing but the reconnecting line and the move box's ↵ button staying muted; Enter then sends nothing and says nothing.

**The opponent.** The opponent's moves are announced as they land, and their connection through the presence status ("Your opponent is offline."). Their joining is not announced.

**Other tabs and devices.** The replaced dialog is an alert dialog that takes focus and hides everything behind it, an end-game dialog included.

**Game over.** The end-game dialog is a modal dialog named by its result, said to the player ("You win", "You lose", "Draw"), described by how ("by checkmate"), and takes focus on its only button. The last move's announcement ends with the result too.

**Stored seat.** No accessibility aspect: the [rejoin](../glossary.md#the-connection) that the stored seat triggers needs no input from the player.

**Keyboard, touch, and screen size.** This document covers the keyboard. Touch, window size, and the 3D requirement are in [screen sizes and touch](screen-sizes-and-touch.md); on a small window the board's cells, and so the press targets, are smaller, and the move box is an alternative there too.

## Edge cases

- **A quick promotion.** Because the promotion dialog opens with focus on "Queen", Enter or Space right after the click that opened it promotes to a Queen. A player who pressed the key meaning something else gets a Queen.
- **Typing ahead.** The move box can be typed in during the opponent's turn; Enter does nothing until the opponent's move lands, and the move is then judged against the new position.
- **Tab on the board screen.** With no error and no dialog, Tab on the board screen reaches the move box's field (bringing it into sight), then its ↵ button, and then the browser's own controls.
- **Two dialogs at once.** A finished game whose tab is replaced shows the replaced dialog over the end-game dialog. Only "Play here" can be reached; "Start new game" comes back within reach once the tab holds the seat again.
- **The focus ring after a click.** "Join Game" and "Copy link" show their blue ring after a mouse click as well as after Tab, because the ring follows focus, not keyboard use. "Start a game" shows its ring only after the keyboard.
- **The join screen says nothing about the game.** A screen reader user arriving from a share link hears the heading "3D Chess" and a "Join Game" button; nothing names the game or the player who sent the link.
- **The joined screen is silent.** "Joined game, waiting for start..." replaces the "Join Game" button without an announcement, and normally lasts only a fraction of a second before the board screen, also unannounced except for what its live regions say.
- **The share link is read, not followed.** A screen reader reads the share link as text; it is not a link. "Copy link", where offered, copies it.
- **Several moves at once.** A snapshot that brings several moves (after a reconnect or "Play here") is announced once, as its last move and the side to move after it.

## Open questions and verification

- **The board itself stays pointer-only.** The decision recorded in [B-09](../bug-triage.md#b-09-the-game-cannot-be-played-without-a-pointer-and-dialogs-and-cues-are-not-accessible) was typed moves rather than keyboard navigation of the 3D board. A keyboard or screen reader player can play, but can learn the position only from the move list, and legal moves only by trying them. Whether a described position or a keyboard cursor over cells is wanted is a product call.
- **Check on the board is shown only by color**, and the destination fill and the last-move trace differ only in hue. The selection ring and the destination dots have almost no lightness contrast with the background (about 1 : 1 by calculation). Likely worth treating as defects; not tested with a color vision simulation.
- **Announcements that start the page.** The move announcement, the presence status, and the reconnecting line's status region are in the page from the moment the board is, so their first change should be announced; not tried with a screen reader.
- **Contrast figures are calculated** from the HUD styles; they were not measured on screen. The board's figures, calculated from the old `client/src/three/theme.ts` (since deleted), were withdrawn when the board's look changed and have not been recalculated for the new look (`client/src/three/scene/palette.ts`).
- **The dialogs' buttons may not look like buttons**, and the dialogs' titles may look like ordinary text: both read from the base styles, which strip the browser's default button and heading styling. Not checked by eye.
- **The start screen was redesigned as a landing page** after `4e18386`: its Tab order (the start button alone), its roles (the hidden alert and status, the button's changing name, the hidden preview, the description for screen readers), and the preview's reduced-motion still are covered by `client/src/screens/StartScreen.test.tsx`, and the rest was read from `client/src/screens/StartScreen.tsx`, `client/src/screens/LandingPreview.tsx`, and the `.landing` rules in `client/src/index.css`. Not tried with a screen reader or the system setting.
- **The start screen's breathing dot ignores reduced motion.** The rule that stills the HUD under reduced motion covers the game page only; the dot in the start button while it reads "Connecting…", "Reconnecting…" or "Creating game…" keeps breathing. Whether that is wanted is a design call.
- **A preview that cannot be paused.** The preview moves on its own for as long as the page is open, beside the page's one control, and only the system's reduced-motion setting stops it. WCAG 2.2.2 (Pause, Stop, Hide) asks for a way to pause, stop, or hide moving content that starts by itself, lasts more than five seconds, and is shown beside other content; the start screen had a "Pause preview" button for that, which the owner removed. Whether the preview counts as essential decoration or needs a pause again is a product and accessibility call.
- **Reduced motion covers the glide, the capture, and the marks' own motion.** `client/src/three/motion.ts:22-25` reads the preference, and `client/src/three/Board.tsx:131-132` skips the animation when it is set; the view's drift and the buttons' hover growth ignore it. Covered by "skips the glide and the fade when the player prefers reduced motion" in `client/src/three/Board.test.tsx`; not tried with the system setting.
- **Silence when the move box may not send.** On the opponent's turn a submit now says "Wait for their move." (`client/src/screens/MoveCard.tsx`); while the board is held, disconnected, or frozen, a submit still does nothing and says nothing.
- **Mixed text sizing.** Some HUD panels use fixed pixel sizes and ignore the browser's default font size. Not checked with a changed default size.
- **The move list's reach and reading.** Whether a scrolling move list becomes a tab stop depends on the browser. Whether Safari keeps its list semantics (its style removes the list bullets, which Safari can take as "not a list"), and how screen readers pronounce entries such as `Ab2–Ab3` and the en dash, were not tried.
- **What a screen reader says about the board** (its name as an image) was not tried.
- The roles, names, and focus are covered by `client/src/App.test.tsx` (the alert, status, dialog "Promote to", the replaced dialog's focus on "Play here" and the inert game behind it, the turn pill's description and check, the move announcement, the presence status, and the move box, shown by Tab), `client/src/components/ErrorBoundary.test.tsx` (the crash screen's alert and "Back to start" link), and the unit tests of the move box's parser (`client/src/game/typedMove.test.ts`). Focus on "Queen" when the promotion dialog opens and on "Start new game" in the end-game dialog was seen in headless Chromium. Everything else was read from `client/src/screens/*.tsx`, `client/src/components/ErrorBoundary.tsx`, `client/src/three/Board.tsx`, `client/src/screens/TurnPill.tsx`, `client/src/screens/MoveCard.tsx`, `client/src/game/announce.ts` (with `announce.test.ts`), `client/src/three/motion.ts`, `client/src/three/theme.ts`, `client/index.html`, the `OrbitControls` wrapper in `@react-three/drei`, and Tailwind's base styles. No part of this document was tried with a screen reader.

- The board's look changed at `bb16fed` (the glass tower, the porcelain and charcoal pieces, the gold and red markers, the mint last-move line, the red King in check); this document's mentions of it were brought up to date from the code and [the view](../foundations/the-view.md), not checked in the running app, and need re-verification.

Verified against 3D Chess commit `4e18386`; the HUD's roles, names, Tab order, and announcements against `f7bff4d`
