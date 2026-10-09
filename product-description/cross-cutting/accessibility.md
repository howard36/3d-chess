# Accessibility

## Summary

3D Chess is built around a 3D [board](../glossary.md#the-board) that is used with a pointer: a mouse, a finger, or a pen. The board itself cannot be reached, navigated, or played from the keyboard, and the [view](../glossary.md#the-view) cannot be turned from the keyboard. Around the board everything is ordinary HTML, and since the board cannot be played without a pointer, the board screen offers a second way to play: the [move box](../glossary.md#the-interface), where a move is typed in cell notation ("Bb1-Cb1", with "=Q" and the like for a promotion) and sent with Enter. It is out of sight until it has focus, but it is the first thing Tab reaches on the board screen and appears as soon as it has focus. With it, a keyboard or screen reader user can play a whole game, against a friend or the computer, and every move that lands is announced ("White bishop Ad2 takes pawn on Dd5. Check. Your move."). Every button on every page can be reached with Tab and used with Enter or Space; each dialog takes keyboard focus as it opens and puts everything behind it out of reach; and the turn, check, presence, errors, and the result are announced to screen readers as they change. What remains visual only is the board itself: the position, the selection, the legal destinations, and the last move, and with them the [tutorial](../learn/the-tutorial.md)'s lessons, which teach on the board and have no move box. This document collects what the product offers and lacks for keyboard users, screen reader users, players with low vision or a color vision deficiency, and players sensitive to motion. How a press works is owned by [the input model](../foundations/input-model.md); window size, touch, and the 3D requirement by [screen sizes and touch](screen-sizes-and-touch.md).

## Who can do what

| Player | Can | Cannot |
| --- | --- | --- |
| Pointer and sight (mouse, touch, or pen) | Everything the product offers. | Nothing is withheld. |
| Keyboard only | Choose a way to play on the home page; pick a side (and a difficulty against the computer); copy the share link ("Copy link", where offered); join a game ("Join game"); play every move by typing it in the move box (Tab brings it up), promoting by typing the piece's letter; dismiss an error; answer the promotion dialog if a pointer opened it; close the result card (Escape) or leave a finished game ("Play again"); take the seat back ("Play here"); open the tutorial and move through its lessons and steps; leave the crash screen ("Back to start"). | Select a piece on the board, see its legal destinations, turn the view, or play a move in the tutorial. |
| Screen reader | Hear every move as it lands, with the piece, what it took, check, and whose move it is now; the opponent coming and going; errors; the result of the game; the [frozen-board banner](broken-game-record.md) and the crash screen; the lobby's arrival line ("Opponent joined", "You play Black", "Computer · Hard"); read the page headings, the [turn pill](../game-page/turn-indicator.md)'s description ("You play White. Your move."), the captured pieces as sentences, and the [move list](../game-page/move-list.md); play by typing moves in the move box and hear why a move was refused; read the tutorial's words and its count of moves; use every HTML control. | Perceive the position, a selection, the legal destinations, or the last move, except by reading the move list and replaying it mentally; learn which moves are legal except by trying them; follow the tutorial's demonstrations on the board. |
| Low vision | Enlarge the HTML with browser zoom; bring the board closer by zooming the view with the wheel, a middle drag, or a pinch. | Enlarge the board with browser zoom (it always fills the window), or scroll to content that zoom pushes out of the window. Check is shown on the board only (the pill no longer marks it). |
| Color vision deficiency | Tell White's pieces from Black's, which differ in lightness; tell a King in check by his blades as well as his red. | Tell the gold destination circle from the red capture circle by anything but hue and the capture's turning arcs; tell the levels apart by anything but hue and height. |
| Sensitive to motion | Turn off the moves' glide, the capture's fall, the check's rock, a refused piece's shake, the mate's knock and the winners' hops, the game's entrance (a short fade instead), the lobby's slow beats, and the home page's [preview](../glossary.md#the-product-and-its-screens) (a still picture) with the system's "reduce motion" setting, which the app follows; avoid the rest by not turning the view. | Turn off the view's drift after a drag. The app has no motion setting of its own, and the preview has no pause. |

## Keyboard

### What Tab reaches

Tab moves keyboard focus through the page's HTML buttons, its one text field, and its one link, in page order. Disabled buttons are skipped. While a dialog is up, Tab reaches only that dialog's buttons (and the browser's own controls), because everything behind it is inert.

| Screen | Reachable with Tab |
| --- | --- |
| [Home page](../start/the-home-page.md) | "Play a friend", "Play the computer", "How to play". The preview is never reached. |
| Side choice | "← Home", then "White", "Random", and "Black", each only once its king has formed. After a pick, nothing but "← Home"; against the computer, then "Easy", "Medium", and "Hard", the one last played focused. |
| Invitation to send | "← Home" and "Copy link" (focused on arrival), where the browser allows copying (an `https` address or `localhost`). The [share link](../glossary.md#games-and-seats) itself is plain text, not a link. |
| Invitation to the free seat | "← Home" and "Join game" (focused on arrival); or the card's "Play a friend" (focused). While joining, "Joining…" keeps focus but does nothing. |
| "Returning to your game…" | "← Home". |
| Board screen, no dialog | The error banner's "✕" when an error shows; the move box's field (which appears when it takes focus) and its ↵ button; "How to play"; "Retry" if the board failed to load; "Play again" below the tower once the result card has been closed. Nothing on the board. |
| Board screen, promotion dialog open | The five piece buttons and "Cancel". |
| Board screen, result card up | "Close" and "Play again" (focused). |
| Any game page screen, when [replaced](../glossary.md#events-that-end-or-interrupt-a-request) | "Play here" only. |
| Tutorial | "← Home" (or "← Game"), the eight lesson buttons, the Pawn lesson's step dots, "Reset" once a move has been played, and the next button. |
| Crash screen | "Back to start", a link. |

The turn pill, the banners' text, the headings, and the board are never focusable.

### Playing from the keyboard

The move box is the text field of the [move card](../glossary.md#the-interface), labelled "Type a move, like Bb1-Cb1" for screen readers, with a ↵ button ("Play the move") beside it. The card is out of sight, but the field is the first tab stop on the board screen (after the error banner's "✕" when an error shows): pressing Tab brings the card up with the field alone and a hint ("e.g. Bb1-Cb1, then Enter · Esc to hide"), and Escape, or leaving the field empty, puts it away again.

A move is two cells, level-file-rank, in either case, with a hyphen, an en dash, an "x", spaces, or nothing between them: `Bb1-Cb1`, `bb1 cb1`, and `Bb1Cb1` are the same move. A promotion adds the piece's letter, Q, R, B, N, or U, with or without "=": `Da4-Ea5=U`. Enter in the field or the ↵ button submits.

A move that is legal is sent exactly as a press on the board would send it, and the field empties; the board is then [held](../glossary.md#selection-and-board-state) until the move lands, and focus stays in the field, ready for the next move. A move that cannot be played is not sent; a line under the field says why (see [error messages](error-messages.md#explained-by-the-move-box)), the field is marked invalid, and the text stays to be corrected. A move submitted on the opponent's turn is not sent either, and the line says "Wait for their move." A typed promotion is sent directly, without the promotion dialog.

The field can be typed in at any time. Once the game is over, a submit says "Wait for their move.", as on the opponent's turn. On the player's own turn while the board takes no input (a move in flight, a drop, a frozen record, the entrance), a submit does nothing and says nothing.

### What the keyboard cannot do

- **Use the board.** There is no keyboard cursor over the cells, no way to select a piece or see its legal destinations, and the board cannot take focus. The move box is the keyboard's way to play.
- **Turn the view.** The arrow keys, Page Up and Down, and + and − do nothing to the view.
- **Play in the tutorial.** The tutorial has no move box; its lessons can be read but not tried.
- **Close the replaced dialog.** It has no close control for anyone.
- **Use shortcuts.** There are none.

### Escape

Escape is handled in three places: in the promotion dialog it cancels the promotion; on the result card it closes the card; in a move box that Tab brought up it empties the box and puts it away. Escape anywhere else does nothing: it does not clear a [selection](../glossary.md#selection-and-board-state), dismiss the error banner, or close the replaced dialog.

## Focus

Nothing is focused when the home page or the board screen loads. The app moves focus in these places:

- **The invitations.** The invitation to send puts focus on "Copy link"; the invitation to the free seat on "Join game", or on its card's "Play a friend".
- **The difficulty.** Against the computer, the difficulty last played (Medium the first time) takes focus as the three tiles appear.
- **The promotion dialog** puts focus on "Queen" as it opens, so Enter or Space picks the Queen at once, Escape cancels, and Tab moves to "Rook", "Bishop", "Knight", "Unicorn", and "Cancel". When it closes, focus falls to the page.
- **The result card** puts focus on "Play again" as it opens. The board and the HUD behind it, the move box included, are inert. When it is closed, focus falls to the page, and the browser carries on from where the card was: the next Tab reaches "Play again" below the tower, not the move box (seen in Chromium at `24c650c` after Escape).
- **The replaced dialog** puts focus on "Play here" as it opens. Everything behind it is inert, the result card included.
- **The move box** keeps focus in its field after a move is sent or refused, so a keyboard player types the next move without Tab.
- **A control that disappears** (a side button after the pick, "Join game", "✕", "Play here", a piece button, "Cancel", "Play again") takes focus with it. Focus drops to the page and nothing moves it to the new content.
- **Page changes** within the app move no focus and do not change the page title, so nothing signals the change itself to a keyboard user; a screen reader hears the new page's live regions and can find its heading.

## Screen readers

### What is marked for assistive technology

| Element | Marked as | What a screen reader is told |
| --- | --- | --- |
| Home page preview | hidden | The picture is skipped. In its place: "Preview: a sample game plays itself on the five-level tower and ends in checkmate by White." |
| Page headings | headings | The home page's "3D Chess"; the lobby's "Choose your side", "You play White", "You're invited to play" with the side's name, "Choose difficulty"; the invitation's card "Invite a friend", "This game is taken", "No game here"; the tutorial's lesson name. The board screen has none of its own. |
| The side choice's buttons | a group named "Choose your side"; each button marked pressed once chosen; the difficulty tiles a group named "Difficulty" | Read with their names. |
| The side choice's bottom line | status | "Connecting to server…", "Reconnecting to server…", "Waiting for server…" (only once a wait has lasted 1.5 s), or "Couldn't start a game: {message}". |
| The lobby's arrival line | status, never shown as such (the line shown is hidden from readers) | "Opponent joined", "You play Black", or "Computer · Hard", announced politely. |
| The invitation's cards "This game is taken" and "No game here" | alert | Announced when they appear. |
| Copy status, "Link copied" (never shown) or "Couldn't copy. Select the link." | status | Announced politely after a click on "Copy link". |
| "Returning to your game…" | status | Read as the page appears. |
| Error banner, the message, and its "✕" | alert; read as "Error: {message}"; the button named "Dismiss error" | Announced when it appears. |
| Reconnecting line, "Reconnecting…" | status, in the page before the line appears | Announced politely when it appears. |
| Frozen-board banner, "Move {n} of this game can't be replayed…" | alert | Announced when it appears. |
| "Couldn't load the board" and its "Retry" | alert | Announced when it appears. |
| Crash screen | alert (heading, sentence, and link) | Announced when it replaces the page. |
| The board | an image, named "The 3D board, white side nearest. Pieces are selected and moved with a pointer; to play from the keyboard, press Tab to type a move." ("black side nearest" for Black) | Its name, which points to the move box. Nothing about the position. |
| Turn pill | plain text, with a description for screen readers: "You play White. Your move." ("Black to move", ", in check", "Your opponent is offline.", or the result: "Checkmate, you win.", "Repetition, a draw.") | Read when the user reaches it. Its changes are not announced by the pill itself; the move announcement says them. |
| Captured pieces | plain text after the pill, one sentence per side with anything to say: "You have taken a unicorn and 2 pawns; you are 1 ahead." | Read when reached; not announced. |
| Move announcement | status, polite live region, in the page from the moment the board is | Each move that lands, by either player: "White pawn Bb1 to Cb1. Black to move.", with "takes {piece} on {cell}", ", promotes to {piece}", "Check.", or the result ("Checkmate. You win.", "Repetition. Draw."). A snapshot that brings several moves announces only the last. |
| Presence | status, in the page from the moment the board is | "Your opponent is offline." and "Your opponent is online." as they change. |
| Move box | a form named "Type a move"; the field labelled "Type a move, like Bb1-Cb1"; a "Play the move" button; a status line for problems | A refused move's explanation, and "Wait for their move.", are announced politely; the explanation is the field's description, and the field is marked invalid. |
| Move list | an ordered list named "Move history", always visually hidden | Read when reached, one row per numbered White–Black pair. |
| "How to play" | a button named "How to play" (a "?" on narrow windows, still named in words) | Read with its name. |
| Promotion dialog | dialog, modal, named "Promote to" | Entered with focus on "Queen". Everything behind it is hidden. |
| Result card | dialog, modal, named by its heading and described by the line under it | Entered as a dialog named "You win", "You lose", or "Draw", described as "by checkmate", "by stalemate", "by repetition", or "by the 50-move rule", with focus on "Play again"; its close button is named "Close". Everything behind it is hidden. |
| Replaced dialog | alert dialog, modal, named "This game is open in another tab", described by its sentence | Entered with focus on "Play here". |
| Tutorial | the board an image named "The 3D board, White's side nearest, with the lesson's pieces."; the lesson buttons a navigation named "Lessons", each named for its lesson; the step dots a group, each named for its step; the count of moves a polite live region; the next button named "Next: {what comes next}" | The words and the count; nothing of the board. |

### What a screen reader user cannot learn

- **The position.** The board exposes no piece, cell, or square; its name says only which side is nearest and where to type. The only text form of the game is the move list, from which the position would have to be rebuilt by replaying every move mentally from the [starting position](../foundations/game-rules.md#the-starting-position).
- **A selection, the legal destinations, or the last move.** The marks of play have no text. Which moves are legal can be learned only by typing one and reading the move box's answer.
- **The tutorial's demonstrations.** The count of moves is read, and the words; the rings and the piece's moves are not.

## Color and contrast

### Marks told apart by color

Every mark on the board is described in [the view](../foundations/the-view.md#markers-and-colors). How each pair differs:

| Pair | What tells them apart |
| --- | --- |
| Selection and check on a King | Shape as well as color: a selected piece rises into a column of white light; a King in check turns red and is ringed by dark blades. A selected King in check shows both. Check is also said by the move announcement. |
| Destination (gold circle) and capture (red circle) | Color, and motion: a capture's circle carries four arcs turning slowly round the piece (held still under reduced motion), and it stands round a piece rather than on an empty cell. |
| Destination and last-move trace (mint) | Shape as well as color: the last move is a line between two cells with circles at its ends, not a lone circle. |
| White's pieces (porcelain) and Black's pieces (charcoal) | Lightness. Readable without color. |
| The five levels (rose, orchid, violet, blue, sky, from A to E) | Color, and position: each level is at its own height and its letter stands beside it. A piece's foot band shows its level by color only. |

For a player with a red–green color vision deficiency, the red capture circle against the gold destination circle is the pair most at risk, with the turning arcs as the only other cue; this was not tested with a simulation.

### Contrast

The HUD's contrast was calculated from its styles at `f7bff4d`: the turn pill's lit words about 17 : 1 against its dark glass, the muted words, placeholders, and hints about 5.3 : 1, a refused move's explanation about 8.6 : 1, and the notices about 17 : 1; every text in the HUD reached the 4.5 : 1 usually asked of text this size. These were not recalculated for this refresh, nor measured on screen; the board's own figures have not been calculated for its current look.

## Motion

The motion in the product:

- **On the board.** Every arriving move glides; a capture knocks the captured piece over; a King put in check rocks on his foot; a piece the player cannot pick up shakes its head; at mate the King is knocked over and the winners hop; some marks move slowly while up (the capture arcs turn, a light travels along the last-move line, the blades glint). Every board screen opens with an [entrance](../foundations/the-view.md#the-entrance) that builds the tower in light.
- **The view's drift.** After a drag is released, the view keeps moving briefly and slows to a stop.
- **The lobby.** Its entrance (the glass drawing itself, the kings forming), the pick, the coin toss for Random, the open seat breathing for its first minute, and the arrival and the camera's move into the game.
- **The home page's preview.** The tower turns slowly while a sample game plays itself, and a black veil fades between one game and the next, every 44 seconds or so, for as long as the page is open. Nothing on the page stops it except the system's reduced-motion setting: there is no pause. The tiles' rims turn and a sheen sweeps across them under the pointer.
- **The breathing dot** beside "Reconnecting…" and "Waiting for your friend…".

When the operating system (or the browser) asks for reduced motion, the board's motions do not play (a move simply appears, a captured piece simply disappears, a mated King is simply shown fallen), the marks of play hold still, the entrance is a 150 ms fade, the lobby's beats each take a fraction of a second and the open seat does not breathe, and the home page's preview is a still picture of the game's final position with still rims. The view's drift is not affected, and the app has no motion setting of its own.

## Text size and zoom

The HUD and the home page use fixed pixel sizes that ignore the browser's default font size; raising the default font size changes little in the app. Browser zoom (Ctrl or Cmd with + and −) enlarges every HTML part but not the board: the board always fills the window, whatever the zoom, and is framed to fit it. The only way to make the board bigger is to [zoom the view](../foundations/the-view.md#turning-the-view). Ctrl with the wheel zooms the view rather than the page while the pointer is over the board.

The page never scrolls (the tutorial's card scrolls its own words if a window is too short). Zooming in makes the page narrower in the browser's terms, so at high zoom the HUD and the menus take their phone arrangements, exactly as in a narrow window. Content that no longer fits the window is cut off with no way to scroll to it; see [screen sizes and touch](screen-sizes-and-touch.md).

## Page language and title

Every page declares its language as English, and all on-screen text is English. The page title is "3D Chess — Online Multiplayer" on every page; it changes only for a host whose tab is in the background when the guest arrives ("● Opponent joined · 3D Chess").

## Cancel and interrupt

"Before sending" is while a keyboard or screen reader user is using a control or reading the page, before a request leaves the browser; "while in flight" is after a request has been sent (a create, a join, or a move). Each row says what the event means for focus, keyboard reach, and what assistive technology is told.

| Event | Before sending | While in flight |
| --- | --- | --- |
| Escape or Cancel | Escape cancels the promotion dialog and closes the result card; "Cancel" works with Enter or Space. Focus falls to the page; a screen reader is not told the dialog closed. Escape puts away a move box brought up by Tab. | No effect. Nothing in flight can be cancelled. |
| Pressing elsewhere or turning the view | A press on the board or a click on a non-focusable part of the page takes focus off the move box or a button. | No effect on focus. The board is held, and nothing says the move is on its way. |
| Leaving the game page within the app | "Play again", "How to play", "← Home", or browser Back change the page without moving focus or changing the title. | Same. The answer to the request is lost to this page. |
| The game ends | The result card opens with focus on "Play again" and is announced as a dialog named by its result. | Same when the player's own move ends the game: the move lands, the end plays out, and the card takes focus from the move box. |
| The server answers with an error | An error answering the page's own automatic rejoin is announced as an alert; a seat in use opens the replaced dialog instead, which takes focus. | The error is announced as an alert. Focus is not moved. |
| The connection drops | On the board screen the reconnecting line appears under the dimmed pill and is announced politely; the board and the move box stop taking input without any text saying so, and an open promotion dialog closes, taking focus with it. | Same. The move announcement speaks for any move that lands after the rejoin. |
| The window loses focus or the tab is hidden | No effect. | No effect. |
| Reload or closing the tab | Focus starts over. | Same. |
| The opponent acts | The opponent's moves are announced as they land, and their leaving and returning through the presence status; their joining is said by the lobby's arrival line. Focus is not disturbed. | Same. |
| Another tab takes the seat | The replaced dialog opens with focus on "Play here" and is announced as an alert dialog. An open promotion dialog closes. | Same. |
| A second touch point or a cancelled touch | No accessibility effect of its own. With a touch screen reader running, the board offers nothing to explore, and the move box is the way to play. | No effect. |

## Interactions with other systems

**Seat and turn.** The lobby's headings name the player's side in words; on the board screen the turn pill's description does ("You play White. Your move."), and every move announcement ends with whose move it is now, relative to the player.

**The game record.** The move list is the only text form of the whole record and of the position.

**Connection.** The side choice's bottom line and the game page's reconnecting line are status messages, and every error is an alert. That the board and the move box do not take input while disconnected is shown by nothing but the reconnecting line.

**The opponent.** The opponent's moves are announced as they land, their connection through the presence status, and their arrival by the lobby's line.

**Other tabs and devices.** The replaced dialog is an alert dialog that takes focus and hides everything behind it.

**Game over.** The result card is a modal dialog named by its result, said to the player, and takes focus on "Play again"; Escape closes it. The last move's announcement ends with the result too.

**Stored seat.** No accessibility aspect.

**Keyboard, touch, and screen size.** This document covers the keyboard. Touch, window size, and the 3D requirement are in [screen sizes and touch](screen-sizes-and-touch.md).

## Edge cases

- **A quick promotion.** Because the promotion dialog opens with focus on "Queen", Enter or Space right after the press that opened it promotes to a Queen.
- **Typing ahead.** The move box can be typed in during the opponent's turn; Enter says "Wait for their move." until the opponent's move lands, and the move is then judged against the new position.
- **Enter after the last move.** Focus moves to "Play again" as the result card appears; a stray Enter leaves the game.
- **Two dialogs at once.** A finished game whose tab is replaced shows the replaced dialog over the result card. Only "Play here" can be reached.
- **Several moves at once.** A snapshot that brings several moves is announced once, as its last move and the side to move after it.

## Open questions and verification

- **The board itself stays pointer-only.** The decision recorded in [B-09](../bug-triage.md#b-09-the-game-cannot-be-played-without-a-pointer-and-dialogs-and-cues-are-not-accessible) was typed moves rather than keyboard navigation of the 3D board. The tutorial has no typed moves at all. Whether a described position or a keyboard cursor over cells is wanted is a product call.
- **Check is no longer stated on the pill.** Sighted players see it only on the board (red, blades); the pill's screen-reader description and the announcement still say it. Whether a non-color cue on the HUD is wanted again is a design call.
- **A preview that cannot be paused.** WCAG 2.2.2 (Pause, Stop, Hide) asks for a way to pause moving content that starts by itself, lasts more than five seconds, and is shown beside other content; the home page's preview has none, beside its three controls. A product and accessibility call.
- **Reduced motion and the breathing dots.** Whether the lobby's "Waiting for your friend…" dot and the reconnecting dot hold still under reduced motion was not checked.
- **Read, not tried.** The roles, names, and focus are read from `client/src/screens/` (`StartScreen.tsx`, `lobby/ChooseSide.tsx`, `lobby/LobbyCards.tsx`, `lobby/LobbyLayout.tsx`, `GameScreen.tsx`, `GameView.tsx`, `TurnPill.tsx`, `CapturedPieces.tsx`, `MoveCard.tsx`, `MoveAnnouncer.tsx`, `EndGameModal.tsx`, `PromotionPicker.tsx`, `learn/LearnScreen.tsx`), `client/src/game/announce.ts`, `client/src/game/material.ts`, and `client/src/components/ErrorBoundary.tsx` at `24c650c`, and covered in part by their unit tests. No part of this document was tried with a screen reader or the system's reduced-motion setting for this refresh.

Drafted against 3D Chess commit `24c650c`
