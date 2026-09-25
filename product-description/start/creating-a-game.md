# Creating a game

## Summary

Creating a game turns one click on the start screen into a new game on the server, with this browser holding one of its two seats, and takes the player to that game's page to wait for an opponent. It lives on the [start screen](../glossary.md#the-product-and-its-screens) at `/`, the page every visit to the app's root address shows, and it is the only way a game comes into existence. The "Start New Game" button is the whole feature: there are no options, no name to enter, and no choice of color. The button works in every [connection state](../glossary.md#the-connection) the start screen can be in; a click made before the connection is open waits for it.

## The simple case

The player opens the app's address. The start screen shows the title "3D Chess" and a white "Start New Game" button in the middle of a dark page. For a moment a gray line under the button says "Connecting to server…"; it disappears once the connection is open.

The player clicks "Start New Game". The button turns pale, stops responding, and reads "Creating Game...". Almost at once the address changes to `/game/{id}`, where `{id}` is the new [game id](../glossary.md#games-and-seats), and the page shows the [share-link screen](../start/waiting-for-an-opponent.md): "Game created! Share this link with a friend:" and the link.

The player now holds one seat of the new game, white or black, chosen at random by the server. The page does not say which until an opponent joins and the board appears. The browser remembers the seat as the game's [stored seat](../foundations/connection-and-seat.md#the-stored-seat), so the player can close the tab and come back through the link.

## The interaction, event by event

```mermaid
stateDiagram-v2
    state "Start New Game" as ready
    state "Creating Game... (queued)" as queued
    state "Creating Game... (in flight)" as creating
    state "Share-link screen" as share
    state "Creating Game... (stuck)" as stuck
    [*] --> ready : start screen loads
    ready --> queued : click while not connected
    queued --> creating : connection opens (request sent)
    ready --> creating : click while connected (request sent)
    creating --> share : game id arrives (seat stored, page changes)
    creating --> ready : error (message shown under the button)
    creating --> stuck : connection drops (answer lost)
    stuck --> [*] : reload
```

### Begin

The start screen loads with the button enabled and nothing focused. The app opens its [connection](../foundations/connection-and-seat.md#connection-states) as it loads; until the connection is open, the gray status line reads "Connecting to server…", or "Reconnecting to server…" after the first failed attempt. The button does not wait for the connection: it is enabled from the first moment.

If the player arrived from a game (the [end-game dialog](../play/check-and-game-end.md)'s "Start new game", browser Back, or the crash screen's "Back to start"), the connection is [reset](../glossary.md#events-that-end-or-interrupt-a-request) as the start screen appears, and anything the server said about the old game is ignored from then on. Nothing on the start screen refers to earlier games: it does not list them and cannot resume one, even when the browser has stored seats for several.

The click is the whole of the begin phase. At that instant the start screen marks where its answer will start: only messages that arrive after the click count as the reply. An error still visible from an earlier attempt disappears at the same moment.

### End without sending

There is no way to end the request without sending it. The one exception is timing: a click made while the connection is not open is [queued](../glossary.md#requests), not sent. The button reads "Creating Game..." and is disabled exactly as if the request were in flight, and the status line goes on showing the connection state. Leaving the page (Back, reload, closing the tab) at this point discards the queued request; nothing reaches the server and nothing is recorded.

A player who opens the start screen and never clicks leaves no trace: no game is created and nothing is stored in the browser.

### Send

The request leaves the browser the instant the button is clicked on an open connection, or the instant the connection opens for a queued click. From here it cannot be taken back. The server, on receiving it:

- picks a new game id that no existing game uses;
- picks white or black at random for the creator;
- records the game with that one seat taken and an empty [move record](../glossary.md#games-and-seats);
- ties this connection to the game and seat, so that everything else sent on the connection is on the creator's behalf;
- answers with the game id and the creator's color.

The game exists from this moment whether or not the answer ever reaches the player.

### While in flight

The button stays pale, disabled, and labeled "Creating Game...". A second click does nothing, so a double click creates one game, not two. The status line, if the connection is not open, stays visible beside it. Nothing else on the page changes and nothing else can be done on it; the player can only wait or leave. On an ordinary connection this lasts a fraction of a second.

### The answer arrives

On success, two things happen in order: the browser writes the stored seat for the new game (key: the game id, value: the color), and then the page moves to `/game/{id}` as a new entry in the browser's history. The game page recognizes that this connection already holds the seat, so it does not rejoin; it shows the share-link screen straight away. What happens from there is described in [waiting for an opponent](waiting-for-an-opponent.md).

On an error, the start screen shows it in red under the button as "Error: " followed by the server's message, and the button returns to "Start New Game", enabled. Clicking again sends a fresh request and clears the message. The only error the server can give a correct client here is "Already in a game", which cannot happen in practice because the connection is always fresh on the start screen; the client itself reports "Received a malformed message from the server" if the answer cannot be read. Both are listed in [error messages](../cross-cutting/error-messages.md).

## Modifiers

| Modifier | At the start | Changes while in flight |
| --- | --- | --- |
| Your color | Not decided yet. The server picks it at random when it creates the game, and the start screen never shows it. | No effect. |
| Whose turn it is | No game yet. No effect. | No effect. |
| How you reached the page | The start screen looks and behaves the same whether the address was typed, opened from a bookmark, or reached from a game. Arriving from a game resets the connection first and ignores the old game's messages. | Leaving the start screen while in flight: see "Leaving the game page within the app" below. |
| Connection state | Connected: the request is sent on the click. Connecting or reconnecting: the click is queued and sent when the connection opens. Replaced cannot occur here: reaching the start screen resets the connection. | A drop while in flight loses the answer and leaves the screen stuck; see "The connection drops" below. |
| Game state | No game yet. No effect. | No effect. |
| Shift, Ctrl, or Cmd held | No effect. The button is a button, not a link, so Ctrl-click or Cmd-click does not open a new tab. | No effect. |
| Input device | A mouse click, a tap, and Enter or Space on the focused button all do the same thing. The button is reached by Tab; nothing is focused on arrival. | No effect; the button ignores input while in flight. |

Nothing the player can change mid-way alters the request: the color is the server's choice, and the request carries no options.

## Cancel and interrupt

| Event | Before sending | While in flight |
| --- | --- | --- |
| Escape or Cancel | No effect. There is no Cancel control and Escape is ignored. | No effect. The request cannot be cancelled; the button stays disabled until the answer. |
| Pressing elsewhere or turning the view | There is no board on this screen. Clicking the page around the button does nothing. | Same. |
| Leaving the game page within the app | Back or Forward leaves the start screen. A queued request is discarded; nothing was sent or recorded. | Back or Forward leaves the start screen before the answer. The answer, when it comes, is ignored: no seat is stored and the page does not move. The game still exists on the server, tied to this tab's connection. See the edge cases. |
| The game ends | Not applicable: no game yet. | Not applicable. |
| The server answers with an error | Not applicable: nothing sent yet. | "Error: {message}" in red under the button; the button returns to "Start New Game" and works again. |
| The connection drops | The status line appears ("Reconnecting to server…"). The button still works, and a click is queued. | The answer is lost. If the request reached the server, the game exists with the creator's seat taken; if not, nothing happened. Either way, when the connection comes back the button still reads "Creating Game..." and stays disabled, and nothing re-sends the request. The screen is stuck until the player reloads. This looks like a bug; see open questions. |
| The window loses focus or the tab is hidden | No effect. The connection stays open in a background tab. | No effect. The answer is handled when it arrives, and the page moves to the game even in a background tab. |
| Reload or closing the tab | Nothing is recorded; a queued request is discarded. After a reload the start screen is fresh. | The answer is lost. If the server received the request, a game exists with one seat taken whose id no browser knows; it is deleted after about 30 days. |
| The opponent acts | No opponent yet. | No opponent yet. |
| Another tab takes the seat | Not applicable. Each tab has its own connection and creates its own games; start screens in other tabs are unaffected. | Not applicable. |
| A second touch point or a cancelled touch | A touch that is cancelled before it lifts does not click the button. | No effect. |

After any interrupt the player stays on the start screen, except when the page itself went away. Nothing is saved in the browser until a successful answer, so an interrupted create never leaves a stored seat behind.

## Interactions with other systems

**Seat and turn.** The creator gets one seat at random and learns which only when the board appears. White always moves first, so a creator who got black starts by waiting for the joiner's move.

**The game record.** The server records the game with one seat taken and no moves. A game has no name, no settings, and no time limit; there is nothing else to record.

**Connection.** The request travels on the app's single connection. After a successful create, the server treats that connection as the creator's seat in the new game until it closes. A later connection (after a drop or a reload) has to [rejoin](../foundations/connection-and-seat.md#rejoining), which the game page does by itself.

**The opponent.** There is none yet. The game waits for someone to open the share link and click "Join Game"; see [joining a game](joining-a-game.md).

**Other tabs and devices.** Start screens in several tabs create separate games. The stored seat, however, is shared by every tab of the same browser: opening the new game's share link in another tab of the same browser rejoins as the creator and takes the seat from the first tab (see [a second tab](../session/second-tab.md)) instead of joining as the opponent. To play both sides on one computer, open the link in a different browser or a private window.

**Game over.** Not applicable.

**Stored seat.** Written the moment the answer arrives, before the page changes, so that even a tab closed right after the page changes can come back through the link. If the browser refuses to store it (storage disabled), the write fails silently; see the edge cases.

**Keyboard, touch, and screen size.** The button can be reached with Tab and pressed with Enter or Space; it shows a blue focus ring. A tap works like a click. The screen is a single centered column and fits any window width; see [screen sizes and touch](../cross-cutting/screen-sizes-and-touch.md).

## Edge cases

- **Coming back from a finished game.** "Start new game" in the end-game dialog lands on the start screen while the old game's messages are still in memory for a moment. The start screen ignores everything that arrived before its own click, so it does not mistake the old game for a new answer and bounce the player back into it.
- **A stale error.** An error that arrived before the click (for example from the previous page) is never shown on the start screen. An error from the previous attempt is cleared by the next click.
- **Every click is a new game.** There is no "resume" and no list of games, even when the browser holds stored seats. A player who wants an earlier game needs its link.
- **Game id collisions.** The server never reuses an id that is still stored; it draws again until the id is free.
- **Storage disabled.** When the browser will not store the seat, the create still succeeds and the page still moves to the game, but the game page, which reads the stored seat, finds none and shows the creator the [join screen](joining-a-game.md) instead of the share link. Clicking "Join Game" there shows "Joined game, waiting for start..." with "Error: Already in a game", because the connection already holds the creator's seat; the board still appears when the opponent joins, since the connection is the creator's. This looks like a bug; see open questions.
- **Back within the round trip.** If the player presses Back in the fraction of a second between the click and the answer, and Back leads to an earlier game's page, that page opens on a connection the server has just tied to the new game. Its automatic rejoin is refused with "Error: Already in a game", and it shows the earlier game's share-link screen until reloaded. The new game is created but its id is never shown.
- **A malformed answer.** A reply the browser cannot read shows "Error: Received a malformed message from the server" and re-enables the button, like any error.
- **The page title** stays "3D Chess — Online Multiplayer" throughout.

## Open questions and verification

- A drop while the request is in flight leaves the button at "Creating Game..." forever, even after the connection returns, and may leave an orphaned game on the server. Nothing retries the request or re-enables the button. This may be worth treating as a bug rather than documenting.
- With browser storage disabled, the creator lands on the join screen instead of the share-link screen, and a later drop or reload loses the seat. Read from code (the game page reads the seat only from storage and does not count the creation answer as an assigned seat); not confirmed in a browser with storage disabled.
- The Back-within-the-round-trip case is read from code; it depends on a race of a few tens of milliseconds and was not reproduced.
- How long "Connecting to server…" lasts on a cold server (the first connection after the server has been idle or redeployed) is a property of the deployment and was not measured.
- Everything else was read from `client/src/screens/StartScreen.tsx`, `client/src/hooks/useGameSocket.ts`, `server/modal_app.py`, `client/src/App.test.tsx`, and `client/e2e/createGame.spec.ts` / `gameOver.spec.ts`; the simple case is exercised by the end-to-end suite.

Verified against 3D Chess commit `d94507b`
