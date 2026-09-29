---
name: run-3d-chess
description: Run and drive the 3D chess app — play moves on the board, screenshot positions, rotate the view, check that a UI or engine change works in the real app, or run the e2e suite. Use this whenever a task needs to see or interact with the rendered game, even if the user only says "check it works" or "show me"; the board is a WebGL canvas that cannot be driven through the DOM.
---

A 5×5×5 3D-chess web app: Vite/React/three.js client plus a FastAPI
WebSocket relay. The board is a WebGL canvas, so it is driven through
Playwright with helpers in `client/e2e/helpers/` that click squares by
ZXY notation (e.g. `Bb1`) by projecting through the live camera.
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
DRIVE_MOVES="Bb1-Cb1 Dd5-Cd5 Cb1-Db1" npx playwright test drive
```

`e2e/drive.spec.ts` creates a game (the creator picks White on the side
choice), seats two players, plays the moves
in order (sides alternate automatically), and writes
`test-results/drive-0-start.png` plus one screenshot after each move.
It prints each path. `DRIVE_VIEW=black` screenshots from Black's page.
An illegal move fails the run with a timeout waiting for the
destination to light up, so a failure usually means the move is wrong,
not the harness. ~5s from cold.

**Look at the screenshots.** A correct render shows a tower of five
glass levels over a dark garden, porcelain and charcoal Staunton pieces
on it, a move list bottom-right, and the last move's mint line. A blank
canvas means WebGL did not start.

## Custom drives (orbit, inspect a state mid-move, assert on the UI)

Write a throwaway spec in `e2e/` against `startGame`, run it, delete it:

```ts
// e2e/tmp-drive.spec.ts   →   npx playwright test tmp-drive
import { test, expect } from '@playwright/test';
import { startGame } from './helpers/game';
import { clickSquare } from './helpers/board';

test('inspect', async ({ browser }) => {
  const game = await startGame(browser);          // { white, black, play, screenshot, ... }
  // startGame(browser, { side: 'Black' | 'Random' }) has the creator pick another side
  await game.playAll(['Bb1-Cb1', 'Dd5-Cd5']);
  await clickSquare(game.white, 'Ab1', 'white');  // select only: rings its destinations
  await game.screenshot('knight-selected');

  // Orbit and zoom: left-drag on empty canvas (a click never counts as a drag).
  await game.white.mouse.move(1000, 550);
  await game.white.mouse.down();
  await game.white.mouse.move(700, 480, { steps: 20 });
  await game.white.mouse.up();
  await game.white.mouse.wheel(0, -400);          // negative deltaY zooms in, to 0.7–1.5× the fitted distance
  await game.screenshot('rotated');

  await expect(game.white.getByTestId('turn-indicator')).toHaveAttribute('data-turn', 'white');
  await game.close();
});
```

`helpers/game.ts` — `startGame(browser, { side })` walks the real way in
(landing page "Start a game" → `/new` "Choose your side" → the side's
button, White by default → the guest opens the link and clicks "Take
your seat"), waits for both boards (`waitForBoard`: the entrance is over
and the lobby gone), and returns a `Game`:

| member | what it does |
|---|---|
| `white`, `black` | the Playwright page holding each seat (with `side: 'Random'` the creator's colour is up to chance; this is already resolved) |
| `play(from, to)` | select, wait for the destination to become legal, click, wait for both clients to flip the turn |
| `playAll([...])` | `play` in sequence; items are `'Bb1-Cb1'` or `['Bb1','Cb1']` |
| `turn()` | `'white'` or `'black'` from the turn indicator |
| `screenshot(name, seat?)` | writes `test-results/<name>.png` from that seat's view |

`helpers/board.ts` — lower level: `clickSquare(page, zxy, seat)`,
`waitForDestination(page, zxy)`, `getPlayerColor(page)`,
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
npm run e2e                         # drive.spec is skipped without DRIVE_MOVES
```

Vitest prints `The current testing environment is not configured to
support act(...)` warnings from the r3f test renderer; pre-existing
noise, not failures.

## Gotchas

- **Two browser contexts, never two tabs.** The seat persists in
  `localStorage` per game id, so a second tab takes over the first
  tab's seat and the first tab shows a "replaced" notice.
  `startGame` uses two contexts for you.
- **Board orientation turns per seat.** Black sees the tower from the
  other side. `clickSquare` finds the square in the page's own scene, so
  it works from either seat; its `seat` only labels its errors.
- **Click projection relies on `window.__r3fState`**, published by the
  Canvas `onCreated` hook in `src/screens/GameView.tsx` (the game's
  canvas; the lobby's never publishes it). If it is removed, every
  helper throws `window.__r3fState missing`.
- **The board only mounts once both players are seated.** Before that a
  page shows the lobby (the kings on one glass level, `data-testid="lobby-canvas"`):
  the side choice at `/new`, the host's invite card
  (`data-testid="invite-card"`, `data-seat`) or the guest's invitation.
  Screenshot those if the task is about the lobby; there is no board yet.
- **The way in takes a few seconds.** The pick plays out before the page
  moves to the game, and the arrival and the game's entrance play before
  `waitForBoard` returns; `startGame` already waits for all of it.
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
