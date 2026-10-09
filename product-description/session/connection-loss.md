# Connection loss

## Summary

Connection loss is what the player experiences when the tab's [connection](../glossary.md#the-connection) to the server closes without the player asking, and how the page recovers by itself. Every cause looks the same on screen: the page shows "Reconnecting…" (on the side choice, "Reconnecting to server…" at its bottom once the wait has lasted 1.5 seconds; on the home page and in the tutorial, nothing), the board stops taking input, everything else stays as it was, and the browser retries on its own, forever. When a retry succeeds, a page with a [stored seat](../foundations/connection-and-seat.md#the-stored-seat) sends a [rejoin](../glossary.md#the-connection), and the server's [snapshot](../glossary.md#requests) brings the page up to date, including anything the opponent did meanwhile; the board takes input again only once the snapshot has arrived. The rejoin does not [take over](../glossary.md#the-connection) the seat: if the player has moved to another tab of this browser in the meantime, the page shows the replaced dialog instead of taking the seat back. A create or join whose answer was lost is [re-sent](../glossary.md#requests). The request narrated here is that automatic reconnect-and-rejoin: it begins with the drop, is sent when a retry succeeds, and is answered by the snapshot. It happens on every page that uses the connection, and the player takes no part in it. A game against the computer never uses the connection, so a drop changes nothing there. The model underneath (connection states, the [retry schedule](../foundations/connection-and-seat.md#connection-states), what is queued or dropped, rejoining, presence) is owned by [the connection and seat model](../foundations/connection-and-seat.md); this document describes what the player sees of it.

## The simple case

White has just played and is waiting for Black; the turn pill lights Black's half, "Their move". White's Wi-Fi drops. A "Reconnecting…" line with a small breathing light appears under the turn pill, and the pill dims behind it. Nothing else changes: the pieces and the pill stay exactly as they were. Presses on the board do nothing, though the view still turns.

On Black's screen, once the server notices that White's connection is gone, White's stone on the turn pill becomes an outline and White's half reads "Offline". Black plays a move anyway. The server records it and sends the echo to Black alone.

A few seconds later White's network comes back. At the next attempt the reconnecting line disappears, and a moment after that Black's move glides in on White's board: the last-move line moves to it, and the light on the pill passes to White's half, "Your move". From that moment White's board takes input again. On Black's pill, White's stone is solid again and "Offline" gives way to "Their move". White never clicked anything, and nothing was lost.

## The interaction, event by event

```mermaid
stateDiagram-v2
    state "Connected" as connected
    state "Reconnecting… (retrying)" as retrying
    state "Rejoin in flight (old position, board takes no input)" as rejoining
    state "Replaced dialog (seat in use)" as inuse
    state "Rejoin refused (error shown)" as refused
    state "Create or join re-sent" as resent
    [*] --> connected
    connected --> retrying : drop
    retrying --> retrying : attempt fails (next after 0.5 s, 1 s, 2 s, 4 s, then every 8 s)
    retrying --> connected : attempt succeeds, nothing to rejoin or re-send (home page, side choice before a pick, invitation to the free seat)
    retrying --> resent : attempt succeeds, a create or join was unanswered
    resent --> connected : answer arrives (new game, or seat)
    retrying --> rejoining : attempt succeeds, stored seat (rejoin sent)
    rejoining --> retrying : drops again before the snapshot
    rejoining --> connected : snapshot arrives (record replaced, board takes input)
    rejoining --> inuse : another tab of this browser holds the seat
    rejoining --> refused : rejoin refused (game gone)
```

### Begin

The request begins with the drop: the connection closes and the player did not close it. The causes are the network going away or changing, a laptop going to sleep, the server restarting or being redeployed, the [one-hour limit](../glossary.md#the-connection), and a fault on the server, which closes the connection with an internal-error code. The player cannot tell these apart, and neither can the page: all of them are handled identically.

One kind of close is not a drop. When another tab or window of the same browser takes the seat, the server closes this connection as [replaced](../glossary.md#events-that-end-or-interrupt-a-request); the page shows the replaced dialog and does not retry. That is described in [a second tab](second-tab.md). Leaving a game's page, or arriving at the home page, also closes the connection, on purpose; that is a [reset](../foundations/connection-and-seat.md#leaving-a-games-page), not a drop.

At the instant of the drop:

- the connection state becomes *reconnecting*, and the first attempt is scheduled for half a second later;
- anything the server was sending at that moment (an echo, a snapshot, an answer to a create or join) is lost, and the server never sends it again;
- nothing the page had already sent is sent again yet; a create or join whose answer has not arrived will be re-sent when a connection opens;
- [the board stops taking input](../foundations/input-model.md#when-the-board-takes-input): a selection is cleared with its markers, an open [promotion dialog](../play/promotion.md) closes without sending and does not come back, and the move box sends nothing;
- a board that was [held](../glossary.md#selection-and-board-state) for a move in flight stays unable to take input, now for both reasons;
- the [game menu](../play/resigning-and-draws.md)'s flag, and an opponent's offer's "Accept" and "Decline", are greyed out, and an open menu closes; a resignation, offer, or answer still waiting to be sent is dropped, like a move.

Nothing else on the page changes. The position, the turn pill (dimmed behind the reconnecting line), and the [move list](../game-page/move-list.md) that screen readers read keep their last values. What the pill says about the opponent's presence may now be wrong, since nothing can update it until the page rejoins. An error in the [error banner](../game-page/error-banner.md) stays and can still be dismissed; the [frozen-board banner](../cross-cutting/broken-game-record.md) and the [result card](../play/check-and-game-end.md) stay too. While the result card is up, the board and the whole HUD behind it, "Reconnecting…" included, are out of reach but still visible under its veil. The view can be turned as usual when no dialog covers it.

What the player sees depends on the screen:

| Screen | During the drop | When an attempt succeeds |
| --- | --- | --- |
| Home page, tutorial | Nothing. Neither uses the connection. | Nothing. |
| Side choice | Nothing at first; "Reconnecting to server…" at the bottom once the wait has lasted 1.5 seconds. A pick still works: it is [queued](../glossary.md#requests), and plays out on the glass as usual. | A queued pick is sent; a pick whose answer was lost is sent again, and its answer takes the player to the new game; see [creating a game](../start/creating-a-game.md#cancel-and-interrupt). There is no seat, so no rejoin. |
| Invitation to the free seat | The "Reconnecting…" line at the top right. "Join game" still works; a click is queued and the page shows "Joining…" at once. Before the look has been answered, "Reconnecting to server…" at the bottom after 1.5 seconds. | The line disappears. A queued join or an unanswered look is sent. Nothing else: a visitor has nothing to rejoin. |
| Invitation to send | The "Reconnecting…" line at the top right, with the heading and the card ("Invite a friend", the link, "Copy link") unchanged. The link stays valid; the opponent can open it and join meanwhile. | The page rejoins. The snapshot keeps the invitation, or, if the opponent joined meanwhile, the arrival plays and the board screen follows. |
| "Joining…" | The "Reconnecting…" line at the top right, with "Joining…" unchanged. | If the server had confirmed the seat before the drop, the page rejoins and the arrival plays. If the join was still in flight, the page sends the join again; the server hands back the seat it had already claimed for this tab (or claims it now, if the first join never arrived). See [joining a game](../start/joining-a-game.md). |
| "Returning to your game…" | The "Reconnecting…" line at the top right. | The page rejoins; see [reloading and returning](reload-and-return.md). |
| Board screen | The "Reconnecting…" line under the turn pill, which dims; the board does not take input; everything else as it was. | The line disappears; the page rejoins; the board takes input again when the snapshot has brought the position up to date. |

From here the browser retries on the [retry schedule](../foundations/connection-and-seat.md#connection-states): 0.5 s, 1 s, 2 s, 4 s, then 8 s between attempts, for as long as it takes. Each failed attempt looks like nothing at all; the banner simply stays. There is no attempt limit, no message saying the server seems to be down, and no button to retry sooner. Once the outage has lasted about seven and a half seconds, attempts come 8 s apart, so the page can take up to 8 s to notice that the network or the server is back.

On the server, the drop changes nothing that lasts: the seat stays taken and the [move record](../glossary.md#games-and-seats) is untouched. When the server notices that the connection is gone, it tells the opponent, whose turn pill then shows the player's stone as an outline with "Offline". The opponent can go on playing; see [the opponent acts](#cancel-and-interrupt) below.

### End without sending

The recovery cannot be cancelled: there is no control for it and Escape does nothing. It ends without a rejoin in these cases:

- **There is no seat to rejoin with.** On the home page, the side choice, the invitation to the free seat, and a "Joining…" page whose join answer was lost, a successful attempt simply opens the connection. The reconnecting line (or the side choice's bottom line) disappears, and nothing is sent except a queued pick or join, or a pick or join re-sent because its answer was lost.
- **The player leaves.** Leaving the game's page ("Play again", "How to play", "← Home", browser Back) resets the connection: the retry loop is abandoned and a fresh connection is attempted at once, which the next page mentions only if it is a side choice kept waiting 1.5 seconds ("Connecting to server…", then "Reconnecting to server…" if the network is still down). Reload, closing the tab, or typing another address ends the loop with the page; see [reloading and returning](reload-and-return.md).

In every case nothing is recorded by the rejoin that was not sent. The drop itself records nothing on the server, and the stored seat is kept, so opening the game's link later rejoins as usual.

### Send

The request is sent when an attempt succeeds. At that instant:

- the connection state becomes *connected*, and the reconnecting line (or the side choice's bottom line) disappears;
- the retry schedule starts over, so a later drop begins again at half a second;
- any create or join that was queued during the drop is sent, in order;
- a create or join that had been sent before the drop and never answered is sent again;
- a move that was still waiting to be sent is [dropped](../glossary.md#requests); this can only be a move made in the instant the connection was closing, and the board never showed it;
- a held board is no longer held, but it still does not take input: it waits for the snapshot, which says whether the move it was waiting for was recorded.

Immediately after, the page sends one rejoin naming the game, the stored seat's color, and this tab's [client id](../glossary.md#requests), provided the page has a stored seat and nothing on this connection has given it a seat yet. On a fresh connection nothing has, so every successful attempt on a game page with a stored seat sends exactly one rejoin; see [rejoining](../foundations/connection-and-seat.md#rejoining). This rejoin does not take over the seat, because the page has already held it. (A page that has never had a rejoin answered, such as one whose first answer after loading was lost to this drop, still takes over; see [reloading and returning](reload-and-return.md#send).)

The server, on receiving it, checks that the game exists and that the color holds a seat. Then it looks at who holds the seat now:

- **Nobody.** The usual case once the server has noticed the drop. The server ties this connection to the seat.
- **This tab's own old connection**, which the server has not yet noticed is dead. The server recognizes the client id, gives the seat to the new connection, and closes the old one as replaced, which reaches nobody, since the page abandoned it at the drop.
- **Another tab's live connection**, because the player opened the game in another tab of this browser during the drop, or clicked "Play here" there. The server refuses with [seat in use](../glossary.md#the-connection), leaves the other tab's connection alone, and this tab shows the replaced dialog; see [the answer arrives](#the-answer-arrives).

In the first two cases it answers with the snapshot, then tells this player whether the opponent is connected and tells the opponent that this player is online.

What happened to each request that was under way at the drop:

- **A move in flight** may or may not have been recorded. The snapshot shows which.
- **A move not yet sent** is dropped, as above.
- **A create or join in flight** is sent again, and the answer arrives as if nothing had happened: a new game for a create, this tab's seat for a join.
- **A queued create, join, or rejoin** is sent now.
- **A rejoin in flight** from an earlier attempt is replaced by this connection's own rejoin.

### While in flight

From sending the rejoin until the snapshot arrives, the page still shows everything as it was before the drop, and the reconnecting line is already gone. Nothing on screen says that the page is still catching up. This lasts one round trip to the server, normally a fraction of a second.

On the board screen, the board does not take input during this moment. Presses on pieces and cells do nothing, nothing can be selected, the promotion dialog cannot open, and the move box sends nothing. The view can be turned. The position on screen may be up to two moves behind the server's (the player's own move, recorded but not echoed, and the opponent's reply), and nothing can be played against it.

On the lobby's screens there is nothing to press but "← Home" (and "Copy link" on the invitation to send), which do not touch the rejoin.

If the new connection drops again before the snapshot arrives, the page is back in *reconnecting*, and the next successful attempt sends a fresh rejoin.

### The answer arrives

**The snapshot.** It replaces everything the page knew about the move record, so a move is never counted twice, and the board takes input again. What changes on screen depends on what happened during the drop:

- **Nothing new.** The position is redrawn identical, and nothing moves. The move list is unchanged.
- **New moves.** The position jumps to the latest one. The last move [glides](../foundations/the-view.md#motion) in, with any captured piece knocked over, because this board has not shown it; earlier moves missed during the drop are simply in place. The last-move line moves to the last move, the move list gains the new moves, the turn pill updates, a King in check turns red, and if the game ended meanwhile the end plays out and the result card follows.
- **The player's own move from before the drop.** If the server recorded it, it appears now: it glides in and it is the opponent's turn, or, if the opponent has already answered it, the answer glides and the player's own move is simply in place. If the server did not record it, the position is unchanged and it is still the player's turn; the player moves again.
- **Before the game started.** On the invitation to send, the snapshot says whether the opponent has joined. If not, the screen stays. If so, the arrival plays over the lobby and the board screen follows, with the position drawn as it is, without any glide, even if the opponent has already moved.

Right after the snapshot, the server's presence message arrives and the turn pill shows the opponent's presence truthfully again: nothing while they are online, "Offline" while they are not. On the opponent's screen, "Offline" goes at the same moment. An error that was showing before the drop is still showing; the snapshot neither clears nor adds errors.

**Seat in use.** If another tab of this browser holds the seat, no snapshot comes. The page shows the [replaced dialog](second-tab.md), "This game is open in another tab", with "Play here" focused, over the position it had before the drop; nothing appears in the error banner. The connection stays open but holds no seat, and the board does not take input. The other tab keeps playing, and the opponent notices nothing. If this connection drops in turn, the dialog gives way to "Reconnecting…" until the next connection is answered, and comes back if the other tab still holds the seat. "Play here" takes the seat back; see [a second tab](second-tab.md).

**A refusal.** The server refuses a rejoin only if the game no longer exists ("Cannot rejoin") or the seat was never taken ("No such seat to rejoin"). A drop causes neither; after a drop, a refusal means the game has vanished from the server, for example by [expiry](../glossary.md#games-and-seats). The error banner shows it. After a mid-game drop the page has already had a snapshot or seen the game start, so the stored seat is kept and the page stays where it was; but the connection now holds no seat, so the board goes on not taking input, and the move box stays disabled, until the page is reloaded. The messages are listed in [error messages](../cross-cutting/error-messages.md).

## Modifiers

"At the start" is the moment of the drop; "changes while in flight" covers anything that changes while the page is reconnecting or its rejoin is in flight.

| Modifier | At the start | Changes while in flight |
| --- | --- | --- |
| Your color | No effect. The rejoin names the stored seat's color; nothing about the drop depends on it. | Cannot change. |
| Whose turn it is | On the player's turn, a selection or promotion dialog is lost and a move in flight is settled by the snapshot. On the opponent's turn, the player loses nothing; the opponent can move meanwhile. | The opponent can move during the drop, or while the rejoin is in flight. Either the move is in the snapshot or its echo follows the snapshot; either way it glides in. |
| How you reached the page | Creator, joiner, and returning player all have a stored seat and rejoin after the drop. A visitor has nothing to rejoin; a queued join is sent. A joiner whose join was still unanswered sends it again. A creator arriving from the side choice rejoins too: the new connection does not carry the seat the old one had. A computer game: no drop affects it. | Not applicable. |
| Connection state | Connected: as described. Connecting: a first attempt that fails enters *reconnecting* exactly as a drop does (a page loaded during an outage is described in [reloading and returning](reload-and-return.md)). Replaced: no drop can happen, since the connection is already closed; a "Play here" whose attempt fails enters *reconnecting* like a drop, and its rejoin, when it goes out, still takes over. | A drop of the new connection before the snapshot returns to *reconnecting*; the next connection sends its own rejoin. |
| Game state | In progress or in check: as described. Over: the result card stays, with "Reconnecting…" visible but out of reach behind it, and the snapshot changes nothing. Frozen: the board does not take input before, during, or after the drop, and the banner stays. | The game can end during the drop through the opponent's move; the snapshot shows the mating move gliding in and the result card. |
| Shift, Ctrl, or Cmd held | No effect. | No effect. |
| Input device | No effect. There is nothing to click, tap, or type: the recovery is automatic. A move half-typed in the move box stays in the box; it cannot be submitted until the snapshot has arrived. | No effect. |

## Cancel and interrupt

"Before sending" is while the page is reconnecting, before the new connection's rejoin is sent; "while in flight" is while the rejoin awaits the snapshot.

| Event | Before sending | While in flight |
| --- | --- | --- |
| Escape or Cancel | No effect. There is nothing to cancel; the promotion dialog closed at the drop. | No effect. The promotion dialog cannot open before the snapshot. |
| Pressing elsewhere or turning the view | Presses on the board do nothing; the view turns; an error can be dismissed. On the invitation to the free seat, "Join game" can be clicked and is queued. | The same: presses on the board still do nothing until the snapshot arrives. |
| Leaving the game page within the app | Leaving the game's page ("Play again", "How to play", Back) resets the connection: the retry loop is abandoned and a fresh connection is tried at once. The opponent already sees, or will see, the player "Offline". Going Forward to the game again before the fresh connection has opened sends one rejoin when it does. | The same. If the server processed the rejoin, the opponent sees the player online and then "Offline" again. |
| The game ends | Cannot end on this page while it is disconnected. The opponent's move can end it on the server; the page learns of it from the snapshot. | The snapshot shows the final move gliding in and the result card. |
| The server answers with an error | No request is pending. An error already showing stays. | The rejoin can be refused, or answered with seat in use; see [The answer arrives](#the-answer-arrives). |
| The connection drops | This is the state being described. A failed attempt schedules the next; nothing changes on screen. | Back to "Reconnecting…"; the next connection sends a new rejoin. |
| The window loses focus or the tab is hidden | The retry loop goes on in the background. Browsers may run a hidden tab's timers late, so attempts there may come later than the schedule says. | The snapshot is handled in the background; a newly arrived last move glides in when the tab is shown again. |
| Reload or closing the tab | The loop ends with the page. A reload starts a fresh page that rejoins once its connection opens, taking over the seat; closing leaves the seat unconnected until the player returns. The stored seat is kept. | The same. If the server processed the rejoin, the opponent sees the player online and then "Offline" again. |
| The opponent acts | The opponent sees the player "Offline" on their turn pill once the server notices the drop. On their turn they can move; the move is recorded and reaches this page in the snapshot. They can also join a game whose invitation to send this page is showing. Their going offline or returning is not shown here until the page rejoins. | A move the opponent makes now is in the snapshot or follows it as an echo, and glides in either way. |
| Another tab takes the seat | This tab cannot be told: it has no connection. When its attempt succeeds, its rejoin does not take the seat back: the server answers with seat in use, this tab shows the replaced dialog, and the other tab keeps playing. See [a second tab](second-tab.md). | If another tab takes the seat after this tab's rejoin was handled, this tab is replaced in the usual way and shows the dialog. |
| A second touch point or a cancelled touch | No effect; the board does not take input. | No effect; the board does not take input until the snapshot arrives. See [the input model](../foundations/input-model.md#the-interrupt-events). |

After any interrupt the page is either reconnecting, caught up by a snapshot, behind the replaced dialog, or gone. Nothing the player does during the drop reaches the server except a queued create or join, which is sent when a connection opens.

## Interactions with other systems

**Seat and turn.** The seat stays taken while its player is disconnected, so nobody else can take it: a join only ever claims a free seat (or hands the same tab back its own), and once both are taken it is refused with "Game full". The drop does not pass the turn and starts no clock. If it is the opponent's turn, they can move while the player is away; if it is the player's turn, the game simply waits.

**The game record.** Nothing is lost from the record and nothing is added by the drop. Every move recorded meanwhile arrives in the snapshot, which replaces the page's copy, so nothing is counted twice. A move in flight at the drop is either recorded or not, never both; the page never sends it again. Because the board takes no input until the snapshot, no move can be played against the position from before the drop.

**Connection.** This document's subject. The states, the schedule, and the rules for queued, re-sent, and dropped requests are in [the connection and seat model](../foundations/connection-and-seat.md#connection-states).

**The opponent.** Sees the player "Offline" once the server notices the drop and back online when the player rejoins. Nothing tells them that the player is reconnecting rather than gone. If the server does not notice the drop before the player's new connection rejoins, the opponent sees no change at all. The opponent's own page is unaffected unless the cause (a server restart, say) drops them too.

**Other tabs and devices.** Each tab has its own connection and its own retry loop, so a drop in one tab does not touch another, though a network outage or server restart drops them all at once. A tab's rejoin after a drop never takes the seat from another tab's live connection: if the player has the game open in two tabs and both drop together, whichever reconnects first gets the seat back, and the other shows the replaced dialog when it reconnects. Another browser or device has no stored seat and cannot take the seat.

**Game over.** A finished game drops and rejoins like any other; the result card stays throughout, with "Reconnecting…" behind it, and the snapshot changes nothing. "Play again" works while disconnected. A game can also end during the drop, in which case the snapshot shows it.

**Stored seat.** The rejoin is made from it. A mid-game drop never deletes it: it is deleted only when a rejoin is refused before this page has had any snapshot and before the game has started on it. After a drop that can only happen on a page that has never had either (a creator who came straight from the side choice and is still on the invitation to send, or a joiner whose start notice was lost to the drop), and only if the game has vanished from the server. The page then shows the invitation to the free seat and the refusal. A "seat in use" answer never deletes it.

**Keyboard, touch, and screen size.** There is nothing to do from any device: no retry control to reach. The reconnecting line and the side choice's bottom line are marked as status messages for assistive technology; see [accessibility](../cross-cutting/accessibility.md). On the board screen the reconnecting line stands in the status column under the turn pill, or at the top left in a window 480 pixels tall or less, so it never covers the pill; see [screen sizes and touch](../cross-cutting/screen-sizes-and-touch.md). What a phone or tablet does to the connection when the browser is sent to the background or the screen locks was not checked; see open questions.

## Edge cases

- **A server restart or redeploy.** Both players drop at the same moment and neither sees the other go offline. Whoever gets back first sees the other "Offline" until the other rejoins a moment later.
- **The one-hour limit.** Each connection has its own hour, counted from when it opened, so in a long game each player sees a brief "Reconnecting…", about half a second on a good network, at a different time. The opponent sees the player go "Offline" and come back in quick succession. The board takes no input for that moment and the round trip after it.
- **A server fault.** When the server hits an error it did not expect, it closes the connection with an internal-error code. The page retries it like any drop and rejoins. The request that caused the fault is not sent again; if it was a move, the snapshot shows whether it was recorded.
- **A fault that happens on every rejoin.** If the server fails each time it handles this player's rejoin (for example, while its game storage is failing), each attempt opens, rejoins, and is closed again. Because the schedule starts over whenever a connection opens, the page then retries every half second indefinitely: "Reconnecting…" flickers on and off, and the opponent may see the player flap between online and offline. The board never takes input, since no snapshot arrives. Read from code; see open questions.
- **Laptop sleep.** A sleeping computer runs nothing. After it wakes, the browser may still believe the old connection is open until it notices otherwise, and until then the page shows no "Reconnecting…" and the board takes input. A move made in that state is held until the browser reports the drop, and is then settled by the snapshot like any move in flight; if the connection was in fact dead, the server never received it and it is still the player's turn. How long the browser takes to notice was not determined.
- **A background tab.** A drop in a hidden tab is handled the same way, but the browser may run its retry timers late, so the tab may take longer to reconnect than the schedule says. Moves that arrived meanwhile glide in when the tab is shown.
- **Two moves missed.** At most two moves can be new to the board after a drop: the player's own move, recorded but not echoed, and the opponent's reply. Only the last one glides; the other is in place. The move list has both. Until the snapshot shows them, the board takes no input, so the stale position cannot be played on.
- **A move typed during the drop.** The move box keeps what was typed, but it sends nothing until the snapshot has arrived, and the move is checked against the position as it then stands.
- **The opponent joins during the drop.** A creator on the invitation to send sees the arrival play when the snapshot arrives, then the board, with no glide even for a move the joiner has already made. The joiner saw the creator "Offline" from the start and sees them back when the creator returns.
- **A lost join.** A join whose answer was lost to the drop is sent again when the connection returns, and the board appears, with the seat this tab had already claimed, or the free seat if the first join never reached the server. Meanwhile the creator's board may already show the game started, with the opponent shown online until the server notices the joiner's connection is gone, "Offline" after, and online again when the join is re-sent. See [joining a game](../start/joining-a-game.md).
- **A lost create.** A pick whose answer was lost is sent again when the connection returns, and the page moves to the new game. If the first request had reached the server, that game is left unused on the server. See [creating a game](../start/creating-a-game.md).
- **Storage disabled.** A page that could not store its seat still rejoins after a drop once the server has confirmed the seat on this page (a joiner's seat confirmation, or the start announcement), because the page remembers it for as long as it is open. A creator whose game has not started yet has no such confirmation, so after a drop that page has nothing to rejoin with. See [creating a game](../start/creating-a-game.md#edge-cases).
- **Back and Forward during an outage.** A player who goes Back to the home page while the network is down, and then Forward to the game, gets the game page back with no rejoin sent yet; when a connection opens, it sends one, taking over. This holds whatever the home page's connection did in between.
- **A second tab while reconnecting.** If the player has two tabs on the same game and uses the second while the first is reconnecting (opening it, or clicking "Play here" there), the first does not take the seat back when its attempt succeeds: it shows the replaced dialog, and the tab the player chose keeps the seat.

## Open questions and verification

- The retry schedule starts over whenever a connection opens (`client/src/hooks/useGameSocket.ts`, `onopen`), not when the page is back in its game. A server fault that recurs on every rejoin therefore retries every half second forever, flickering "Reconnecting…" and the opponent's presence on the turn pill ([bug triage](../bug-triage.md) B-17, still open). Read from code.
- The board waits for the snapshot after every reconnect because it takes input only once this connection's rejoin has been answered (`client/src/screens/GameScreen.tsx`, `sessionReady` and `boardDisabled`); a move pressed before that is not sent (`handleMove`). This closes the stale-position move of [bug triage](../bug-triage.md) B-02 (fixed).
- The rejoin after a drop does not take over once the page has held its seat (`GameScreen.tsx`, `takeoverRef`), and the server answers "seat in use" only when another client id's live connection holds the seat (`server/modal_app.py`, the rejoin handler). A duplicated tab shares its original's client id, so between those two tabs a reconnect can still take the seat back; see [a second tab](second-tab.md#open-questions-and-verification).
- The page sends its rejoin only on an open connection, so no rejoin is queued while the connection is down and none is sent twice when it returns; together with a reset starting a fresh session, this is the fix for [bug triage](../bug-triage.md) B-10.
- The page has no heartbeat of its own: it learns of a drop only when the browser reports the connection closed. How long browsers take to notice a dead connection after a laptop wakes, or when a network silently stops passing traffic, was not measured; during that time the page shows nothing wrong. How long the server takes to notice a vanished connection is a property of the deployment and was not measured.
- How long a single failed attempt takes depends on the browser and the network, and the schedule counts from each failure, so real gaps can be longer than 0.5, 1, 2, 4, and 8 s. How much a browser delays retries in a hidden tab was not measured.
- Whether the one-hour limit lets the server announce the player offline, and whether a redeploy closes every connection at once, are properties of the deployment and were not determined.
- Whether screen readers announce "Reconnecting…" when it appears was not checked. Whether a phone or tablet keeps the connection open when the browser goes to the background or the screen locks was not tried.
- A local server keeps games in memory, so restarting it to imitate a server restart loses the game and the rejoin is refused with "Cannot rejoin". Production keeps games across restarts.
- The connection layer is unchanged in behavior since `4e18386`, apart from resignations and draw messages, which since `b325641` are dropped like moves rather than queued; this document was brought up to `b325641` for the screens around it (the side choice's delayed bottom line, the lobby's screens, the arrival after a rejoin). Covered by `client/src/hooks/useGameSocket.test.ts`, `client/src/App.test.tsx`, `GameScreen.lobby.test.tsx`, and `server/tests/test_local_ws.py`. No end-to-end test drops a connection mid-game; the scripted harness did, at `c571311` ([the verification protocol](../verification/README.md)).

Drafted against 3D Chess commit `b325641`
