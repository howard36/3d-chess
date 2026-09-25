# Error messages

## Summary

Every error text a player can see in 3D Chess comes from one of two places: the server refusing a request, or the browser failing to read something the server sent. This document catalogues all twelve: the exact text, the code the server attaches to it, what causes it, whether the app itself can ever cause it, where it appears, and what else the page does when it arrives. It also lists, in a second table, the texts that are not errors but do the same job of telling the player that something has gone wrong: the frozen-board banner, the crash screen, the connection status lines, and the replaced dialog. Feature documents say which errors they can produce and link here. How the game page's error banner itself behaves (only the latest error, the "✕") is owned by [the error banner](../game-page/error-banner.md).

A refusal changes nothing on the server: no game is created, no seat is taken, no move is recorded. Of the twelve texts, a player using the app at this commit meets three in ordinary use ("Cannot join", "Game full", and "Cannot rejoin"), two only in rare races ("Not your turn" and "Already in a game"), and the other seven practically never: most need a modified client, a stored seat changed outside the app, or a server that does not match this commit, and "Not in a game" needs a game to expire while its page is open.

## Where an error appears

An error is shown on whichever page is open when it arrives, in one of two ways.

**On the start screen**, as red text under the "Start New Game" button: "Error: " followed by the server's message. Only an error that arrives after the player's latest click on the button is shown; anything received earlier, including errors from a game page the player just left, is ignored. The error is taken as the answer to the click, so the button returns from "Creating Game..." to "Start New Game" and works again. The text has no dismiss control. It stays until the next click, which clears it, and it stays through a drop, with "Reconnecting to server…" appearing under it. In practice the start screen never shows an error: the only refusal its request can meet is "Already in a game", which a fresh connection cannot get (see [creating a game](../start/creating-a-game.md#the-answer-arrives)).

**On the game page**, in the [error banner](../glossary.md#the-interface): the red box at the bottom center, "Error: " followed by the server's message, with a "✕" button that dismisses it. It appears on every screen of the game page: the share-link screen, the join screen, the joined screen, and the board screen. Only the latest error is shown; dismissing hides every error so far, and a later error shows again. The banner stays through drops and reconnects. On the board screen it is drawn above the move list, the promotion dialog, and the end-game dialog, and under the replaced dialog. Presses on the banner never reach the board.

In both places the message is the server's own English text, shown verbatim. Neither place shows the code, and neither says which request was refused.

The page does not match an error to the request it answers. Any error that arrives while one of the player's moves is in flight releases the [held](../glossary.md#selection-and-board-state) board, and any error that arrives after a click on "Start New Game" re-enables the button. Beyond showing the error, the game page reacts to exactly two kinds:

- **A failed join.** "Cannot join" or "Game full" while the page is on the joined screen and the game has not started on this page sends the page back to the join screen. See [joining a game](../start/joining-a-game.md).
- **A stale stored seat.** "Cannot rejoin" or "No such seat to rejoin" before any snapshot has arrived on this page and before the game has started on it deletes the game's [stored seat](../foundations/connection-and-seat.md#the-stored-seat), and the page shows the join screen. See [reloading and returning](../session/reload-and-return.md).

> Technical note: Both reactions test the code, not the text, and they look at every error the page has received since it was opened or reset, not only the answer to the latest request. "Cannot join" and "Cannot rejoin" share the code `invalid_game`, so each one counts for both reactions wherever the other conditions hold. The edge cases below describe what the player notices.

Errors are forgotten when the page's connection is [reset](../glossary.md#events-that-end-or-interrupt-a-request) (on arriving at the start screen) and when the page is reloaded. They belong to one tab: other tabs, and the opponent, never see them.

## The interaction, event by event

```mermaid
stateDiagram-v2
    state "No error shown" as clear
    state "Request in flight" as flight
    state "Error shown (latest only)" as shown
    [*] --> clear
    clear --> flight : request sent
    flight --> clear : accepted
    flight --> shown : refused
    shown --> clear : "✕" (game page)
    shown --> flight : "Start New Game" clicked again (start screen, text cleared)
    shown --> shown : another refusal replaces it
    shown --> clear : start screen reached (reset) or reload
```

### Begin

A request that the server can refuse is made: a click on "Start New Game" (create), a click on "Join Game" (join), a game page opening or reconnecting with a stored seat (the automatic [rejoin](../foundations/connection-and-seat.md#rejoining)), or a press on a [legal destination](../glossary.md#moves-and-the-rules) or a pick in the promotion dialog (a move). Which refusals are possible is decided by which request it is; see [the catalogue](#the-catalogue).

### End without sending

A request that never leaves the browser is never refused. A [queued](../glossary.md#requests) create, join, or rejoin that is discarded by leaving the page or reloading, and a [dropped](../glossary.md#requests) move, produce no error and no message of any kind.

### Send

The server checks each message in a fixed order and answers the first check that fails with an error; later checks are not made.

1. Is it JSON text? If not: "Message is not valid JSON".
2. Is it one of the protocol's messages, with the right fields? If not: "Message does not conform to the protocol schema".
3. Is it a request a client may send? If not: "Clients may not send {type} messages".
4. The request's own checks:
   - **Create:** this connection is not yet in a game, or "Already in a game".
   - **Join:** this connection is not yet in a game, or "Already in a game"; the game exists, or "Cannot join"; it has a free seat, or "Game full".
   - **Rejoin:** this connection is not yet in a game, or "Already in a game"; the game exists, or "Cannot rejoin"; the named color is a taken seat, or "No such seat to rejoin".
   - **Move:** this connection holds a seat in a game that exists, or "Not in a game"; both seats are taken, or "Both players must have joined to move"; it is this seat's turn, or "Not your turn".

A refused request leaves the server exactly as it was. A refused join or rejoin does not tie the connection to the game, so the same connection can go on to create, join, or rejoin. No refusal closes the connection.

### While in flight

The page shows whatever it shows for that request, with no hint that it might be refused: "Creating Game..." on the start screen, the joined screen after "Join Game", the share-link screen while a fresh page's rejoin is on its way, and a held board for a move. On an ordinary connection this lasts a fraction of a second.

### The answer arrives

The error is added to what the page has received and shown as described in [where an error appears](#where-an-error-appears). The page then reacts as listed there: the start screen's button works again, a held board is released, a failed join returns to the join screen, and a refused rejoin on a fresh page deletes the stored seat. Nothing else changes: not the position, not the turn, not the connection.

## The catalogue

### Refusals from the server

| Message | Code | Answers | Cause | From the app | Where it shows, and what else happens |
| --- | --- | --- | --- | --- | --- |
| "Message is not valid JSON" | `invalid_message` | Anything | A message that is not JSON text. | Never. The app sends only JSON text. | Wherever the request was sent from. Nothing else happens; the connection stays open. |
| "Message does not conform to the protocol schema" | `invalid_message` | Anything | JSON that is not one of the protocol's messages: an unknown type, a missing or extra field, a cell name outside `Aa1`–`Ee5`, or a promotion letter other than Q, R, B, N, or U. | Never. | As above. |
| "Clients may not send {type} messages" | `invalid_message` | Anything | A well-formed message of a kind only the server sends. {type} is that kind's protocol name, for example "Clients may not send move_made messages". | Never. | As above. |
| "Already in a game" | `already_in_game` | Create, join, rejoin | This connection has already created, joined, or rejoined a game; a connection is tied to at most one game in its life. | Rarely, in three cases. With browser storage disabled, the creator is shown the join screen and may click "Join Game". Pressing Back during a create's round trip, onto an earlier game's page, sends that page's rejoin on a connection already tied to the new game (see [creating a game](../start/creating-a-game.md#edge-cases)). Going Back or Forward from the start screen to a game page before the start screen's fresh connection has opened sends the rejoin twice, and the second is refused (see [reloading and returning](../session/reload-and-return.md#edge-cases)). | Start screen: the red text, and the button works again. Game page after "Join Game": the page stays on the joined screen, "Joined game, waiting for start...", because this refusal does not send it back to the join screen. Game page after a rejoin: only the banner changes, and the stored seat is kept. After a duplicate rejoin the first one has already brought the game, which shows normally; after Back during a create the earlier game's share-link screen stays until a reload. |
| "Cannot join" | `invalid_game` | Join | No game with this id exists: the link was mistyped or changed to lower case, or the game has [expired](../glossary.md#games-and-seats). | Yes, whenever a visitor clicks "Join Game" on such a link. | Game page: the joined screen goes back to the join screen, with the banner. |
| "Game full" | `game_full` | Join | Both seats are taken. Seats are held for the life of the game, so it makes no difference whether their players are connected. | Yes: a third person with the link; a seated player opening the link in another browser, profile, device, or private window, or after clearing site data; the slower of two visitors clicking "Join Game" at the same moment. | As "Cannot join". The page offers no way to watch the game, and a seated player on the wrong browser cannot get their seat back through the app. |
| "Cannot rejoin" | `invalid_game` | Rejoin | No game with this id exists, although this browser holds a stored seat for it: the game has expired. | Yes: opening an expired game's link, bookmark, or history entry. | Game page, over the share-link screen shown while the rejoin was in flight. On a fresh page (no snapshot yet, game not started on this page) the stored seat is deleted and the page shows the join screen; "Join Game" there is then refused with "Cannot join". If a snapshot has already arrived or the game has started on this page, the stored seat is kept and the page stays where it is, on a connection that holds no seat. |
| "No such seat to rejoin" | `invalid_rejoin` | Rejoin | The game exists, but nobody has ever taken the color the stored seat names. | Practically never. The app stores only a color the server assigned, and a seat is never given up, so only a stored seat changed outside the app can cause it. | As "Cannot rejoin", including deleting the stored seat. The join screen that follows works: the named color is free, so "Join Game" takes it. |
| "Not in a game" | `invalid_move` | Move | This connection holds no seat in a game that exists: it never created, joined, or rejoined one, its rejoin was refused, or its game has expired since it took the seat. | Practically never. The board appears only on a connection that holds a seat, and after a reconnect the page rejoins before a move can be made. The one path is a board left on screen after its rejoin was refused with "Cannot rejoin": a game that expired during a very long outage, or while the tab sat replaced. See the edge cases, [connection loss](../session/connection-loss.md#the-answer-arrives), and [a second tab](../session/second-tab.md#the-answer-arrives). | Board screen: the held board is released and the move is not shown. Every later move is refused the same way until the page is reloaded. |
| "Both players must have joined to move" | `game_not_started` | Move | Only one seat of the game is taken. | Never. The board appears only once both seats are taken, and seats are never given up. | As "Not in a game". |
| "Not your turn" | `wrong_turn` | Move | The move record says it is the other seat's turn. | Rarely: a move made in the moment between a reconnect (or "Play here") and its snapshot, when the server's record is ahead of what the page shows and it is the opponent's turn there: the player's previous move was recorded but its echo was lost in the drop, or another tab moved for the player while this one was replaced. See [making a move](../play/making-a-move.md#edge-cases). | Board screen. The snapshot arrives just before the error: it releases the held board, puts the recorded move in place, and passes the turn to the opponent. The refused move is never shown. |

### Reported by the browser

| Message | Code | Cause | From the app | Where it shows, and what else happens |
| --- | --- | --- | --- | --- |
| "Received a malformed message from the server" | `invalid_message`, assigned by the browser | The server sent something that is not JSON. The browser checks nothing else about what it receives. | Never against a server built from the same commit, which sends only JSON. | Wherever the page is: under the start screen's button, which works again, or in the error banner, where it releases a held move like any error. The unreadable message itself is lost, and nothing asks the server for it again. |

### Texts that act like errors

These are not errors and never appear in the error banner, but each tells the player that something is wrong. Each is described in full in the document linked.

| Text | Where and when | What it means | Described in |
| --- | --- | --- | --- |
| "Move {N} in this game's history is not a legal move for this client (likely an app version mismatch). The board is frozen at the position before it." ({N} is the move's place in the record, counting every move from 1) | The frozen-board banner: a red box below the turn indicator on the board screen, with no close button. | The move record holds a move this browser cannot replay. The board shows the position before it and never takes input again. | [The broken game record](broken-game-record.md) |
| "Something went wrong", then "The app hit an unexpected error. Your game lives on the server, so reloading is safe — it will restore the current position.", and a "Back to start" link | The crash screen, replacing the whole page at either address. | The page hit an error it could not handle while drawing itself. Its connection is closed, so the opponent sees "Opponent: offline". | [Screens and navigation](../foundations/screens-and-navigation.md#the-crash-screen) |
| "Reconnecting…" | The amber box at the top right of every game page screen. | The connection dropped and the browser is retrying on its own; the board does not take input. | [Connection loss](../session/connection-loss.md) |
| "Connecting to server…" | The gray line under the start screen's button. | The first connection attempt has not opened yet. A click on "Start New Game" is queued. | [Creating a game](../start/creating-a-game.md) |
| "Reconnecting to server…" | The same gray line. | The connection failed or dropped and is being retried. | [Creating a game](../start/creating-a-game.md) and [connection states](../foundations/connection-and-seat.md#connection-states) |
| "This game is open in another tab", then "Your seat moved to the newer tab or window. Close this one, or take the game back here.", and a "Play here" button | The replaced dialog, over the whole game page. | Another connection took this tab's seat, and this tab has stopped reconnecting. | [A second tab](../session/second-tab.md) |

### Failures with no message

Some things go wrong without any text at all. They are listed here so that this catalogue is complete; each is described where it happens.

- A create whose answer is lost in a drop leaves the start screen at "Creating Game..." until the player reloads. See [creating a game](../start/creating-a-game.md#cancel-and-interrupt).
- A join whose answer is lost in a drop can leave the page on the joined screen. See [joining a game](../start/joining-a-game.md) and [requests while disconnected](../foundations/connection-and-seat.md#requests-while-disconnected).
- A move sent just as the connection drops is either recorded or lost; the next snapshot shows which, with no message. See [connection loss](../session/connection-loss.md).
- An address inside the app other than `/` or `/game/{id}` shows an empty dark page. See [addresses the app does not know](../foundations/screens-and-navigation.md#addresses-the-app-does-not-know).
- A recorded move that is illegal but that this browser can still replay is shown like any other move. See [the broken game record](broken-game-record.md).
- A game's expiry gives no warning in advance. It shows only as "Cannot rejoin" or "Cannot join" the next time someone opens the link.

## Modifiers

"While in flight" here is while the request that will be refused is on its way.

| Modifier | At the start | Changes while in flight |
| --- | --- | --- |
| Your color | No effect on any error or its text. | Cannot change. |
| Whose turn it is | Only "Not your turn" depends on it, and on the server's count of the move record, not on what the page shows. | The server's count can move ahead of the page's only while the page is not connected (a drop, or another tab holding the seat); that is what "Not your turn" reports in practice. |
| How you reached the page | Decides which refusals are possible. The start screen can only create. A visitor's "Join Game" can meet "Cannot join" and "Game full". A player returning with a stored seat sends a rejoin, which can meet "Cannot rejoin". A creator arriving from the start screen sends no rejoin. | Leaving the page before the answer loses it; see "Leaving the game page within the app" below. |
| Connection state | Errors arrive only on an open connection. A queued create, join, or rejoin can be refused as soon as the connection opens. While replaced, the replaced dialog covers the error banner. | A drop loses the answer, refusal or not; no error is shown. |
| Game state | In progress, in check, over, or frozen: errors are shown the same way, the banner above the end-game dialog. No error exists for a move after the game is over or for an illegal move. | Not applicable: a refused request changes nothing, so it cannot change the game state. |
| Shift, Ctrl, or Cmd held | No effect. | No effect. |
| Input device | The "✕" can be clicked, tapped, or reached with Tab and pressed with Enter or Space. The start screen's red text has no control. | No effect. |

## Cancel and interrupt

"Before sending" is while an error is on screen and nothing is in flight; "while in flight" is while a request that the server will refuse is on its way.

| Event | Before sending | While in flight |
| --- | --- | --- |
| Escape or Cancel | Escape does not dismiss an error. Only the "✕" does, on the game page; the start screen's text stays until the next click. | No effect. A request cannot be cancelled, and its refusal arrives regardless. |
| Pressing elsewhere or turning the view | Presses on the board and turning the view leave the error in place. Presses on the banner itself never reach the board. Clicking around the start screen does nothing. | No effect on the refusal. |
| Leaving the game page within the app | Every error is forgotten: the start screen resets the connection and shows only answers to its own click, and a game page reached afterwards starts with no error, apart from one the start screen itself received (see the edge cases). | The answer is lost with the reset and never shown anywhere. The refused request changed nothing on the server, so nothing is lost with it. |
| The game ends | The banner stays above the end-game dialog and can still be dismissed. | Not applicable: a refused move changes nothing, so it cannot end the game. |
| The server answers with an error | A new error replaces the one shown, and shows even if every earlier error was dismissed. | This document's subject. |
| The connection drops | The error stays on screen through the drop and the reconnect; "Reconnecting…" (game page) or "Reconnecting to server…" (start screen) appears beside it. A rejoin after the reconnect can bring a new error. | The answer is lost. For a move or a rejoin, the next snapshot shows the true state; for a create or a join, the page can be left waiting (see [failures with no message](#failures-with-no-message)). |
| The window loses focus or the tab is hidden | No effect; the error stays. | The error arrives and is shown in the background. Nothing draws attention to it: the page title never changes. |
| Reload or closing the tab | Every error is forgotten. A reload rebuilds the page from the server, and only new refusals are shown. | The answer is lost. Nothing was recorded, because the request was refused. |
| The opponent acts | Nothing the opponent does produces or clears an error. If the opponent joins while an error is showing, the page moves to the board screen with the error still in the banner. | No effect, except the race for the last seat: a visitor who clicks "Join Game" a moment after another gets "Game full". |
| Another tab takes the seat | The replaced dialog covers the banner. After "Play here" the same error is still there, unless it was dismissed. The other tab has its own errors, if any. | The refusal is sent to the connection that made the request. If that connection was closed by the replacement first, the refusal is lost. |
| A second touch point or a cancelled touch | No effect. A cancelled touch on the "✕" does not dismiss. | No effect. |

## Interactions with other systems

**Seat and turn.** Three errors are about seats ("Already in a game", "Game full", "No such seat to rejoin") and one about the turn ("Not your turn"). A refusal never gives, takes, or moves a seat, and never changes whose turn it is.

**The game record.** Nothing refused is recorded. There is no error for an illegal move or for a move after the game has ended, because the server checks neither; see [the broken game record](broken-game-record.md).

**Connection.** An error arrives on the connection that sent the request and never closes it. Errors stay on the page through drops and reconnects, because the page keeps everything it received across them, and are forgotten when the connection is reset on the start screen or the page reloads. A drop while a request is in flight loses its answer, whatever the answer was.

**The opponent.** Errors go only to the player whose request was refused. The opponent never sees them, and the player never sees the opponent's.

**Other tabs and devices.** Each tab has its own errors. A seated player who opens the game on another browser or device is a visitor there, and "Join Game" is refused with "Game full". A second tab of the same browser is not refused: it rejoins and takes the seat, which the first tab shows with the replaced dialog, not an error.

**Game over.** No error concerns the end of the game; the server does not know about it. The error banner is drawn above the end-game dialog and can be dismissed there.

**Stored seat.** "Cannot rejoin" and "No such seat to rejoin" delete it, under the conditions in [where an error appears](#where-an-error-appears). No other error touches it; "Already in a game" on a rejoin leaves it in place.

**Keyboard, touch, and screen size.** The "✕" is a button, labeled "Dismiss error" for screen readers, reached with Tab and pressed with Enter or Space; a tap works like a click. Both the banner and the start screen's red text are marked as alerts, so screen readers announce them as they appear; see [accessibility](accessibility.md). The banner is placed from the window's center line, so it is at most about half the window wide and a long message wraps on a narrow window; it sits at the same height as the move list and can overlap it there. See [screen sizes and touch](screen-sizes-and-touch.md).

## Edge cases

- **Errors are not matched to requests.** Any error releases a held move and any error re-enables the start screen's button, whatever request it answers. With the app, only one request is in flight at a time, apart from a rejoin and a move in the moment after a reconnect, so this rarely shows.
- **A second "Join Game" after a refusal.** After "Cannot join" or "Game full", clicking "Join Game" again sends a new join, but the page goes straight back to the join screen before the answer, because the earlier refusal still counts as a failed join. The new refusal then appears in the banner, even if the first was dismissed. If the join were to succeed, the page would move on when the [seat confirmation](../glossary.md#requests) arrived.
- **"Join Game" after "Cannot rejoin".** On a page whose stale stored seat was just deleted, the first click on "Join Game" behaves the same way, because "Cannot rejoin" and "Cannot join" share a code. The joined screen does not stay up, and the banner changes to "Error: Cannot join" when the answer arrives.
- **An error carried from the start screen.** The game page shows every error received since the connection was last reset, and going from the start screen to a new game does not reset it. An error the start screen showed before a later, successful "Start New Game" would therefore appear again in the new game's error banner, or in an earlier game's page reached with Forward. The start screen practically never receives an error from a matching server, so this is read from code only.
- **A board left open on an expired game.** If a rejoin is refused with "Cannot rejoin" after the game has started on the page (a reconnect after a very long outage, or "Play here" in a tab that sat replaced, to a game that expired meanwhile), the stored seat is kept, the page stays on the board screen, and the board takes input again once the connection is open. The connection now holds no seat, so every move is refused with "Not in a game", and every later reconnect (at least once an hour) is refused with "Cannot rejoin" again, reappearing after a dismissal. A reload ends it: the page then deletes the stored seat and shows the join screen. Whether a game can expire while a page keeps reconnecting to it is not known; see the open questions.
- **The same refusal twice.** A second refusal with the text already showing changes nothing visible, so it looks like no answer at all. See [the error banner](../game-page/error-banner.md#edge-cases).
- **"Already in a game" and the joined screen.** Unlike "Cannot join" and "Game full", this refusal leaves the page on "Joined game, waiting for start..." with the banner. In the storage-disabled case the board still appears when the opponent joins, since the connection already holds the creator's seat, and the banner comes along to the board screen until dismissed.
- **An error from the joined or share-link screen on the board screen.** The banner is the same on every screen of the game page, so an error shown before the game starts is still there when the board appears.
- **The replaced dialog's wording.** It says the seat moved to "the newer tab or window", but it appears whenever any connection rejoins the seat, including one from another device. See [the broken game record](broken-game-record.md#seats).
- **A malformed answer to a create.** If the unreadable message was in fact the new game's id, the game exists on the server, tied to the connection, and a second click on "Start New Game" is refused with "Already in a game". Read from code; it needs a server that sends something other than JSON.

## Open questions and verification

- **Cryptic messages.** Several texts do not tell the player what happened or what to do next:
  - "Cannot rejoin" is what a player sees when their game has expired. It does not mention expiry, and the page then offers "Join Game", which can only fail with "Cannot join".
  - "Cannot join" does not say whether the id is wrong, in the wrong case, or expired.
  - "Game full" is what a seated player sees on another browser, device, or after clearing site data. It does not explain that their seat is held by a browser they are not using, and the app offers no way back.
  - "No such seat to rejoin" and "Already in a game" describe the protocol, not anything the player did.
  - "Not your turn" after a reconnect reads like a mistake by the player, when in fact their previous move was recorded and the page had not yet caught up.
  - "Clients may not send {type} messages" shows internal message names. Only a modified client can see it.
  - The frozen-board banner's "(likely an app version mismatch)" suggests a fix, but reloading does not help; see [the broken game record](broken-game-record.md#open-questions-and-verification).
- **Suspected bug: the failed-join reaction looks at the whole log.** `client/src/screens/GameScreen.tsx:116-124` returns the page to the join screen if any earlier error was `invalid_game` or `game_full`, not only the answer to the latest join. A second "Join Game" therefore bounces back before its answer, and a "Cannot rejoin" makes the first "Join Game" bounce too. Harmless while those joins also fail, but a successful join after such a refusal would briefly show the join screen instead of the joined screen.
- **Suspected bug: errors carried across from the start screen.** `client/src/screens/GameScreen.tsx:61` and `:113` show errors from the whole log since the last reset, while the start screen shows only answers to its own click. Unreachable with the app and a matching server, as far as the code shows.
- **Suspected bug, described elsewhere: a duplicate rejoin.** Returning to a game page before the start screen's fresh connection has opened makes the page send two rejoins, and "Error: Already in a game" appears over a game that is otherwise fine. See [reloading and returning](../session/reload-and-return.md#open-questions-and-verification).
- **A board left open on an expired game.** The "Not in a game" path in the edge cases depends on whether reading a game (a rejoin) counts as activity for expiry, which the repository does not state (see [the connection model](../foundations/connection-and-seat.md#open-questions-and-verification)).
- **The banner and the move list** share the bottom edge of the window; whether a long message overlaps the move list on a phone was not checked.
- **Read, not observed.** The server texts are quoted from `server/modal_app.py`, and the codes from `server/schema.json`. `server/tests/test_local_ws.py` asserts the code of every refusal but the text of only one ("Both players must have joined to move", in the logging test). The start screen's error handling, the join fallback, the stale-seat deletion, the release of a held move on "Not your turn", and the frozen banner are covered by `client/src/App.test.tsx`; the malformed-message error by `client/src/hooks/useGameSocket.test.ts`; the crash screen by `client/src/components/ErrorBoundary.test.tsx`. None of the error texts was seen in a running product for this document. "Not your turn" and "Already in a game" depend on races that were not reproduced.

Verified against 3D Chess commit `d94507b`
