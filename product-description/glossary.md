# Glossary

The vocabulary used across these documents. When a document uses one of these words, it means exactly this. Where the product has its own on-screen wording, the term uses it and says so.

## The product and its screens

**Home page** (the *start screen* or *landing page* in older documents). The page at `/`. The *preview* fills the window; a menu stands beside it (in a column at the left in a wide window, above and below the tower in an upright one): the title "3D Chess", two tiles, "Play a friend" and "Play the computer", and a quieter "How to play" under them. These are the page's only controls, and none sends anything. See [the home page](start/the-home-page.md).

**Preview.** The home page's live picture: the board screen's glass tower in its garden, without labels, playing the same 17-move game (checkmate by White) over and over, a veil fading between one game and the next, while the camera circles the tower about once every 88 seconds. It is decoration: it takes no input, belongs to no game on the server, and a screen reader hears one sentence in its place. It cannot be paused; for a player whose system asks for reduced motion it is a still picture of the final position. See [the home page](start/the-home-page.md#the-preview).

**Lobby.** The scene behind the *side choice* and the game page before the game starts: one sheet of glass (the tower's bottom level, edged in rose) in the night garden, with the kings on it, White's seat on the left and Black's on the right. A taken seat shows its king in its army's material; a free seat is the king's outline drawn in neon. On the side choice the kings form out of nothing as the page opens, and a king lifts a little under the pointer once it has formed, as if picked up; a king not chosen fades where it stands, and a named pick's open seat gets its outline only with the *invitation to send*, drawn up from its foot. The player's own king stands on the glass in a column of light from the pick on (a guest's from the *arrival*). Kings lift into their columns only at the *arrival*, both together. Nothing is written under the kings. The scene stays up, without reloading, from the side choice to the new game's page, and until the *arrival* hands over to the board. See [creating a game](start/creating-a-game.md) and [waiting for an opponent](start/waiting-for-an-opponent.md).

**Side choice.** The page at `/new` (for a game against a friend) or `/computer` (against the computer): "Choose your side" over three kings (porcelain, a king split porcelain and charcoal, and charcoal) with a one-word button under each, "White", "Random", and "Black". A pick is final. At `/new` it creates the game on the server; at `/computer` it is followed on the same page by the *difficulty choice*. It is the only way to begin a game. See [creating a game](start/creating-a-game.md#the-side-choice).

**Difficulty choice.** The second step of the side choice at `/computer`: the heading "Choose difficulty" and three tiles under the kings, "Easy", "Medium", and "Hard", each with the computer's robot and one to three bars of strength; the one last played has keyboard focus (Medium the first time). Choosing one makes the game in the browser. "Difficulty" is used rather than the code's "level", which these documents keep for the board's levels. See [playing the computer](computer/playing-the-computer.md).

**Arrival.** What a page that showed the lobby plays when the game starts on it: the free seat fills and a ring of light spreads across the glass; the kings get their columns of light and lift together, at the same moment on the host's page and the guest's, and a single line takes the page heading's place ("Opponent joined" for the host; "You play White" or "You play Black" for the guest; "Computer · Easy", "Computer · Medium", or "Computer · Hard" against the computer). Then the kings are taken up into their columns, the garden goes dark while the camera draws back and the glass spins into place, and the lobby's picture fades off the board's first picture as the game's *entrance* builds the tower on up from level A. See [waiting for an opponent](start/waiting-for-an-opponent.md#the-answer-arrives).

**Entrance.** The few seconds with which every board screen opens: the tower draws itself in light, level by level, and the armies form; the turn pill fades in last. The board takes no input until it is over. About 3.1 seconds after the *arrival*, just under 4 for a game that starts on a page without the lobby, 1.3 on a page that opens on a game under way, and a 150 ms fade under reduced motion. See [the view](foundations/the-view.md#the-entrance).

**Game page.** The page at `/game/{id}` (a game against a friend) or `/computer/{id}` (against the computer). What it shows depends on the *game page phase*. See [screens and navigation](foundations/screens-and-navigation.md).

**Game page phase.** One of three: *before joining*, *joined*, and *playing*. The phase is worked out from what the server (or, against the computer, the browser's stand-in) has said on the current page, not stored anywhere. Before the game starts, a player with a *stored seat* sees "Returning to your game…" until the server answers its rejoin, then the *invitation to send*; a *visitor* sees the *invitation to the free seat*, which shows "Joining…" once they have accepted (the joined phase). Playing shows the *board screen*. A game against the computer is playing from its first moment.

**Invitation to send.** The game page before the game starts, for the *host* once the server has confirmed the seat: over the lobby, the heading "You play White" (or Black) with a breathing dot and "Waiting for your friend…" under it, and a glass card with "Invite a friend", the *share link* (plain, without its scheme, on one line and cut off at its end when long), and "Copy link" where the browser allows copying ("Copied ✓" after a copy), and nothing else written, except "Couldn't copy. Select the link." after a failed copy. See [waiting for an opponent](start/waiting-for-an-opponent.md).

**Invitation to the free seat.** The game page for a *visitor*, over the lobby: nothing while the page asks the server which seats are taken ("Connecting to server…" only if that takes over 1.5 s), then the heading "You're invited to play" with the free side's stone and name, and a lone "Join game" button under the scene, with no card; or a card that says only "This game is taken" or "No game here", with "Play a friend". See [joining a game](start/joining-a-game.md).

**Joining.** The invitation between clicking "Join game" and the game starting: the visitor's king already filled on the glass and the button reading "Joining…". Normally it shows for a fraction of a second.

**Board screen.** The game page once the game has started: the 3D board filling the window, with the *HUD* laid over it.

**Tutorial, lesson, step.** The pages at `/learn` and `/learn/{lesson}`, opened by "How to play" on the home page or on the board screen. Eight lessons (Setup, then Rook, Bishop, Unicorn, Queen, King, Knight, and Pawn), each on the tower with a card of words; the Pawn's lesson has four steps (Move, Black, Capture, Promote). A lesson stands its piece alone in the middle of the board, picked up, with every square it can reach ringed; pressing a ring plays the move there. Nothing is sent or kept. See [the tutorial](learn/the-tutorial.md).

**How to play.** The button that opens the tutorial: under the tiles on the home page, and at the top right of the board screen (a "?" in a window under 720 pixels wide). Opened from a game, the tutorial leads back to it ("← Game", "Back to game").

**Crash screen.** The page shown when the client hits an error it cannot handle: "Something went wrong", a sentence saying reloading is safe, and a "Back to start" link that loads `/` from scratch. It replaces whatever page was showing. See [screens and navigation](foundations/screens-and-navigation.md#the-crash-screen).

## Games and seats

**Game.** One match between two seats. A game against a friend is created on the server by a pick on the side choice at `/new`, and is identified by its *game id*; it consists of its two *seats* and its *move record*, and there is no other game state on the server: no clock, no result, no player names. A *computer game* is made and kept in the browser instead.

**Computer game.** A game against the computer, made by the difficulty choice, played in the browser with no server, and kept in the browser's storage after every move (the side, the difficulty, and the move record), so a reload comes back to it. It cannot be opened in another browser. See [playing the computer](computer/playing-the-computer.md).

**Game id.** For a game against a friend, six characters, each an uppercase letter A–Z or a digit 0–9, chosen at random by the server (for example `K7Q2ZD`). It is case-sensitive: `/game/k7q2zd` is a different, unknown game. A computer game's id is ten lower-case letters and digits, under `/computer/`.

**Share link.** The address of the game page, `{origin}/game/{id}`, shown as text on the invitation to send. It is the only way a second player reaches a game. Anyone with it can open the game page.

**Seat.** One of the game's two colors, white or black, held by one player. The *creator* holds one seat from the moment the game exists; the *joiner* claims the other. Seats are held for the life of the game: a seat stays taken while its player is disconnected, and a game with both seats taken answers any further join with "Game full". Nothing about a seat proves who holds it; the server gives a seat to whichever connection names the game and the color.

**Creator, host.** The player who created the game on the side choice. The creator holds the side they picked (with Random, the side the page's coin gave), named in the heading from the pick on.

**Joiner, guest.** The player who clicked "Join game" on a game with a free seat. The joiner gets whichever color the creator did not, and is told which before accepting.

**Opponent.** From one player's point of view, whoever holds the other seat. Against the computer, the computer, named "Computer" on the turn pill.

**Visitor.** Someone on a game page whose browser has no stored seat for that game: a first-time arrival from a share link, a third person who was sent the link, or a seated player on another browser or device.

**Stored seat.** The color this browser holds in a game, kept in the browser's local storage under the game id. It is written the moment the server assigns a seat (on creating, on joining, and when the game starts) and read every time the game page loads, where it causes an automatic *rejoin*. It is kept indefinitely, with one exception: if the server refuses the rejoin before the game has shown any state, the stored seat is deleted and the page falls back to "No game here" or the invitation to the free seat. Two tabs of the same browser share the stored seat; two browsers, or a private window, do not. See [the connection and seat model](foundations/connection-and-seat.md#the-stored-seat).

**Move record.** The ordered list of every move played in a game, as the server recorded it (or, against the computer, as the browser keeps it). It is the only durable part of a game besides the seats. Every position, whose turn it is, and whether the game is over are worked out from it by each player's browser.

**Expiry.** A game nobody has touched for about 30 days is deleted from the server. After that, its share link leads to "No game here".

## The board

**Board.** The 5 × 5 × 5 grid of 125 *cells* the game is played on, drawn as a tower of five glass levels. See [the rules](foundations/game-rules.md#the-board) and [the view](foundations/the-view.md#the-scene).

**Level.** One of the five horizontal slices of the board, named A to E, A at the bottom. On screen each level is a sheet of glass edged in its own color (rose, orchid, violet, blue, and sky, A to E), stacked A at the bottom and E at the top for both players: see [the view](foundations/the-view.md#orientation).

**File.** One of the five columns within a level, named a to e.

**Rank.** One of the five rows within a level, numbered 1 to 5. White's back ranks are rank 1; Black's are rank 5.

**Cell.** One position on the board, written as level, file, rank: `Aa1` is level A, file a, rank 1; `Ee5` is the opposite corner. This notation is used in the *move box* and the *move list*. The board carries its parts as labels: the files and ranks along two edges of the bottom level, and the five level letters up one corner post of the tower.

**Pieces.** King, Queen, Rook, Bishop, Knight, Unicorn, and Pawn, each side starting with 20. The Unicorn is the piece this variant adds. How each moves is in [the rules](foundations/game-rules.md#how-the-pieces-move).

**Forward and up.** For White, *forward* is toward rank 5 and *up* is toward level E; for Black both are reversed. Pawns move forward or up.

## Moves and the rules

**Legal move.** A move the rules allow for the piece and the side to move, after excluding every move that would leave the mover's own king attacked. Only the player's own browser decides legality; the server does not check it (the computer's stand-in does).

**Legal destination.** A cell the selected piece has at least one legal move to. A promotion square counts once even though five moves (one per piece) lead there.

**Quiet move.** A move to an empty cell.

**Capture.** A move onto a cell holding an opponent's piece, which is removed.

**Side to move.** The color whose turn it is. White moves first, and the turn alternates with every recorded move.

**Check.** The side to move's king is attacked. The board marks the king in red among dark blades; nothing on the HUD marks it, and a screen reader hears "Check." with the move.

**Checkmate.** The side to move is in check and has no legal move. The other side wins.

**Stalemate.** The side to move is not in check and has no legal move. The game is drawn.

**Repetition.** The same position (the same pieces on the same cells, the same side to move) standing for the third time. The game is drawn.

**Fifty-move rule.** A hundred moves in all (fifty by each side) with no capture and no pawn move. The game is drawn. The pill calls it "50-move rule".

**Game over.** Checkmate, stalemate, a repetition, or the fifty-move rule, as each player's browser works it out from the move record. The server never learns that a game is over; see [check and the end of the game](play/check-and-game-end.md).

**Promotion square.** For White, any cell on rank 5 of level E; for Black, any cell on rank 1 of level A. A pawn that reaches one must become a Queen, Rook, Bishop, Knight, or Unicorn.

**Promotion.** The choice of piece a pawn becomes on a promotion square, made in the *promotion dialog*.

## Selection and board state

**Selection, selected piece.** The one piece, at most, that the player has picked up to move. It rises a little and holds still inside a column of cool white light, and its legal destinations are marked. Pressing it again puts it down. Selection is local to this browser; nothing is sent.

**Hover.** One of the player's own pieces that can be selected now lifts a little under the pointer. While the pointer is on a level, the other levels step back. Hover is only a hint: nothing happens until a press.

**Clear (a selection).** Remove the selection and its markers. A selection is cleared by pressing an empty part of the board or nothing at all, by making a move, and automatically whenever the position, the side to move, or whether the board takes input changes. See [making a move](play/making-a-move.md#end-without-sending).

**Refused piece.** A piece pressed that cannot be picked up now (an opponent's piece that is not a capture, or the player's own while it is not their turn). It shakes its head, once per press, and the selection stays.

**Move markers.** The marks drawn on the glass for the selected piece's legal destinations: a thin gold circle round a slight fill on an empty cell, and a red circle with four slowly turning red arcs round the foot of a capturable piece. A destination takes a press on its circle (or, for a capture, on the piece). See [the view](foundations/the-view.md#markers-and-colors).

**Last-move trace.** A thin mint line from a small circle on the cell the most recent move left to a larger mint circle round the piece where it landed, with a soft white light travelling along it. It stays until the next move.

**Glide.** The animation of a piece travelling in a straight line from its origin to its destination (a Knight's too), eased out of its square and into the next, 360 to 560 ms depending on the distance, played on both boards for every newly arrived move.

**Fall.** A captured piece being knocked over away from its attacker as the attacker arrives, burning away as it falls.

**Check glow.** How the board marks a king in check: he rocks on his foot as the check lands and turns red, lit from below, among four clusters of dark obsidian blades with red edges. A selected king in check keeps his red.

**The board takes input.** The board accepts presses only while all four hold: the connection is *connected*, this connection's create, join, or rejoin has been answered (so the position shown is the server's, not the one from before a drop), the move record is not *frozen*, and none of this player's own moves is *in flight*; and not during the *entrance*. The move box follows the same rule. When the board does not take input, presses on pieces and cells do nothing, any selection is cleared, and the promotion dialog closes. The view can still be turned. The board takes input on the opponent's turn too; there is simply nothing of the player's that can be selected. It also still takes input after the game has ended (see [bug triage](bug-triage.md) B-25).

**Held.** The board does not take input because this player's move is in flight. The piece played stays lifted where the player left it. It lasts until the answer arrives or the connection drops; after a drop the board still waits for the new connection's snapshot before it takes input again.

**Frozen.** The board does not take input because the move record contains a move this browser cannot replay. The position stops at the last move that could be replayed and a banner explains. See [the broken game record](cross-cutting/broken-game-record.md). Not to be confused with the board simply not taking input while disconnected.

## Requests

**Request.** Something a player does that may be sent to the server and answered: creating a game, looking at an invitation, joining, rejoining, playing a move, taking a seat back. In a game against the computer the browser's own stand-in answers instead of the server, at once. It is the unit of interaction every document narrates. Its phases are *begin*, *end without sending*, *send*, *in flight*, and *the answer arrives*.

**Send.** The moment a request leaves the browser. A request made while the connection is not open is *queued* instead and sent when it opens, except a move, which is never queued (see *dropped*).

**In flight.** A request that has been sent and not yet answered. A request in flight cannot be cancelled from the page; the server may record it even if the player never sees the answer.

**Answer.** The server's reply to a request: the new game's id, the seats taken (to a *look*), a seat confirmation, a *snapshot*, an *echo*, or an *error*.

**Look.** The invitation to the free seat's question to the server: which seats of this game are taken. It binds nothing, the host is not told, and it is asked once per connection until answered.

**Echo.** The server's copy of a recorded move, sent to both players, including the one who made it. A move appears on a player's board only when its echo (or a snapshot that contains it) arrives; the mover's own board does not show the move early.

**Seat confirmation.** The server's answer to a successful join, sent to the joiner alone just before the *start notice*, carrying the color the joiner got. The stored seat is written when it arrives. A drop before it is recovered too: the join is *re-sent*, and the server hands the tab the seat it already claimed for it.

**Start notice.** The server's message, sent the moment a game's second seat is taken, telling every player connected to the game that it has started, and each one its own color. On a page showing the lobby it plays the *arrival*, which hands over to the board screen. A player whose page is not connected at that moment never receives it; the snapshot from their next rejoin says the game has started instead.

**Land.** A move lands on a board when its echo, or a snapshot containing it, arrives and the browser replays it: the piece glides (or is simply drawn, for a move already in the record when the board appeared), the last-move trace moves, the turn pill changes, and the move list gains the move, all at that moment and never before.

**Snapshot.** The server's answer to a rejoin: the player's color, whether the game has started, and the entire move record. A snapshot replaces everything the page knew about the move record, so moves are never counted twice.

**Error.** A request the server refused, with a short message shown to the player. The full list is in [error messages](cross-cutting/error-messages.md).

**Queued.** A create, join, or rejoin request made while the connection is not open, held in the browser until it opens and then sent.

**Re-sent.** A create or join whose answer never arrived because the connection dropped is sent again, once per new connection, until it is answered. A repeated create may leave an unused game on the server; a repeated join gets the same seat back.

**Client id.** A random identifier each browser tab picks for itself and sends with every create, join, and rejoin. The server remembers which client id claimed each seat. It lasts as long as the tab (a reload keeps it), and it is not shared with other tabs, so two tabs of one browser are two clients even though they share the *stored seat*.

**Dropped.** A move that is discarded without being sent because the connection was not open when it was made, or was still pending when a new connection opened. The board never showed it, so nothing visibly changes; the player simply moves again.

## Input

**Press.** A click on the board: the primary mouse button, a finger, or a pen going down and coming back up within 6 pixels of where it went down, on the same piece or cell. The board acts on the release: that is when a piece is selected, a selection is cleared, or a move is played. Holding the button down does nothing yet; moving more than 6 pixels first makes it a *drag*; the right and middle mouse buttons never act on the board. See [the input model](foundations/input-model.md#a-press-acts-on-release).

**Tap assist.** On a touch screen, a tap that reaches nothing the player can act on goes to the nearest thing they can (one of their own selectable pieces, or a legal destination) within a finger's reach, about 22 pixels. A mouse or pen click is never redirected. See [the input model](foundations/input-model.md#what-takes-a-press).

**Click.** A press and release on an HTML control (a button, a link, the veil round a dialog). HTML controls act on release, as usual in a browser.

**Takes the press.** The first piece or legal destination along the line from the camera through the pointer receives the press, and nothing behind it does. It must be the same object at the release as when the pointer went down. See [the input model](foundations/input-model.md#what-takes-a-press).

**Drag.** A pointer that moves more than 6 pixels between going down and coming up, or any use of the right or middle mouse button, the wheel, or a second finger. On the board, a drag only turns the view: it never selects, clears a selection, or plays a move. There is no dragging of pieces.

**Orbit, zoom.** The two ways to turn the view: orbit rotates the camera round the tower's center (left drag, Shift/Ctrl/Cmd with right drag, or one-finger drag), and zoom moves it closer or farther (wheel, middle drag, or pinch). There is no pan: the camera always looks at the tower's center. See [the view](foundations/the-view.md#turning-the-view).

**HUD.** The HTML laid over the board. At the top center, the *turn pill* with the *captured pieces* hanging under it, and the *status column* under them; at the top right, "How to play"; only while the *move box* has keyboard focus, the *move card* at the bottom left; and, once a finished game's *result card* has been closed, "Play again" at the bottom center. On a phone held upright the pill fills the top row, from a 12 pixel gutter to the "?" of "How to play"; in a window 480 pixels tall or less (a phone on its side) the pill, the captured pieces, and the status column stand at the top left, beside the tower. Only "How to play", the move card (while shown), the error banner's "✕", "Retry", and "Play again" catch the pointer; everything else in the HUD lets presses and drags through to the board.

## Events that end or interrupt a request

**Cancel.** The player abandons a request before it is sent: Escape, a Cancel button, a click on the veil round the promotion dialog, or a press on an empty cell of the board. Nothing is sent and nothing is recorded. A request that has been sent cannot be cancelled.

**Complete.** A request's answer arrives. What happens next depends on whether it was accepted or refused.

**Interrupt.** Something the player did not choose ends a request's local state: the connection drops, the position changes under it, the game ends, another tab takes the seat, or the page goes away. An interrupted request that had not been sent is discarded. One that had been sent may still have been recorded by the server; the player finds out from the next snapshot.

**Reset.** What leaving a game's page (for any other page, or another game's page), or arriving at the home page, does to the connection: the page's knowledge of the old game is thrown away, the connection is closed, and a fresh one is opened. The opponent sees the player go offline. The stored seat is kept, so opening the share link again rejoins the game. See [the connection and seat model](foundations/connection-and-seat.md#leaving-a-games-page).

**Replaced.** The state a tab is left in when another tab or window of the same browser holds the seat: either the other tab took it (the *replaced signal*), or this tab's connection came back after a drop and found the seat held by the other tab (*seat in use*). The tab shows "This game is open in another tab" and holds no seat until the player clicks "Play here". See [a second tab](session/second-tab.md).

## The connection

**Connection.** The one live link between a browser tab and the server. It is opened as soon as the app loads, on any page, and kept open while the tab stays on the app. A game against the computer never uses it.

**Connection state.** One of four: *connecting* (the first attempt after the app loads or after a reset), *connected*, *reconnecting* (the connection dropped and the browser is retrying on its own), and *replaced*. The side choice shows the first and the third in the line at its bottom, only once a wait has lasted 1.5 seconds; the home page and the tutorial show none; the game page shows only *reconnecting* (the *reconnecting line*) and *replaced* (a dialog).

**Retry schedule.** After an unexpected drop, the browser waits 0.5 s, then 1 s, 2 s, 4 s, and then 8 s between attempts, forever. The schedule starts over whenever a connection opens. There is no limit on attempts and no manual retry button.

**Drop.** The connection closing without the player asking: a network change, a computer going to sleep, the server restarting or being redeployed, a fault on the server (which closes the connection with an internal-error code), or the one-hour limit. A drop is always followed by the retry schedule, except when the server closed the connection because the seat was *replaced*.

**One-hour limit.** The server ends every connection after at most one hour. The player sees it as an ordinary brief drop.

**Rejoin.** The request that tells the server "this connection is the player in seat *color* of game *id*". The page sends it by itself, once per new connection, whenever it has a stored seat and the connection has not already been given a seat. The answer is a snapshot. A page's rejoins *take over* the seat until one of them has been answered, and so does the one after "Play here"; once the page has held the seat, every automatic rejoin after a drop does not.

**Last connection wins.** When a rejoin that *takes over* names a seat that another live connection holds, the server gives the seat to the new connection and closes the old one with a message that stops it retrying. This is what lets a reloaded tab recover at once, and what makes a second tab take the seat from the first.

**Take over.** Whether a rejoin may take the seat from another tab's live connection. A page load, a reload, arriving through history, and "Play here" take over (until the page's rejoin is answered); an automatic rejoin after a drop, once the page has held the seat, does not, so a tab that was offline while the player moved to another tab cannot take the seat back by itself. A rejoin that does not take over may still replace the same tab's own stale connection.

**Seat in use.** The server's refusal of a rejoin that does not take over, when another tab's live connection holds the seat. It is not shown as an error; the tab shows the replaced dialog instead.

**Replaced signal.** The way the server closes a connection whose seat a newer connection has taken (last connection wins). A tab that receives it does not retry and shows the replaced dialog; every other close starts the retry schedule. A connection that has already died never receives it; a tab that was reconnecting when another tab took the seat learns of it instead from *seat in use* when its retry succeeds.

**Presence.** Whether the opponent currently has a live connection to the game. The turn pill shows it only when they do not: their stone becomes an outline and their half reads "Offline". Screen readers are told both ways ("Your opponent is offline.", "Your opponent is online."). The server announces it when a player joins or rejoins and when a player's connection drops. See [seat and opponent status](game-page/seat-and-opponent-status.md).

## The interface

**Seat label.** The left half of the turn pill: the player's own stone, porcelain for White or charcoal for Black, with "You" (or "Your move"). On the board screen it is the only place the player's color shows; a screen reader reaching the pill hears "You play White." (or Black). The lobby's headings name the color in words before the game.

**Stone.** A small disc in one army's material, porcelain for White and charcoal for Black, standing for that side in the turn pill, the invitation's heading, and the result card. The side to move's stone wears a thin ring of light.

**Turn indicator, turn pill.** The glass pill at the top center of the board screen. Its left half is the player: their stone and "Your move" when it is their turn, "You" when it is not. Its right half is the opponent: "Their move" or "Opponent" ("Computer" against the computer; "Offline" when the opponent has no connection), and their stone. The half whose side is to move is lit: brighter words and a ring of light round its stone. It does not mark check. Once the game is over the pill gives the result instead ("Checkmate · you win", "Checkmate · you lose", "Stalemate · draw", "Repetition · draw", "50-move rule · draw"). It lets presses through to the board. See [the turn indicator](game-page/turn-indicator.md) and [seat and opponent status](game-page/seat-and-opponent-status.md).

**Captured pieces.** Under the turn pill, what each side has taken: the player's under their half, beginning under their stone, and the opponent's under theirs, ending under their stone. Each is a small silhouette per kind of piece taken (the same silhouettes as the promotion dialog's), in the taken army's material, with how many beside it when there is more than one (one pawn and "3" for three pawns), most valuable first from the stone inward, and a small "+N" on the side ahead on material, at this board's own values (queen 10, knight and bishop 3, rook 2.5, unicorn 1.5, pawn 1, counting a promotion; so "+2.5" can appear). Nothing shows before the first capture. In a short window the two stand one above the other under the pill at the top left, the player's first. A screen reader reaches them after the pill as words ("You have taken a knight and 3 pawns; you are 5 ahead."), never announced. See [the turn indicator](game-page/turn-indicator.md#the-pieces-each-side-has-taken).

**Status column.** Under the turn pill and the captured pieces (at the top left in a short window): the reconnecting line while the connection is *reconnecting*, the error banner, and the frozen-board banner, stacked, each only while it applies.

**Move card.** The glass card at the bottom left of the board screen (across the bottom in a window no wider than 13:9, at the bottom right in a short one). It is never shown as a panel: it stays in the page out of sight, holding the *move list* for screen readers and the *move box*, and shows (with just the box) only while the box has keyboard focus. See [the move list](game-page/move-list.md).

**Move announcement.** What a screen reader is told as each move lands, whatever is on screen: the move ("White bishop Ad2 takes pawn on Dd5"), then check or the result ("Check.", "Checkmate. You win.", "Repetition. Draw."), then whose move it is ("Your move." or "Black to move."). See [accessibility](cross-cutting/accessibility.md).

**Move box.** The field of the move card where a move can be typed ("Type a move"; "Bb1-Cb1", "=Q" to promote), sent with Enter or the ↵ button beside it. It plays the move exactly as pressing its piece and destination would, and is how a player without a pointer plays. It is the first thing Tab reaches on the board screen, and appears when it does. See [making a move](play/making-a-move.md).

**Move list.** The game's moves in the move card, one numbered row per White–Black pair, in cell notation with an en dash (`Bb1–Cb1`) and `=` plus a letter for a promotion (`Da4–Ea5=U`). Never visible: it is in the page for screen readers only. See [the move list](game-page/move-list.md).

**Error banner.** A glass notice with a thin red rule at its left edge: the server's message (a screen reader hears "Error: " before it), with a "✕" button that dismisses it. On the board screen it is in the status column under the turn pill; on the game page before the game starts (over the lobby) it sits at the top center; there "No such game", "Cannot join", "Cannot rejoin", and "Game full" never show in it, because the invitation says "No game here" or "This game is taken" instead. *Dismissing* hides every error received on the page so far; nothing is sent or stored, and the next error shows the banner again. See [the error banner](game-page/error-banner.md). The side choice shows errors differently, as red text at its bottom ("Couldn't start a game: " and the message).

**Reconnecting line, reconnecting banner.** "Reconnecting…" beside a small breathing light, in the status column while the connection state is *reconnecting*; the turn pill dims behind it, since what it says may be out of date. On the pre-game screens it sits at the top right.

**Frozen-board banner.** A glass notice with a red rule in the status column that says a move in the game's history can't be replayed by this version of the app and that the board stays at the position before it. It cannot be dismissed.

**Promotion dialog.** A glass card over a lightly veiled board: "PROMOTE TO" above five tiles, each a piece's silhouette in the player's material with its name ("Queen", "Rook", "Bishop", "Knight", "Unicorn"), and "Cancel" under them. See [promotion](play/promotion.md).

**Result card** (the *end-game dialog* in older documents). A glass card over the veiled final position: a close button, the two stones with the winner's lit, "You win", "You lose", or "Draw", "by checkmate", "by stalemate", "by repetition", or "by the 50-move rule" under it, and "Play again", which has keyboard focus when the card opens and leads to the side choice of the same kind. It can be closed (its close button, Escape, or a click outside it) to study the final position, which leaves "Play again" below the tower. See [check and the end of the game](play/check-and-game-end.md).

**Replaced dialog.** A glass card titled "This game is open in another tab", with the text "Your seat moved to the newer tab or window. Close this one, or take the game back here." and a "Play here" button, which has keyboard focus when the dialog opens.

## The view

**View.** What the camera shows of the board. Each player's view is independent and local; turning it changes nothing for the opponent and nothing on the server.

**Default view.** The view every board screen starts from: a little above the bottom level and to the player's right, looking at the tower's center, at the distance that keeps the whole tower and its labels in the window from every height the view can be turned to, whatever its shape, the center standing a little above the middle of the room below the turn pill. Reloading returns to it. Resizing the window refits it, keeping the direction the player has turned to and their zoom.

**Orientation.** Each player sees the board from their own side: their own back ranks at the bottom of the screen, their own levels nearest the camera, and their army laid out left to right exactly as the other player sees theirs. See [the view](foundations/the-view.md#orientation).

**Near and far.** Toward and away from the camera in the default view. Ranks are drawn as depth, so a piece moving *forward* moves *away* from the player who owns it; levels are drawn as height.
