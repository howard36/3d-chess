# 3D Chess product description

A written description of the user experience of 3D Chess: what a player sees, what they can do, and exactly what happens when they do it.

## Purpose

3D Chess is, from the player's point of view, a large state chart. The player moves through it with a handful of inputs: clicks on HTML buttons, presses on the 3D board, drags and wheel turns that move the view, the Escape key, and the browser's own reload, back, and tab controls. A second player moves through the same chart at the same time, and the server's answers arrive in between. Most of that behavior is defined implicitly, spread across React effects, a message log that the client replays, a WebSocket hook with its own retry loop, a Python relay, and the tests of all four. There is no single place that says, in plain language, "when the player does X, this is what happens, and this is what happens if the connection drops or the opponent moves halfway through."

This project is that place. It describes the full experience a player has on the 3D Chess web client (the start screen at `/` and the game page at `/game/{id}`) in a desktop browser, with the default settings and nothing customized, playing against a second person in a second browser.

The documents are for people who need to understand or change the product: designers, engineers, writers, testers, and anyone evaluating whether a behavior is intentional. They are written from the outside in. They describe the experience, not the implementation.

### What this is not

- Not protocol or API documentation. The message schema is `server/schema.json`, and the repository's top-level `README.md` explains the protocol and architecture.
- Not organized by package. The engine, the message-log derivation, the socket hook, the 3D layer, and the server are not described separately. A single behavior is described once, wherever the player meets it.
- Not a technical design document. Where a technical detail is critical to understanding the experience, it appears in a block quote labeled `Technical note:` and nowhere else.

## Conventions

- Describe the experience, not the code. "The piece stays where it was until the server confirms the move" rather than "the board is re-derived when `move_made` arrives".
- Technical detail goes in block quotes, prefixed with `Technical note:`. Use it only when the mechanism changes what the player would expect.
- Use sentence case for headings.
- Name the vocabulary consistently. The [glossary](glossary.md) is the source of truth for terms like *seat*, *stored seat*, *in flight*, *echo*, *the board takes input*, *press*, *level*, and *legal destination*.
- Every document ends with the commit of 3D Chess it was verified against and a list of open questions.
- When a behavior is surprising, say so and say why it is that way if the reason is known. Do not smooth it over.

## The work to be done

Each document describes one feature. Features are large things (making a move) or small things (the turn indicator), but each is described in full, including its edge cases and its interactions with other features.

### Document template

Every feature document follows the same skeleton so that documents are comparable and nothing is skipped.

1. **Summary.** One paragraph describing the feature abstractly. For example: "Creating a game turns one click on the start screen into a new game on the server, with this browser holding one of its two seats, and takes the player to that game's page to wait for an opponent."
2. **The simple case.** The common path in prose.
3. **The interaction, event by event.** The unit of interaction in 3D Chess is a *request*: something the player does that may be sent to the server and answered. Its five phases, and the heading each gets in every document, are:
   - **Begin**: what starts it (a click, a press on the board, a page load, or, for the opponent's requests, a message arriving) and what is decided at that instant.
   - **End without sending**: the request ends before anything leaves the browser (a press that only selects or clears, a Cancel, a page left untouched). Say explicitly what is recorded, which is usually nothing.
   - **Send**: the moment the request leaves the browser. From here it cannot be taken back; the server may record it even if the player never sees the answer.
   - **While in flight**: from sending until the answer arrives. What is disabled, what is shown, what the player can still do.
   - **The answer arrives**: the server's reply (an *echo*, a snapshot, or an error). What is recorded on the server, what changes on screen, where the player lands.

   Include a small state diagram (Mermaid `stateDiagram-v2`) of the states the player passes through. Features that never talk to the server (the view, error dismissal) say so in **Send** and describe their own extended phase there, as [the view](foundations/the-view.md) does for a drag.
4. **Modifiers.** A table of the variant axis, with the same rows in every document, and what each does *at the start* and when it *changes while in flight*:
   - Your color (white or black)
   - Whose turn it is
   - How you reached the page (creator, joiner, returning with a stored seat, or a visitor without one)
   - Connection state (connecting, connected, reconnecting, replaced)
   - Game state (in progress, in check, over, frozen)
   - Shift, Ctrl, or Cmd held
   - Input device (mouse, touch, keyboard only)
5. **Cancel and interrupt.** The same checklist, in the same order, in every document, with two columns: *before sending* and *while in flight*:
   1. Escape or Cancel
   2. Pressing elsewhere or turning the view
   3. Leaving the game page within the app (browser Back or Forward, "Start new game", "Back to start")
   4. The game ends
   5. The server answers with an error
   6. The connection drops
   7. The window loses focus or the tab is hidden
   8. Reload or closing the tab
   9. The opponent acts (moves, joins, leaves, or returns)
   10. Another tab takes the seat
   11. A second touch point or a cancelled touch
6. **Interactions with other systems.** One bold-led paragraph per concern, in this order: **Seat and turn.** **The game record.** **Connection.** **The opponent.** **Other tabs and devices.** **Game over.** **Stored seat.** **Keyboard, touch, and screen size.** A concern with no interaction still gets its one line.
7. **Edge cases.** Anything a player could notice that is not covered above.
8. **Open questions and verification.** The 3D Chess commit the document was verified against, and any behavior that could not be confirmed.

Item 5 matters most. Asking the same interrupt questions of every feature is how gaps and inconsistencies are found.

### Method

For each document:

1. Read where the feature's state lives: the screen component in `client/src/screens/`, the pure derivations in `client/src/game/`, the socket hook in `client/src/hooks/useGameSocket.ts`, and the server handler in `server/modal_app.py`.
2. Read the matching tests. `client/src/App.test.tsx`, `client/src/three/Board.test.tsx`, `client/src/hooks/useGameSocket.test.ts`, `client/src/game/history.test.ts`, `server/tests/test_local_ws.py`, and the Playwright specs in `client/e2e/` are close to executable specifications of the edge cases.
3. Draft the document.
4. Try anything ambiguous in the running product (see [verification](verification/README.md) for how to bring it up). Tests settle "what happens"; the running product settles how it feels, what is visible while a request is in flight, and what the timing is like.
5. Record the commit verified against.

### Verification

Drafting reads the code; verification watches the product. The `verification/` directory holds one checklist per cluster of documents, each item a single observable claim with setup, steps, expected result, a priority, and the device it needs. A tester runs them against a local server and client, records `pass`, `fail`, or `blocked` in the Result column, and files every failure in `bug-triage.md` with the item's ID. A document moves from `drafted` to `verified` in the coverage table only when every P1 and P2 item for it has passed or been filed.

`bug-triage.md` is the other half: every behavior the documents flagged as a likely defect, deduplicated, with reproduction steps, the reason in the code, a severity, and the decision the product team needs to make. Entries confirmed in the running product carry a Status line.

### Order of work

1. **Pilot: creating a game.** Small and self-contained, with a full round trip to the server. Used to settle the template, tone, and depth.
2. **Foundations: the rules, the input model, the connection and seat model, screens and navigation, and the view.** Everything else refers to them.
3. **Playing: making a move, promotion, the opponent's move, check and the end of the game.** The bulk of the experience and the hardest part. Written third so the template is already proven.
4. **Everything else.** Once the template and the exemplars exist, the remaining documents can be drafted in parallel, followed by a consistency pass and a verification pass across the whole set.

Progress is tracked in the [coverage table](#coverage) below.

### Scope decisions

- **One surface.** The web client as a seated player (or a would-be player) sees it, at the source commit, against a server built from the same commit. Two players in two browser contexts is the normal setup; most features need both.
- **Where this repo lives.** This description lives in `product-description/` on a branch of the 3D Chess repository itself, because the working environment could keep nothing else. It never changes `client/` or `server/`; every document cites the source commit `d94507b`, and `git diff d94507b -- client server` is empty on this branch.
- **Server operations are out of scope.** Deployment, `/health`, logging, CI, and the Modal and Cloudflare configuration are not experiences a player has. Where an operational fact reaches the player (the one-hour connection limit, the roughly 30-day expiry of an idle game, a server restart), it is described in [the connection and seat model](foundations/connection-and-seat.md).
- **Modified clients are out of scope, except for what an honest client shows.** The server trusts clients and does not check move legality. What a player running the real client sees when the record holds a move it cannot replay is described in [the broken game record](cross-cutting/broken-game-record.md); how to write such a client is not.
- **Test hooks are out of scope.** `window.__r3fState` and the Playwright helpers exist for testing and change nothing a player sees.
- **The rules are described once.** Piece movement, check, checkmate, stalemate, and promotion squares live in [the rules](foundations/game-rules.md). Feature documents link there rather than restate a rule.
- **Visual language is described once.** The colors and shapes of selection, legal-move markers, the last-move trace, check, and the move glide live in [the view](foundations/the-view.md).
- **Every server message a player can see is catalogued once.** [Error messages](cross-cutting/error-messages.md) lists each error text, what causes it, and where it appears; feature documents say which ones they can produce and link.
- **Interaction shape.** The unit of interaction is a request and its phases are Begin, End without sending, Send, While in flight, and The answer arrives. The interrupt list and the order of cross-cutting concerns are fixed as written in the document template above.
- **Numbered rules.** These are prose documents, not numbered specifications. Stable heading anchors are enough for cross-references.

## Structure

```
README.md                        this file
goal.md                          the standing instructions for whoever drafts
AGENTS.md, CLAUDE.md             entry points for agents: read README.md, then goal.md
glossary.md                      shared vocabulary
bug-triage.md                    suspected defects collected from every document, with repro steps and decisions needed

verification/
  README.md                      how to run a hand-verification pass and record results
  foundations.md                 checklists for foundations/
  start.md                       checklists for start/
  play.md                        checklists for play/
  game-page.md                   checklists for game-page/
  session.md                     checklists for session/
  cross-cutting.md               checklists for cross-cutting/

foundations/
  game-rules.md                  the board, its coordinates, the pieces and how they move, check,
                                 checkmate, stalemate, promotion, the starting position
  input-model.md                 how a press reaches the board, what takes it, when the board takes
                                 input, and what the interrupt words mean
  connection-and-seat.md         games, seats, the stored seat, connection states, rejoining,
                                 presence, and what the server keeps
  screens-and-navigation.md      the two addresses, the game page's three phases, moving between them,
                                 and the crash screen
  the-view.md                    the 3D scene, orientation per player, markers and motion, orbit,
                                 zoom, and pan

start/
  creating-a-game.md             the pilot: Start New Game, to the game page
  waiting-for-an-opponent.md     the creator's share-link screen, until someone joins
  joining-a-game.md              Join Game from a shared link, and what happens when it fails

play/
  making-a-move.md               selecting a piece, legal-move markers, sending a move, the move in flight
  promotion.md                   the "Promote to" dialog
  the-opponents-move.md          waiting through the opponent's turn and seeing their move land
  check-and-game-end.md          the check glow, checkmate and stalemate, the end-game dialog

game-page/
  seat-and-opponent-status.md    "You are playing as …" and "Opponent: online/offline"
  turn-indicator.md              "White to move" / "Black to move"
  move-list.md                   the move history panel
  error-banner.md                the red banner at the bottom of the game page and its dismiss button

session/
  reload-and-return.md           reloading, closing and coming back, and games that have expired
  connection-loss.md             "Reconnecting…", what freezes, what is dropped, how it recovers
  second-tab.md                  "This game is open in another tab" and "Play here"

cross-cutting/
  error-messages.md              every error text a player can see, what causes it, and where it shows
  broken-game-record.md          the frozen-board banner and what the server does not check
  accessibility.md               keyboard reach, screen readers, focus, motion, and color
  screen-sizes-and-touch.md      window size, phones and tablets, touch, and the WebGL requirement
```

## Coverage

Status is one of `not started`, `drafted`, or `verified`.

| Document | Status |
| --- | --- |
| glossary.md | drafted |
| bug-triage.md | not started |
| verification/ (6 checklists) | not started |
| foundations/game-rules.md | drafted |
| foundations/input-model.md | drafted |
| foundations/connection-and-seat.md | drafted |
| foundations/screens-and-navigation.md | drafted |
| foundations/the-view.md | drafted |
| start/creating-a-game.md | drafted |
| start/waiting-for-an-opponent.md | not started |
| start/joining-a-game.md | not started |
| play/making-a-move.md | drafted |
| play/promotion.md | drafted |
| play/the-opponents-move.md | drafted |
| play/check-and-game-end.md | drafted |
| game-page/seat-and-opponent-status.md | not started |
| game-page/turn-indicator.md | not started |
| game-page/move-list.md | not started |
| game-page/error-banner.md | not started |
| session/reload-and-return.md | not started |
| session/connection-loss.md | not started |
| session/second-tab.md | not started |
| cross-cutting/error-messages.md | not started |
| cross-cutting/broken-game-record.md | not started |
| cross-cutting/accessibility.md | not started |
| cross-cutting/screen-sizes-and-touch.md | not started |

## Reference

The source of truth is the 3D Chess repository (`howard36/3d-chess`), the parent directory of this one, at commit `d94507b`. The relevant locations are:

- `client/src/App.tsx`, `client/src/main.tsx`: the two routes and the crash screen that wraps them
- `client/src/screens/`: the start screen, the game page and its overlays (turn indicator, move list, promotion dialog, end-game dialog)
- `client/src/game/history.ts`, `client/src/game/session.ts`: how the position, the turn, the seat, presence, and errors are derived from the message log
- `client/src/hooks/useGameSocket.ts`: the connection, its states, the retry timing, and what is queued or dropped
- `client/src/lib/playerRole.ts`: the stored seat
- `client/src/three/`: the 3D board, selection and markers, orientation, animation, colors
- `client/src/engine/`: the rules (move generation, check, checkmate, stalemate, promotion, starting position, coordinates)
- `server/modal_app.py`, `server/schema.json`: what the server accepts, records, relays, and rejects, and with which messages
- Tests: `client/src/App.test.tsx`, `client/src/three/Board.test.tsx`, `client/src/hooks/useGameSocket.test.ts`, `client/src/game/*.test.ts`, `client/src/engine/*.test.ts`, `server/tests/test_local_ws.py`, and the Playwright specs in `client/e2e/`
