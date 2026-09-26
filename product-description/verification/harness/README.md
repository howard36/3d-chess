# Verification harness

The Playwright scripts that ran the verification passes (the second, against `4e18386`, is the one in the checklists' Result columns). They are a record of how each result in the checklists was obtained and a way to rerun it; they are not part of the product's test suite, and nothing here is run by CI.

## Running it

From this directory, once:

```bash
ln -sfn ../../../client/node_modules node_modules   # the harness borrows the client's dependencies
(cd ../../../client && npm ci)                       # if node_modules does not exist yet
(cd ../../../server && uv sync --extra test)
```

Then:

```bash
npx playwright test                         # starts (or reuses) the local server and Vite; see below for server-restart.spec.ts
npx playwright test foundations-1           # one file
```

In a container whose Chromium does not match Playwright's version, prefix with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium`. Each checked item prints a `RESULT {ID} {pass|fail|blocked} {note}` line and appends it to `results.jsonl` here; screenshots go to `test-results/`.

`server-restart.spec.ts` stops and restarts the local server by killing whatever listens on port 8000, so the server must be started by hand first (`cd server && uv run --extra test uvicorn modal_app:create_web_app --factory --host 127.0.0.1 --port 8000`); if Playwright started it instead, killing it makes Playwright stop the client's dev server too.

## What it does that a person cannot easily do

- **Seats two players** in two browser contexts and resolves which one is White (`startTappedGame` in `vh.ts`).
- **Presses a cell** with any mouse button, or a touch, at the pixel whose line of sight reaches that cell first (`pixelOf`, `press`), and drags from any point (`drag`).
- **Reads the board back** from the scene the game page publishes for testing: selection rings, legal destinations, capture rings, the last-move cells, glides and fading pieces, each piece's cell, and the camera (`boardState`, `highlighted`, `pieceMap`, `cameraInfo`).
- **Controls the page's connection** from inside the page by wrapping its WebSocket at load (`socketTap`): drop it (`dropConnection`), keep it down (`{ block: true }`, then `releaseConnection`), lose incoming messages (`loseIncoming`), hold back the answers after a reconnect for a few seconds (`delayAnswersAfterOpen`), click a button and cut the connection in the same instant (`clickThenCut`), and send a message the app itself never would (`rawSend`), standing in for a modified client.
- **Computes exact expectations** with the product's own rules engine: the destination lists, the check line, the promotion line, and the mate line in the checklists were produced that way.

## Limits

- The browser is headless Chromium drawing in software at about 9 frames per second. Timings are therefore slow (a 300 ms glide takes over a second), colors were read from the scene rather than judged by eye, and nothing about how anything *looks* was checked except in the few screenshots mentioned in the results.
- Only Chromium. No Firefox, no Safari, no real touch device (touch was emulated, one finger at a time), no screen reader.
- The server is the local one, which keeps games in memory. Production keeps them across restarts; the restart items check the page's handling only.
- Presses are real pointer events; the connection controls act inside the page. Whether a real network outage looks exactly like a closed socket (for example after a laptop sleeps) was not checked.

## Notes from the second pass

- Each spec file adds the helpers it needs on top of `vh.ts` (for example a record of what the page sends, to prove that nothing was sent; a per-tab flag that makes a reload start with incoming messages lost; a sampler for glides and fades). They are local to the file that uses them.
- A game page is taken to be loaded when its turn indicator and canvas are there; `window.__r3fState` alone is not enough, because it stays set across in-app navigation.
- Reduced motion is emulated with `page.emulateMedia({ reducedMotion: 'reduce' })`, and the clipboard with `context.grantPermissions(['clipboard-read', 'clipboard-write'])`.
- `results.jsonl` accumulates across runs; the latest line for an ID is its result.

