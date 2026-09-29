# Screens and navigation

## Summary

3D Chess has three addresses: the [start screen](../glossary.md#the-product-and-its-screens) at `/`, the [side choice](../glossary.md#the-product-and-its-screens) at `/new`, and the [game page](../glossary.md#the-product-and-its-screens) at `/game/{id}`. The side choice and the game page before its game starts share one scene, the [lobby](../glossary.md#the-product-and-its-screens), which stays up without reloading as the page moves from one to the other. The game page shows one of several screens depending on its [phase](../glossary.md#the-product-and-its-screens) and whether the browser holds a seat, and a crash screen can replace either page. This document owns that map: what each address shows, how the game page decides which screen to show, how the player moves between pages (buttons, browser Back and Forward, typed addresses), what survives each move, and the crash screen. It is a foundation; the features on each screen have their own documents.

## The map

```mermaid
stateDiagram-v2
    state "Start screen" as start
    state "Side choice" as choose
    state "Game page" as game {
        state "Returning to your game…" as returning
        state "Invitation to send" as invite
        state "Invitation to the free seat" as invitation
        state "Taking your seat…" as taking
        state "Board screen" as board
        [*] --> returning : stored seat
        [*] --> invitation : no stored seat
        returning --> invite : snapshot says not started
        returning --> board : snapshot says started (short entrance)
        returning --> invitation : rejoin refused (stored seat deleted)
        invitation --> taking : "Take your seat"
        taking --> invitation : join refused ("This game is taken", "No game here")
        taking --> board : game starts (arrival, then entrance)
        invite --> board : game starts (arrival, then entrance)
    }
    state "Crash screen" as crash
    [*] --> start : open /
    [*] --> choose : open /new
    [*] --> game : open /game/{id}
    start --> choose : "Start a game"
    choose --> start : "← Home"
    choose --> game : game created (history entry replaced)
    board --> choose : "Start new game" (end-game dialog, reset)
    invitation --> choose : "Start a new game"
    game --> start : "← Home" or browser Back (reset)
    start --> game : browser Forward (rejoin)
    game --> game : Back or Forward to another game's page (reset, then rejoin)
    start --> crash : unhandled error
    game --> crash : unhandled error
    crash --> start : "Back to start" (full reload)
```

## The start screen

The page at `/`, a landing page: the [preview](../glossary.md#the-product-and-its-screens) (the glass tower turning slowly in its garden while a sample game plays itself on it) fills the window, with the title "3D Chess" above the tower, the "Start a game" button below it, and nothing under the button. The button is the page's only control, and it sends nothing: it opens the side choice. The preview is only a picture, always playing: it takes no input and is not a game. Both are described in [creating a game](../start/creating-a-game.md).

## The side choice

The page at `/new`: "Choose your side" over three kings on the lobby's glass, with "White", "Random", and "Black" under them, and "← Home" at the top left. A pick creates the game and, once it has played out, replaces `/new` in the browser's history with the new game's page. It is where "Start new game" (end-game dialog) and "Start a new game" (an invitation that leads nowhere) lead. See [creating a game](../start/creating-a-game.md#the-side-choice).

Arriving at the start screen or the side choice from a game by any route [resets the connection](connection-and-seat.md#returning-to-the-start-screen).

## The game page and its phases

The page at `/game/{id}`. The id in the address is all the page starts with; it does not check its format, so any text after `/game/` opens a game page, and whether such a game exists is learned only when the player joins or the page rejoins.

The page's [phase](../glossary.md#the-product-and-its-screens) is worked out from what the server has said on this page, and from nothing else:

| Phase | When | Screen shown |
| --- | --- | --- |
| Before joining | Nothing says the game has started, and the player has not clicked "Take your seat" and has not been confirmed in a seat. | With a [stored seat](connection-and-seat.md#the-stored-seat): "Returning to your game…" until the rejoin is answered, then the **invitation to send** ("Invite a friend" and the link). Without one: the **invitation to the free seat** ("Opening the invitation…", then "You're invited to play …" with "Take your seat", or "This game is taken" or "No game here"). |
| Joined | The player clicked "Take your seat", or the server confirmed a joined seat, and the game has not started. | The invitation with the seat taken: "Taking your seat…". |
| Playing | The server announced the game's start, or a snapshot said both seats are taken. | The **board screen**: the 3D board filling the window with the [HUD](../glossary.md#input) over it. |

The screens before the game share one look: the lobby's glass and kings in the night garden, with "← Home" at the top left, a heading at the top that carries the story from one step to the next ("Choose your side", "You play Black", "You're invited to play White"), and buttons or a glass card at the bottom ("Returning to your game…" alone is a line on a dark page, without the scene). The board screen is the whole tower in the same garden, with no title, exactly the size of the window, which never scrolls. When the game starts on a page that showed the lobby, the [arrival](../glossary.md#the-product-and-its-screens) plays, the lobby's camera ends on the board's first picture over level A's glass, which stays, and the board's entrance builds the tower on up from it; a page that opens on a game already under way goes straight to the board with a short entrance.

Once the page reaches the playing phase it stays there for as long as the page is open. The board, and the ability to [turn the view](the-view.md#turning-the-view), exist only in the playing phase; before both seats are taken there is only the lobby, which cannot be turned.

Overlays appear on top of whichever screen is showing:

- the "Reconnecting…" line, while the connection is reconnecting (every screen; at the top right, or on the board screen under the turn pill);
- the red [error banner](../game-page/error-banner.md), for the latest server error (at the top center before the game starts, where "Cannot join" and "Game full" are said by the invitation instead; under the turn pill on the board screen);
- the [replaced dialog](../session/second-tab.md), while another tab holds the seat (every screen);
- on the board screen only: the [promotion dialog](../play/promotion.md), the [end-game dialog](../play/check-and-game-end.md), and the [frozen-board banner](../cross-cutting/broken-game-record.md).

The three dialogs work the same way. Each is a glass card over a veil that covers the whole window, puts keyboard focus on its first button ("Play here", "Start new game", "Queen"), and makes everything behind it inert: the board, the HUD, or the screen's own content cannot be clicked, reached with Tab, or read by a screen reader until the dialog goes away. (Before the game starts, the error banner is not part of that content: its "✕" can still be reached with Tab behind the replaced dialog, though not clicked.) Only the promotion dialog can be dismissed without answering it (see [the input model](input-model.md#html-controls-and-the-keyboard)).

The screens themselves are described in [waiting for an opponent](../start/waiting-for-an-opponent.md) (the invitation to send, and the arrival), [joining a game](../start/joining-a-game.md) (the invitation to the free seat), and the `play/` and `game-page/` documents (board).

## Moving between pages

The app changes pages in three ways of its own, and the browser adds its usual controls:

| Action | From | To | What happens to the game on this page |
| --- | --- | --- | --- |
| "Start a game" | start screen | side choice | Nothing is sent. A new history entry is added. |
| The new game's id arrives, and the pick has played out | side choice | the new game page | The page arrives already holding the creator's seat; no rejoin. The side choice's history entry is replaced, so Back skips it. The lobby's scene carries on across the move. |
| "Start new game" in the end-game dialog | board screen | side choice | The connection is reset: the opponent sees the player "Offline" on their turn pill. A new history entry is added, so Back returns to the finished game. |
| "Start a new game" on an invitation that is taken or leads nowhere | game page | side choice | The connection is reset. A new history entry is added. |
| "← Home" | side choice or game page before the game starts | start screen | The connection is reset if the page came from a game. A new history entry is added. |
| "Back to start" on the crash screen | crash screen | start screen | A full page load, like typing the address. |
| Browser Back or Forward to the start screen | game page | start screen | The connection is reset, as above. |
| Browser Back or Forward to a game page | start screen or side choice | game page | A game page opened fresh: it rejoins with the stored seat, or opens the invitation to the free seat without one. |
| Browser Back or Forward straight to another game's page | game page | another game page | The connection is reset, as on arriving at the start screen, and the other game's page is opened fresh: nothing of the first game's page (a join in flight, dismissed errors, a move awaiting its echo) carries over. It rejoins with that game's stored seat, or opens the invitation. |
| Typing or pasting a game link, opening a bookmark, following a link | anywhere | game page | A full page load: a new connection, then a rejoin or the invitation. |
| Reload | any page | the same page | A full page load. Everything on the page is rebuilt from the server; see [reloading and returning](../session/reload-and-return.md). |

What survives each of these: the [stored seat](connection-and-seat.md#the-stored-seat) always survives, the server's record of the game always survives, and the tab's [client id](connection-and-seat.md#the-client-id) survives everything but closing the tab. Everything else (the selection, the view's angle and zoom, a dismissed error, an open promotion dialog, text in the move box, a request that was queued or in flight) belongs to the page and is lost.

The page title is "3D Chess — Online Multiplayer" on every page. The one exception: a host whose tab is in the background when the guest arrives sees "● They're here · 3D Chess" until they return to the tab. A background tab gives no sign that it is the player's turn.

## Addresses the app does not know

Only `/`, `/new`, and `/game/{id}` are pages. Any other address inside the app (for example `/game/` with no id, or `/games`) shows an empty dark page: no title, no message, no link home. The connection is still opened in the background. This looks like an omission; see open questions.

A game id that does not exist, or has expired, opens a normal game page, which says "No game here" as soon as the server answers: at once for a visitor, or after the refused rejoin for a stale stored seat. See [joining a game](../start/joining-a-game.md) and [reloading and returning](../session/reload-and-return.md).

## The crash screen

If the page hits an error it cannot handle while drawing itself, the whole page is replaced by the crash screen: the heading "Something went wrong", the sentence "The app hit an unexpected error. Your game lives on the server, so reloading is safe — it will restore the current position.", and a "Back to start" link.

"Back to start" loads `/` from scratch, like typing the address; it is a link, so it can also be opened in a new tab. Reloading the page instead, as the sentence suggests, reopens the game page and rejoins. Nothing on the crash screen says what went wrong. Replacing the page also closes its connection, so the opponent sees the player "Offline" on their turn pill as soon as the crash screen appears.

The crash screen is a last resort. A move record the browser cannot replay does not crash the page; it freezes the board with a banner instead ([the broken game record](../cross-cutting/broken-game-record.md)). Whether a browser that cannot draw 3D at all reaches the crash screen or shows an empty board screen is not known; see [screen sizes and touch](../cross-cutting/screen-sizes-and-touch.md).

## Cancel and interrupt

Navigation has no request of its own, but each interrupt row applies to the page as a whole:

| Event | Before sending | While in flight |
| --- | --- | --- |
| Escape or Cancel | No effect on navigation. | No effect. |
| Pressing elsewhere or turning the view | No effect on navigation. | No effect. |
| Leaving the game page within the app | Resets the connection on arrival at the start screen, the side choice, or another game's page; see the table above. | Any request in flight is abandoned by the page, and a create or join is no longer re-sent; the server may still record it. See each feature's own table. |
| The game ends | The end-game dialog appears over the board screen; its only way out is "Start new game". | Same. |
| The server answers with an error | Shown on the page that is open when it arrives: in red at the bottom of the side choice ("Couldn't start a game: …"), on the invitation's card ("This game is taken", "No game here") or in the error banner on the game page. | Same. |
| The connection drops | The page stays where it is and shows its reconnecting indicator; the board screen stays up, and its board takes no input until the rejoin's snapshot arrives. | Same. |
| The window loses focus or the tab is hidden | No effect; the page keeps its connection and phase. | No effect. |
| Reload or closing the tab | Everything but the stored seat and the server's record is lost. | Same; the answer to a request in flight is lost. |
| The opponent acts | Can move the game page from the invitation to the board screen, through the arrival. | Same. |
| Another tab takes the seat | The replaced dialog appears on whichever game page screen is showing, including when this tab's reconnect finds the seat in use. | Same. |
| A second touch point or a cancelled touch | No effect on navigation. | No effect. |

## Interactions with other systems

**Seat and turn.** The stored seat decides whether a fresh game page rejoins (and shows the invitation to send or the board) or opens the invitation to the free seat. The turn has no effect on navigation.

**The game record.** Survives every navigation. Each fresh game page rebuilds the position from it.

**Connection.** One connection per tab, opened when the app loads and kept across the in-app moves from the start screen to the side choice and on to the new game's page; reset on every arrival at the start screen or the side choice from a game and on every move from one game's page to another's; replaced by a new one on every full page load.

**The opponent.** Every route that closes this tab's connection (reset, reload, closing, a link away) makes the opponent see "Offline". Returning to the game makes them see the player online again.

**Other tabs and devices.** Each tab navigates independently. Two tabs on the same game page of the same browser compete for the seat; see [a second tab](../session/second-tab.md).

**Game over.** A finished game's page still opens normally and shows the end-game dialog again as soon as the record is replayed.

**Stored seat.** Written by the side choice and the game page; never removed by navigation.

**Keyboard, touch, and screen size.** Browser Back and Forward work from the keyboard as usual. Each dialog takes keyboard focus when it opens, and everything behind it is out of reach until it goes away. Nothing on the pages changes with window size except layout: the start screen's text moves to a column beside the tower in a window 480 pixels tall or less, the side choice stacks its buttons at the bottom on a phone held upright, the share link wraps, and the board screen's HUD stacks into more rows; see [screen sizes and touch](../cross-cutting/screen-sizes-and-touch.md).

## Edge cases

- **Back from a new game.** The side choice replaced its own history entry with the new game's page, so Back from a game the player just created skips it and returns to the start screen (or the finished game the side choice was opened from), resetting the connection: the opponent, if seated, sees the creator go offline, and Forward rejoins.
- **Back from the side choice after a finished game.** "Start new game" adds a history entry, so Back from the side choice reopens the finished game, rejoins it, and shows the end-game dialog again.
- **Changing only the id in the address bar.** A full page load of the other game, never a switch within the page.
- **History between two games.** A player who has had two games open in the same tab can go Back or Forward from one game's page straight to the other's. The connection is reset on the way and the target game's page opens fresh, rejoining with its own stored seat; the address and the game shown always match.
- **Back and Forward before the fresh connection opens.** Going Back to the start screen and Forward again while the reset connection is still opening (quickly, or during an outage) sends nothing until it opens, then a single rejoin.
- **A game page with a lower-case id.** Ids are upper case; `/game/k7q2zd` is an unknown game, not the same one.
- **The crash screen reached before the connection opened.** "Back to start" still works; it does not need the connection.

## Open questions and verification

- Unknown addresses show an empty dark page with no way back but the address bar. This may be worth treating as a bug rather than documenting.
- The tab title reflects only one moment of the game (a guest arriving while the host's tab is in the background), not whose turn it is or that the game is over. Whether more is wanted is a product call.
- The phase rules, the dialogs' focus, and the inert page behind them are covered by `client/src/App.test.tsx`; the reset on returning to the start screen by `client/e2e/gameOver.spec.ts`; the crash screen by `client/src/components/ErrorBoundary.test.tsx`. Which real failures reach the crash screen is unconfirmed.
- The reset on moving from one game's page straight to another's, and the single rejoin after Back and Forward during an outage ([bug-triage B-10](../bug-triage.md)), are read from `client/src/App.tsx`, `client/src/hooks/useGameSocket.ts`, and `client/src/screens/GameScreen.tsx`. The jump is covered by `client/src/AppNavigation.test.tsx`, which also checks that the new game's page keeps its own stored seat; the single rejoin is not covered by a test.
- The claim that the crash screen closes the page's connection (the crashed page is taken down along with everything it owned) is read from code; not observed.
- Whether a browser without 3D support reaches the crash screen was not tried. Since the landing page, the start screen needs 3D support too, for its preview; what it shows without it was not tried either.
- The side choice, the lobby's screens, and the history entries around them were brought up from `client/src/App.tsx`, `client/src/screens/lobby/`, and `client/src/screens/GameScreen.tsx` at `1928567`, not checked in the running app. The start screen's description was brought up to the landing page from `client/src/screens/StartScreen.tsx` and `client/src/screens/LandingPreview.tsx`, not checked in the running app, and needs re-verification.

- The HUD wording in this document (the turn pill, presence as "Offline" on it, the move box, brought up by Tab, the dialogs as glass cards over a veil) was brought up to the new HUD from `client/src/screens/` and the [game page documents](../game-page/turn-indicator.md) at `bb16fed`, not checked in the running app, and needs re-verification.
- The board's look changed at `bb16fed` (the glass tower, the porcelain and charcoal pieces, the gold and red markers, the mint last-move line, the red King in check); this document's mentions of it were brought up to date from the code and [the view](the-view.md), not checked in the running app, and need re-verification.

Verified against 3D Chess commit `4e18386`
