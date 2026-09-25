# Hand verification

The feature documents were written from the code and the tests. This directory is the protocol for checking them against the running product, one observable claim at a time.

## What is here

| File | Covers |
| --- | --- |
| [foundations.md](foundations.md) | `foundations/*` |
| [start.md](start.md) | `start/*` |
| [play.md](play.md) | `play/*` |
| [game-page.md](game-page.md) | `game-page/*` |
| [session.md](session.md) | `session/*` |
| [cross-cutting.md](cross-cutting.md) | `cross-cutting/*` |
| [harness/](harness/README.md) | the Playwright scripts used for the first, scripted pass |

Each file has one table per document. Each row is an item with a stable ID (`MOVE-07`, `CREATE-03`), a priority, what it needs (a device, a second player, a network condition), the claim with a link to the document section, the setup, numbered steps, the expected result, and a Result column for the tester. Items that cannot be checked by hand (design questions, things that need a product decision) are listed under each document as "Not checkable by hand".

Priorities: **P1** is an established fact, a claim many documents depend on, or a suspected bug; **P2** is an ordinary claim; **P3** is a number, a color, or a timing.

## How to run a pass

1. **Bring up the product locally.** From the repository root, in two terminals:
   - `cd server && uv sync --extra test && uv run --extra test uvicorn modal_app:create_web_app --factory --host 127.0.0.1 --port 8000`
   - `cd client && npm ci && VITE_WS_URL=ws://127.0.0.1:8000/ws npm run dev`, then open `http://localhost:5173`.

   `VITE_WS_URL` must be set before Vite starts; without it the client talks to the production server. The local server keeps games in memory, so restarting it is a clean slate (and is also how to simulate a server restart). Stopping it is how to simulate an outage.
2. **Confirm the commit.** Every document says `Verified against 3D Chess commit d94507b`. Run `git rev-parse --short HEAD` in the repository and `git diff d94507b -- client server`; if the diff is not empty, the documents describe a different build and some failures will be drift, not defects.
3. **Get two players.** Most items need both seats taken. Use two *browser contexts*: two different browsers, or one normal and one private window. Two tabs of the same window share the stored seat and will take the seat from each other; that is what the [second-tab](../session/second-tab.md) items test, and nothing else should use it.
4. Keep the documents open beside the game. Read the linked section before each item; the item is a summary, the section is the claim.
5. Work through P1 first across all files, then P2, then P3.
6. Record `pass`, `fail`, or `blocked` in the Result column, with a note for anything other than a clean pass. A fail is something the document says that the product does not do; a blocked item could not be run (no device, no second player, a prior failure in the way).
7. File every fail in [`bug-triage.md`](../bug-triage.md): if the entry exists, add a Status line quoting the item ID; if not, add an entry with the item ID under "Raised by". A fail is not automatically a product bug; sometimes the document is wrong, and the fix is to the document. Say which in the Status line.
8. When every P1 and P2 item for a document has passed or been filed, change its row in the [coverage table](../README.md#coverage) from `drafted` to `verified`.

## Devices and conditions

- **mouse**: a desktop browser with a mouse with three buttons and a wheel. A trackpad is not a substitute for the middle-button and right-button items.
- **keyboard**: the same browser, using only Tab, Shift+Tab, Enter, Space, and Escape.
- **touch**: a phone or tablet on the same network as the dev server (start Vite with `--host` and use the machine's address; set `VITE_WS_URL` to the machine's address too), or the browser's device emulation with touch enabled. Emulation reproduces taps and one-finger drags faithfully; two-finger gestures need a real device.
- **second player**: a second browser context holding the other seat.
- **second tab**: a second tab or window of the *same* browser context as the player.
- **drop**: the page's connection closing while the page stays open and the game survives on the server. The [harness](harness/README.md) does this by closing the page's socket from inside the page. By hand there is no faithful local equivalent: the local server keeps games in memory, so stopping and restarting it (the obvious way to cut the connection) also deletes every game, and the page then gets "Cannot rejoin". Use a restart only for items about the retry schedule and the reconnecting indicators, and use the harness (or a staging deploy, see the repository README's "Deploy backend manually") for items about recovering into the same game. The browser's offline toggle does not reliably close an open WebSocket and should not be used.
- **narrow**: a window 375 px wide (devtools' responsive mode) for layout items.
- **storage off**: the browser with site data blocked for `localhost` (block third- and first-party cookies and site data in the browser settings).

## Driving the product from a console or script

The board is a WebGL canvas, so the DOM cannot say what the board shows. For testing only, the game page publishes the live 3D state as `window.__r3fState` once the board screen appears. In the console, `__r3fState.get().scene` is the scene: every piece is an object whose `userData.piece` names its type and color; every cell is a box whose `userData` says whether it is a legal destination (`highlight`), the last move's origin or destination (`lastMoveFrom`, `lastMoveTo`); the selection ring, capture rings, glides, and fading pieces are marked `selectionRing`, `captureRing`, `moveGlide`, and `ghostPiece`. `__r3fState.get().camera` and `.controls` give the view.

Use it to read state back after a real interaction (how many cells are highlighted, whether a selection exists, where the camera is), never to make the interaction: presses must be real pointer input, because the claims are about what a real press does. Two things the console cannot tell: what a color looks like on screen, and whether an animation was visible (drawing stops while a window is hidden or occluded, and a headless browser draws in software).

The [harness](harness/README.md) wraps this in Playwright: it seats two players in two browser contexts, projects any cell to the pixel whose line of sight reaches it first, presses with any mouse button, drags, and reads the scene back. It is what the first pass used.

## Results so far

**First pass, 2026-09-25, scripted, against commit `d94507b`.** Every checklist item was run once by the [harness](harness/README.md) in headless Chromium, with two browser contexts as the two players, against the local server and client. Results are recorded in each file's Result column.

- **146 items: 145 pass, 0 fail, 1 blocked.** The blocked item (PROMO-10) could not be set up in a phone-sized window because the board is cropped there (SIZE-01).
- **"Pass" on a suspected-bug item means the product did what the document says it does**, which for those items is the defect. The pass confirmed 18 of them in the running product; they are the entries marked confirmed in [`bug-triage.md`](../bug-triage.md).
- **Five claims failed on the first run and were fixed in the documents, not the product**, then passed: the promotion dialog does not keep focus on "Queen" (PROMO-02, PROMO-04, PROMO-08), a very fast double press sends a move twice (MOVE-07), and the default view does not frame the whole cube (VIEW-01). Their Result cells say so.
- Several first-run failures were the harness's own (timing at a low frame rate, a test that clicked before a screen had rendered); they were corrected and rerun, and are not recorded as product results.

What this pass did **not** cover: anything that needs a human eye (whether colors, sizes, and animations look right, and whether text is readable), browsers other than Chromium, real touch devices and two-finger gestures, screen readers, real network loss and laptop sleep, the production deployment (cold starts, the one-hour limit, expiry), and every item listed under "Not checkable by hand". Because the pass was scripted, **no document has been marked `verified`**: the protocol requires a person to watch the P1 and P2 items, and that pass has not been run.
