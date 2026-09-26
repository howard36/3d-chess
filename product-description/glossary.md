# Glossary

The vocabulary used across these documents. When a document uses one of these words, it means exactly this. Where the product has its own on-screen wording, the term uses it and says so.

## The product and its screens

**Start screen.** The page at `/`. It shows the title "3D Chess", a "Start New Game" button, and, while the connection is not open, a gray status line ("Connecting to server…" or "Reconnecting to server…"). It is the only way to create a game. See [creating a game](start/creating-a-game.md).

**Game page.** The page at `/game/{id}`. What it shows depends on the *game page phase*. See [screens and navigation](foundations/screens-and-navigation.md).

**Game page phase.** One of three: *before joining*, *joined*, and *playing*. The phase is worked out from what the server has said on the current page, not stored anywhere. Before joining, a player with a *stored seat* sees the *share-link screen* and a *visitor* sees the *join screen*; joined shows the *joined screen*; playing shows the *board screen*.

**Share-link screen.** The game page before the game starts, for a player with a stored seat: "Game created! Share this link with a friend:" above the *share link* in a dark box. Despite the wording, a returning joiner sees it too for the moment between loading the page and the server's answer. See [waiting for an opponent](start/waiting-for-an-opponent.md).

**Join screen.** The game page for a *visitor*: the title and a "Join Game" button, nothing else. See [joining a game](start/joining-a-game.md).

**Joined screen.** The game page between clicking "Join Game" and the game starting: "Joined game, waiting for start...". Normally it shows for a fraction of a second.

**Board screen.** The game page once the game has started: the 3D board filling the window, with the *HUD* laid over it.

**Crash screen.** The page shown when the client hits an error it cannot handle: "Something went wrong", a sentence saying reloading is safe, and a "Back to start" link that loads `/` from scratch. It replaces whatever page was showing. See [screens and navigation](foundations/screens-and-navigation.md#the-crash-screen).

## Games and seats

**Game.** One match between two seats, created on the server by "Start New Game". A game is identified by its *game id* and consists of its two *seats* and its *move record*. There is no other game state on the server: no clock, no result, no player names.

**Game id.** Six characters, each an uppercase letter A–Z or a digit 0–9, chosen at random by the server (for example `K7Q2ZD`). It is case-sensitive: `/game/k7q2zd` is a different, unknown game.

**Share link.** The address of the game page, `{origin}/game/{id}`, shown as plain text on the share-link screen. It is the only way a second player reaches a game. Anyone with it can open the game page.

**Seat.** One of the game's two colors, white or black, held by one player. The *creator* holds one seat from the moment the game exists; the *joiner* claims the other. Seats are held for the life of the game: a seat stays taken while its player is disconnected, and a game with both seats taken answers any further join with "Game full". Nothing about a seat proves who holds it; the server gives a seat to whichever connection names the game and the color.

**Creator.** The player who clicked "Start New Game". The server gives the creator white or black at random; the creator does not learn which until the game starts.

**Joiner.** The player who clicked "Join Game" on a game with a free seat. The joiner gets whichever color the creator did not.

**Opponent.** From one player's point of view, whoever holds the other seat.

**Visitor.** Someone on a game page whose browser has no stored seat for that game: a first-time arrival from a share link, a third person who was sent the link, or a seated player on another browser or device.

**Stored seat.** The color this browser holds in a game, kept in the browser's local storage under the game id. It is written the moment the server assigns a seat (on creating, on joining, and when the game starts) and read every time the game page loads, where it causes an automatic *rejoin*. It is kept indefinitely, with one exception: if the server refuses the rejoin before the game has shown any state, the stored seat is deleted and the page falls back to the join screen. Two tabs of the same browser share the stored seat; two browsers, or a private window, do not. See [the connection and seat model](foundations/connection-and-seat.md#the-stored-seat).

**Move record.** The ordered list of every move played in a game, as the server recorded it. It is the only durable part of a game besides the seats. Every position, whose turn it is, and whether the game is over are worked out from it by each player's browser.

**Expiry.** A game nobody has touched for about 30 days is deleted from the server. After that, its share link leads to a game the server does not know.

## The board

**Board.** The 5 × 5 × 5 grid of 125 *cells* the game is played on, drawn as a wireframe lattice. See [the rules](foundations/game-rules.md#the-board).

**Level.** One of the five horizontal slices of the board in game terms, named A to E, A at the bottom. On screen, levels are drawn as depth, not height: see [the view](foundations/the-view.md#orientation).

**File.** One of the five columns within a level, named a to e.

**Rank.** One of the five rows within a level, numbered 1 to 5. White's back ranks are rank 1; Black's are rank 5.

**Cell.** One position on the board, written as level, file, rank: `Aa1` is level A, file a, rank 1; `Ee5` is the opposite corner. This notation is used in the *move list* and nowhere else on screen: the board itself has no labels.

**Pieces.** King, Queen, Rook, Bishop, Knight, Unicorn, and Pawn, each side starting with 20. The Unicorn is the piece this variant adds. How each moves is in [the rules](foundations/game-rules.md#how-the-pieces-move).

**Forward and up.** For White, *forward* is toward rank 5 and *up* is toward level E; for Black both are reversed. Pawns move forward or up.

## Moves and the rules

**Legal move.** A move the rules allow for the piece and the side to move, after excluding every move that would leave the mover's own king attacked. Only the player's own browser decides legality; the server does not check it.

**Legal destination.** A cell the selected piece has at least one legal move to. A promotion square counts once even though five moves (one per piece) lead there.

**Quiet move.** A move to an empty cell.

**Capture.** A move onto a cell holding an opponent's piece, which is removed.

**Side to move.** The color whose turn it is. White moves first, and the turn alternates with every recorded move.

**Check.** The side to move's king is attacked. Its king glows red on the board. No text says "check".

**Checkmate.** The side to move is in check and has no legal move. The other side wins.

**Stalemate.** The side to move is not in check and has no legal move. The game is drawn.

**Game over.** Checkmate or stalemate, as each player's browser works it out from the move record. The server never learns that a game is over; see [check and the end of the game](play/check-and-game-end.md).

**Promotion square.** For White, any cell on rank 5 of level E; for Black, any cell on rank 1 of level A. A pawn that reaches one must become a Queen, Rook, Bishop, Knight, or Unicorn.

**Promotion.** The choice of piece a pawn becomes on a promotion square, made in the *promotion dialog*.

## Selection and board state

**Selection, selected piece.** The one piece, at most, that the player has picked up to move. It is marked by a gold ring on the floor of its cell and a faint amber glow, and its legal destinations are marked. Selection is local to this browser; nothing is sent.

**Clear (a selection).** Remove the selection and its markers. A selection is cleared by pressing an empty part of the board, by making a move, and automatically whenever the position, the side to move, or whether the board takes input changes. See [making a move](play/making-a-move.md#end-without-sending).

**Move markers.** The marks drawn for the selected piece's legal destinations: an amber dot in an empty cell, a red ring around the foot of a capturable piece, and a faint amber fill over every destination cell. See [the view](foundations/the-view.md#markers-and-colors).

**Last-move trace.** A teal fill over the two cells of the most recent move, its origin and its destination. It stays until the next move. A legal destination's amber fill replaces it on a shared cell.

**Glide.** The 300 ms animation of a piece travelling from its origin to its destination, lifted slightly at the midpoint, played on both boards for every newly arrived move.

**Fade.** The 300 ms animation of a captured piece shrinking into its cell floor and fading out while the capturer glides in.

**Check glow.** The red glow on a king in check. It takes precedence over the amber glow of a selected king.

**The board takes input.** The board accepts presses only while all three hold: the connection is *connected*, the move record is not *frozen*, and none of this player's own moves is *in flight*. When it does not take input, presses on pieces and cells do nothing, any selection is cleared, and the promotion dialog closes. The view can still be turned. The board takes input on the opponent's turn too; there is simply nothing of the player's that can be selected.

**Held.** The board does not take input because this player's move is in flight. It lasts until the answer arrives or the connection drops.

**Frozen.** The board does not take input because the move record contains a move this browser cannot replay. The position stops at the last move that could be replayed and a red banner explains. See [the broken game record](cross-cutting/broken-game-record.md). Not to be confused with the board simply not taking input while disconnected.

## Requests

**Request.** Something a player does that may be sent to the server and answered: creating a game, joining, rejoining, playing a move, taking a seat back. It is the unit of interaction every document narrates. Its phases are *begin*, *end without sending*, *send*, *in flight*, and *the answer arrives*.

**Send.** The moment a request leaves the browser. A request made while the connection is not open is *queued* instead and sent when it opens, except a move, which is never queued (see *dropped*).

**In flight.** A request that has been sent and not yet answered. A request in flight cannot be cancelled from the page; the server may record it even if the player never sees the answer.

**Answer.** The server's reply to a request: the new game's id, a seat confirmation, a *snapshot*, an *echo*, or an *error*.

**Echo.** The server's copy of a recorded move, sent to both players, including the one who made it. A move appears on a player's board only when its echo (or a snapshot that contains it) arrives; the mover's own board does not show the move early.

**Seat confirmation.** The server's answer to a successful join, sent to the joiner alone just before the *start notice*, carrying the color the joiner got. The stored seat is written when it arrives. A drop before it is recovered too: the join is *re-sent*, and the server hands the tab the seat it already claimed for it.

**Start notice.** The server's message, sent the moment a game's second seat is taken, telling every player connected to the game that it has started, and each one its own color. It moves the share-link and joined screens to the board screen. A player whose page is not connected at that moment never receives it; the snapshot from their next rejoin says the game has started instead.

**Land.** A move lands on a board when its echo, or a snapshot containing it, arrives and the browser replays it: the piece glides (or is simply drawn, for a move already in the record when the board appeared), the last-move trace moves, the turn indicator changes, and the move list gains the move, all at that moment and never before.

**Snapshot.** The server's answer to a rejoin: the player's color, whether the game has started, and the entire move record. A snapshot replaces everything the page knew about the move record, so moves are never counted twice.

**Error.** A request the server refused, with a short message shown to the player. The full list is in [error messages](cross-cutting/error-messages.md).

**Queued.** A create, join, or rejoin request made while the connection is not open, held in the browser until it opens and then sent.

**Re-sent.** A create or join whose answer never arrived because the connection dropped is sent again, once per new connection, until it is answered. A repeated create may leave an unused game on the server; a repeated join gets the same seat back.

**Client id.** A random identifier each browser tab picks for itself and sends with every create, join, and rejoin. The server remembers which client id claimed each seat. It lasts as long as the tab (a reload keeps it), and it is not shared with other tabs, so two tabs of one browser are two clients even though they share the *stored seat*.

**Dropped.** A move that is discarded without being sent because the connection was not open when it was made, or was still pending when a new connection opened. The board never showed it, so nothing visibly changes; the player simply moves again.

## Input

**Press.** A click on the board: the primary mouse button, a finger, or a pen going down and coming back up within 6 pixels of where it went down, on the same piece or cell. The board acts on the release: that is when a piece is selected, a selection is cleared, or a move is played. Holding the button down does nothing yet; moving more than 6 pixels first makes it a *drag*; the right and middle mouse buttons never act on the board. See [the input model](foundations/input-model.md).

**Click.** A press and release on an HTML control (a button, a link, the dialog backdrop). HTML controls act on release, as usual in a browser.

**Takes the press.** The first piece or legal destination along the line from the camera through the pointer receives the press, and nothing behind it does. It must be the same object at the release as when the pointer went down. See [the input model](foundations/input-model.md#what-takes-a-press).

**Drag.** A pointer that moves more than 6 pixels between going down and coming up, or any use of the right or middle mouse button, the wheel, or a second finger. On the board, a drag only turns the view: it never selects, clears a selection, or plays a move. There is no dragging of pieces.

**Orbit, zoom, pan.** The three ways to turn the view: orbit rotates the camera around the board (left drag, or one-finger drag), zoom moves it closer or farther (wheel, middle drag, or pinch), and pan slides it sideways (right drag, Shift/Ctrl/Cmd with left drag, or two-finger drag). See [the view](foundations/the-view.md#turning-the-view).

**HUD.** The HTML panels laid over the board. Along the top: the *seat label* at the left, the *turn indicator* in the center, and the *reconnecting banner* at the right, with the *frozen-board banner* below them when it applies. Along the bottom: the *move box* at the left, the *error banner* in the center, and the *move list* at the right. In a window narrower than 640 pixels each row stacks: the turn indicator and the error banner take a row of their own above the other two panels. The gaps between panels let the pointer through to the board; the panels themselves, except the turn indicator, do not.

## Events that end or interrupt a request

**Cancel.** The player abandons a request before it is sent: Escape, a Cancel button, a click on a dialog's backdrop, or a press on an empty cell of the board. Nothing is sent and nothing is recorded. A request that has been sent cannot be cancelled.

**Complete.** A request's answer arrives. What happens next depends on whether it was accepted or refused.

**Interrupt.** Something the player did not choose ends a request's local state: the connection drops, the position changes under it, the game ends, another tab takes the seat, or the page goes away. An interrupted request that had not been sent is discarded. One that had been sent may still have been recorded by the server; the player finds out from the next snapshot.

**Reset.** What returning to the start screen does to the connection: the page's knowledge of the old game is thrown away, the connection is closed, and a fresh one is opened. The opponent sees the player go offline. The stored seat is kept, so opening the share link again rejoins the game.

**Replaced.** The state a tab is left in when another tab or window of the same browser holds the seat: either the other tab took it (the *replaced signal*), or this tab's connection came back after a drop and found the seat held by the other tab (*seat in use*). The tab shows "This game is open in another tab" and holds no seat until the player clicks "Play here". See [a second tab](session/second-tab.md).

## The connection

**Connection.** The one live link between a browser tab and the server. It is opened as soon as the app loads, on either screen, and kept open while the tab stays on the app.

**Connection state.** One of four: *connecting* (the first attempt after the app loads or after a reset), *connected*, *reconnecting* (the connection dropped and the browser is retrying on its own), and *replaced*. The start screen shows the first and third as a status line; the game page shows only *reconnecting* ("Reconnecting…" in an amber box at the top right) and *replaced* (a dialog).

**Retry schedule.** After an unexpected drop, the browser waits 0.5 s, then 1 s, 2 s, 4 s, and then 8 s between attempts, forever. The schedule starts over whenever a connection opens. There is no limit on attempts and no manual retry button.

**Drop.** The connection closing without the player asking: a network change, a computer going to sleep, the server restarting or being redeployed, a fault on the server (which closes the connection with an internal-error code), or the one-hour limit. A drop is always followed by the retry schedule, except when the server closed the connection because the seat was *replaced*.

**One-hour limit.** The server ends every connection after at most one hour. The player sees it as an ordinary brief drop.

**Rejoin.** The request that tells the server "this connection is the player in seat *color* of game *id*". The page sends it by itself, once per new connection, whenever it has a stored seat and the connection has not already been given a seat. The answer is a snapshot. The first rejoin of a page, and the one after "Play here", *take over* the seat; every automatic rejoin after a drop does not.

**Last connection wins.** When a rejoin that *takes over* names a seat that another live connection holds, the server gives the seat to the new connection and closes the old one with a message that stops it retrying. This is what lets a reloaded tab recover at once, and what makes a second tab take the seat from the first.

**Take over.** Whether a rejoin may take the seat from another tab's live connection. A page load, a reload, and "Play here" take over; an automatic rejoin after a drop does not, so a tab that was offline while the player moved to another tab cannot take the seat back by itself. A rejoin that does not take over may still replace the same tab's own stale connection.

**Seat in use.** The server's refusal of a rejoin that does not take over, when another tab's live connection holds the seat. It is not shown as an error; the tab shows the replaced dialog instead.

**Replaced signal.** The way the server closes a connection whose seat a newer connection has taken (last connection wins). A tab that receives it does not retry and shows the replaced dialog; every other close starts the retry schedule. A connection that has already died never receives it; a tab that was reconnecting when another tab took the seat learns of it instead from *seat in use* when its retry succeeds.

**Presence.** Whether the opponent currently has a live connection to the game, shown as "Opponent: online" or "Opponent: offline" under the seat label. The server announces it when a player joins or rejoins and when a player's connection drops. See [seat and opponent status](game-page/seat-and-opponent-status.md).

## The interface

**Seat label.** The dark box at the top left of the board screen: "You are playing as white." (or black, in lower case), with the presence line under it once known.

**Presence line.** The smaller second line of the seat label, "Opponent: online" or "Opponent: offline". It is absent until the first presence report arrives, and after that shows the latest report about the opponent that this page has received, even while this page's own connection is down.

**Turn indicator.** The light box at the top center of the board screen: "White to move" or "Black to move", followed by " — in check" when the side to move is in check. It ignores the pointer, so presses pass through it to the board. Screen readers announce each change.

**Move box.** The dark panel at the bottom left of the board screen where a move can be typed ("Type a move (e.g. Ab2-Ab3)", a text field, and a "Move" button). It plays the move exactly as pressing its piece and destination would, and is how a player without a pointer plays. See [making a move](play/making-a-move.md).

**Move list.** The dark panel at the bottom right of the board screen listing every move in the record, one numbered row per White–Black pair, in cell notation with an en dash (`Ab2–Ab3`) and `=` plus a letter for a promotion (`Da4–Ea5=U`). Hidden until the first move. See [the move list](game-page/move-list.md).

**Error banner.** The red box at the bottom center of the game page: "Error: " followed by the server's message, with a "✕" button that dismisses it. *Dismissing* hides every error received on the page so far; nothing is sent or stored, and the next error shows the banner again. See [the error banner](game-page/error-banner.md). The start screen shows errors differently, as red text under its button.

**Reconnecting banner.** The amber "Reconnecting…" box at the top right of the game page while the connection state is *reconnecting*.

**Frozen-board banner.** The red box below the turn indicator that says a move in the game's history "is not a legal move for this client" and that the board is frozen. It cannot be dismissed.

**Promotion dialog.** The white dialog titled "Promote to" with the buttons "Queen", "Rook", "Bishop", "Knight", "Unicorn", and "Cancel", over a darkened board. See [promotion](play/promotion.md).

**End-game dialog.** The white dialog over a darkened board announcing "White wins by checkmate!", "Black wins by checkmate!", or "Draw by stalemate!", with a "Start new game" button, which has keyboard focus when the dialog opens. It cannot be closed any other way.

**Replaced dialog.** The white dialog titled "This game is open in another tab", with the text "Your seat moved to the newer tab or window. Close this one, or take the game back here." and a "Play here" button, which has keyboard focus when the dialog opens.

## The view

**View.** What the camera shows of the board. Each player's view is independent and local; turning it changes nothing for the opponent and nothing on the server.

**Default view.** The view every board screen starts from: up and to the right of the board, looking at its center, at the distance that just fits the whole cube in the window, whatever its shape. Reloading returns to it. Resizing the window keeps the direction the player has turned to but moves the camera back to the distance that fits the new shape.

**Orientation.** Each player sees the board from their own side: their own back ranks at the bottom of the screen, their own levels nearest the camera, and their army laid out left to right exactly as the other player sees theirs. See [the view](foundations/the-view.md#orientation).

**Near and far.** Toward and away from the camera in the default view. Because levels are drawn as depth, a piece moving *up* a level moves *away* from the player who owns it.
