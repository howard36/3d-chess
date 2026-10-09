# Hand verification

The feature documents were written from the code and the tests. This directory is the protocol for checking them against the running product, one observable claim at a time.

## What is here

| File | Covers |
| --- | --- |
| [foundations.md](foundations.md) | `foundations/*` |
| [start.md](start.md) | `start/*`, `computer/*`, `learn/*` |
| [play.md](play.md) | `play/*` |
| [game-page.md](game-page.md) | `game-page/*` |
| [session.md](session.md) | `session/*` |
| [cross-cutting.md](cross-cutting.md) | `cross-cutting/*` |
| [harness/](harness/README.md) | the Playwright scripts used for the first two scripted passes (not updated for `24c650c`) |

Each file has one table per document. Each row is an item with a stable ID (`MOVE-07`, `CREATE-03`), a priority, what it needs (a device, a second player, a network condition), the claim with a link to the document section, the setup, numbered steps, the expected result, and a Result column for the tester. Items that cannot be checked by hand (design questions, things that need a product decision) are listed under each document as "Not checkable by hand". An item whose claim no longer holds in any form is kept with its ID and marked *retired*, so that IDs are never reused.

Priorities: **P1** is an established fact, a claim many documents depend on, or a suspected bug; **P2** is an ordinary claim; **P3** is a number, a color, or a timing.

## How to run a pass

1. **Bring up the product locally.** From the repository root, in two terminals:
   - `cd server && uv sync --extra test && uv run --extra test uvicorn modal_app:create_web_app --factory --host 127.0.0.1 --port 8000`
   - `cd client && npm ci && VITE_WS_URL=ws://127.0.0.1:8000/ws npm run dev`, then open `http://localhost:5173`.

   `VITE_WS_URL` must be set before Vite starts; without it the client talks to the production server. The local server keeps games in memory, so restarting it is a clean slate (and is also how to simulate a server restart). Stopping it is how to simulate an outage. Games against the computer and the tutorial need no server at all.
2. **Confirm the commit.** Every document says `Drafted against 3D Chess commit 24c650c`. Run `git rev-parse --short HEAD` in the repository and `git diff 24c650c -- client server`; if the diff is not empty, the documents describe a different build and some failures will be drift, not defects.
3. **Get two players.** Most items need both seats taken. Use two *browser contexts*: two different browsers, or one normal and one private window. Two tabs of the same window share the stored seat and will take the seat from each other; that is what the [second-tab](../session/second-tab.md) items test, and nothing else should use it.
4. **Let the entrances finish.** Every board screen opens with an [entrance](../foundations/the-view.md#the-entrance) during which the board takes no input. Unless an item is about the entrance, wait for it to end (the turn pill fades in last) before the first step. With reduced motion it is a 150 ms fade.
5. Keep the documents open beside the game. Read the linked section before each item; the item is a summary, the section is the claim.
6. Work through P1 first across all files, then P2, then P3.
7. Record `pass`, `fail`, or `blocked` in the Result column, with a note for anything other than a clean pass. A fail is something the document says that the product does not do; a blocked item could not be run (no device, no second player, a prior failure in the way).
8. File every fail in [`bug-triage.md`](../bug-triage.md): if the entry exists, add a Status line quoting the item ID; if not, add an entry with the item ID under "Raised by". A fail is not automatically a product bug; sometimes the document is wrong, and the fix is to the document. Say which in the Status line.
9. When every P1 and P2 item for a document has passed or been filed, change its row in the [coverage table](../README.md#coverage) from `drafted` to `verified`, and its footer from "Drafted against" to "Verified against".

## Devices and conditions

- **mouse**: a desktop browser with a mouse with three buttons and a wheel. A trackpad is not a substitute for the middle-button and right-button items.
- **keyboard**: the same browser, using only Tab, Shift+Tab, Enter, Space, and Escape (and typing in the move box).
- **touch**: a phone or tablet on the same network as the dev server (start Vite with `--host` and use the machine's address; set `VITE_WS_URL` to the machine's address too), or the browser's device emulation with touch enabled. Emulation reproduces taps and one-finger drags faithfully; two-finger gestures need a real device.
- **second player**: a second browser context holding the other seat.
- **second tab**: a second tab or window of the *same* browser context as the player.
- **drop**: the page's connection closing while the page stays open and the game survives on the server. The [harness](harness/README.md) does this by closing the page's socket from inside the page. By hand there is no faithful local equivalent: the local server keeps games in memory, so stopping and restarting it (the obvious way to cut the connection) also deletes every game, and the page then gets "Cannot rejoin". Use a restart only for items about the retry schedule and the reconnecting indicators, and use the harness (or a staging deploy, see the repository's ARCHITECTURE.md, "Development") for items about recovering into the same game. The browser's offline toggle does not reliably close an open WebSocket and should not be used.
- **narrow**: a phone-sized window in devtools' responsive mode, 390 × 844 unless the item names another size.
- **reduced motion**: the operating system's (or the browser's emulated) "reduce motion" preference switched on before the page loads.
- **storage off**: the browser with site data blocked for `localhost` (block third- and first-party cookies and site data in the browser settings).

## Driving the product from a console or script

The board is a WebGL canvas, so the DOM cannot say what the board shows. For testing only, the game's board publishes the live 3D state as `window.__r3fState` once it has been drawn (the lobby's scene, the home page's preview and the tutorial's board never do). In the console, `__r3fState.get().scene` is the scene and `__r3fState.get().camera` the view. Which objects mark what changes with the board's look; the repository's end-to-end helpers, `client/e2e/helpers/board.ts`, show how the current build's cells (`userData.cube`, `userData.zxy`), legal destinations (`userData.highlight`) and pieces (`userData.piece`) are found and projected to a pixel, and read the HUD through its test hooks (`seat`'s `data-seat`, `turn-indicator`'s `data-turn`, `data-check`, `data-result` and `data-winner`, `opponent-presence`'s `data-online`, `move-announcer`'s `data-last-move` and `data-move-count`).

Use it to read state back after a real interaction (how many cells are highlighted, whether a selection exists, where the camera is), never to make the interaction: presses must be real pointer input, because the claims are about what a real press does. Two things the console cannot tell: what a color looks like on screen, and whether an animation was visible (drawing stops while a window is hidden or occluded, and a headless browser draws in software).

## Results so far

**At `24c650c`: three items have been run.** One short scripted check (2026-10-09, Playwright in headless Chromium with reduced motion, driven by the repository's own e2e helpers rather than the harness) played the repetition line and confirmed the new suspected bug B-25: END-12 (in part), END-13 and ERR-05 record it. The checklists were rewritten for this commit (the home page, the lobby, games against the computer, the tutorial, the HUD, the draws, the result card, the new starting position). Every Result cell reads `unverified`, except a few whose claim is untouched since the last pass, which say so ("pass at `c571311` (unchanged since; not rerun)"), and the two that need a real phone, which stay `blocked`. The [harness](harness/README.md) was not updated and cannot run them as they stand. **No document is marked `verified`.**

The earlier passes, whose results are in the history of these files:

- **First pass, 2026-09-25, scripted, against commit `d94507b`.** Every item run once by the harness in headless Chromium: 146 items, 145 pass, 1 blocked. It confirmed the defects behind 19 of the 23 entries then in [`bug-triage.md`](../bug-triage.md), and five claims that failed were fixed in the documents, not the product.
- **Second pass, 2026-09-26, scripted, against commit `c571311`** (the documents then cited `4e18386`, which adds only a server change no item depends on), after the fixes for B-01 to B-09: 218 items, 216 pass, 2 blocked (both need a real phone). It found three defects in those fixes, which were fixed before it completed.

What neither pass covered: anything that needs a human eye (whether colors, sizes, and animations look right, and whether text is readable), browsers other than Chromium, real touch devices and two-finger gestures, screen readers, real network loss and laptop sleep, the production deployment (cold starts, the one-hour limit, expiry), and every item listed under "Not checkable by hand".
