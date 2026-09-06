---
name: run-3d-chess
description: Run and drive the 3D chess app — play moves on the board, screenshot positions, rotate the view, check that a UI or engine change works in the real app, or run the e2e suite. Use this whenever a task needs to see or interact with the rendered game, even if the user only says "check it works" or "show me"; the board is a WebGL canvas that cannot be driven through the DOM.
---

A 5×5×5 3D-chess web app: Vite/React/three.js client plus a FastAPI
WebSocket relay. The board is a WebGL canvas, so it is driven through
Playwright with helpers in `client/e2e/helpers/` that click squares by
ZXY notation (e.g. `Ab2`) by projecting through the live camera.
Playwright's `webServer` config boots both the backend and Vite for
you; nothing needs to be running first.

All commands run from `client/`. Paths below are relative to it.

## Setup (once)

```bash
npm ci                                 # skip if node_modules exists
(cd ../server && uv sync --extra test) # backend deps, incl. uvicorn
```

**Remote containers only:** the preinstalled Chromium build does not
match this Playwright version. Do not run `playwright install`; instead
prefix every Playwright command with
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium`. On a
normal dev machine with browsers installed, omit it.

## Play moves and screenshot (most tasks)

```bash
DRIVE_MOVES="Ab2-Ab3 Ed4-Ed3 Ab3-Ab4" npx playwright test drive
```

`e2e/drive.spec.ts` creates a game, seats two players, plays the moves
in order (sides alternate automatically), and writes
`test-results/drive-0-start.png` plus one screenshot after each move.
It prints each path. `DRIVE_VIEW=black` screenshots from Black's page.
An illegal move fails the run with a timeout waiting for the
destination to light up, so a failure usually means the move is wrong,
not the harness. ~5s from cold.

**Look at the screenshots.** A correct render shows the wireframe
5×5×5 lattice with Staunton pieces, a move list bottom-right, and the
last move highlighted. A blank canvas means WebGL did not start.

## Custom drives (orbit, inspect a state mid-move, assert on the UI)

Write a throwaway spec in `e2e/` against `startGame`, run it, delete it:

```ts
// e2e/tmp-drive.spec.ts   →   npx playwright test tmp-drive
import { test, expect } from '@playwright/test';
import { startGame } from './helpers/game';
import { clickSquare } from './helpers/board';

test('inspect', async ({ browser }) => {
  const game = await startGame(browser);          // { white, black, play, screenshot, ... }
  await game.playAll(['Ab2-Ab3', 'Ed4-Ed3']);
  await clickSquare(game.white, 'Aa1', 'white');  // select only: shows legal-move dots
  await game.screenshot('rook-selected');

  // Orbit and zoom: left-drag on empty canvas (a click never counts as a drag).
  await game.white.mouse.move(1000, 550);
  await game.white.mouse.down();
  await game.white.mouse.move(700, 480, { steps: 20 });
  await game.white.mouse.up();
  await game.white.mouse.wheel(0, -400);          // negative deltaY zooms in; distance clamps 6–25
  await game.screenshot('rotated');

  await expect(game.white.getByText('White to move')).toBeVisible();
  await game.close();
});
```

`helpers/game.ts` — `startGame(browser)` returns a `Game`:

| member | what it does |
|---|---|
| `white`, `black`, `page(seat)` | the Playwright page holding each seat (the creator's colour is random; this is already resolved) |
| `play(from, to)` | select, wait for the destination to become legal, click, wait for both clients to flip the turn |
| `playAll([...])` | `play` in sequence; items are `'Ab2-Ab3'` or `['Ab2','Ab3']` |
| `turn()` | `'white'` or `'black'` from the turn indicator |
| `screenshot(name, seat?)` | writes `test-results/<name>.png` from that seat's view |

`helpers/board.ts` — lower level: `clickSquare(page, zxy, seat)`,
`waitForDestination(page, zxy, seat)`, `getPlayerColor(page)`,
`waitForBoard(page)`. When using `clickSquare` directly for a move,
call `waitForDestination` between the two clicks: the selection and
the destination are separate React commits, and a click sent straight
after the selection can be raycast against the pre-selection scene and
silently do nothing. `clickSquare` projects through the live camera at
click time, so it works from any orbited angle without a settle wait.

## Test

```bash
npm run lint && npm run test        # eslint + vitest
uv run --project ../server pytest   # spawns a real uvicorn
npm run e2e                         # 2 specs; drive.spec is skipped without DRIVE_MOVES
```

Vitest prints `<meshStandardMaterial /> is using incorrect casing`
warnings; pre-existing noise, not failures.

## Gotchas

- **Two browser contexts, never two tabs.** The seat persists in
  `localStorage` per game id, so a second tab rejoins the first tab's
  seat. `startGame` does this for you.
- **Board orientation flips per seat.** Pass the clicking page's own
  seat to `clickSquare`, or you click mirrored squares.
- **Click projection relies on `window.__r3fState`**, published by the
  Canvas `onCreated` hook in `src/screens/GameScreen.tsx`. If it is
  removed, every helper throws `window.__r3fState missing`.
- **The board only mounts once both players are seated.** A single page
  waits forever; there is nothing to screenshot before the join.
- **`VITE_WS_URL` is inlined when Vite starts.** The Playwright
  `webServer` sets it to the local backend. If you start `npm run dev`
  by hand without it, the app talks to the production Modal backend.

## Troubleshooting

- **"Executable doesn't exist" / "run playwright install" banner**: the
  container build mismatch above. Set the env var; do not install.
- **webServer timeout on port 8000**: run `uv sync --extra test` in
  `../server` once, and check nothing else holds the port
  (`lsof -ti:8000 -sTCP:LISTEN`). Same for 5173 and Vite.
- **`play()` times out waiting for the destination**: the move is
  illegal for the side to move, or the piece is not on `from`. Check
  `turn()` and the previous screenshot.
