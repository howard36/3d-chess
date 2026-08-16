---
name: run-3d-chess
description: Build, run, and drive the 3D chess app. Use when asked to start the app, launch the client or server locally, run its tests or e2e suite, take a screenshot of the rendered board, or play/interact with the game (clicking pieces, making moves).
---

A 5×5×5 3D-chess web app: Vite/React/three.js client plus a FastAPI
WebSocket relay. Drive it through the Playwright harness in
`client/e2e/` — `helpers/board.ts` clicks board squares on the WebGL
canvas by ZXY notation (e.g. `Ab2`), and Playwright's `webServer`
config boots both the backend and Vite for you. There is no separate
driver script; you write a short throwaway spec against those helpers
(pattern below).

All paths are relative to the repo root.

## Prerequisites

Node ≥ 20 and [uv](https://docs.astral.sh/uv/) — both preinstalled in
Anthropic remote containers. No apt packages needed: the suite runs
headless (SwiftShader flags in `client/playwright.config.ts` provide
software WebGL; no xvfb, no GPU).

## Setup

```bash
cd client && npm ci
cd server && uv sync --extra test
```

## Run (agent path)

**Sanity check the app works end-to-end** (creates a game, joins from a
second browser context, plays a move per side by clicking the canvas):

```bash
cd client && PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium npm run e2e
```

Servers do NOT need to be running — Playwright boots uvicorn and Vite
itself (`webServer` in `playwright.config.ts`) and reuses them if
already up. The env var points Playwright at the container's
preinstalled Chromium; see Gotchas. Expected: 2 tests pass in ~10s
from cold.

**Drive the game ad hoc / screenshot arbitrary positions:** drop a
throwaway spec next to the existing ones and reuse the helpers. This
exact spec was verified to pass:

```bash
cd client && cat > e2e/tmp-drive.spec.ts <<'EOF'
import { test, expect } from '@playwright/test';
import { clickSquare, getPlayerColor, waitForBoard } from './helpers/board';

test('drive the board', async ({ browser }) => {
  const pageA = await (await browser.newContext()).newPage();
  const pageB = await (await browser.newContext()).newPage();
  await pageA.goto('/');
  await pageA.getByRole('button', { name: 'Start New Game' }).click();
  await pageA.waitForURL(/\/game\/[A-Z0-9]+/);
  await pageB.goto(pageA.url());
  await pageB.getByRole('button', { name: 'Join Game' }).click();
  await waitForBoard(pageA);
  await waitForBoard(pageB);

  const white = (await getPlayerColor(pageA)) === 'white' ? pageA : pageB;
  await clickSquare(white, 'Ab2', 'white'); // select the pawn
  await white.screenshot({ path: 'test-results/drive-selected.png' });
  await clickSquare(white, 'Ab3', 'white'); // move it
  await expect(white.getByText('Black to move')).toBeVisible();
  await white.screenshot({ path: 'test-results/drive-after-move.png' });
});
EOF
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium npx playwright test tmp-drive
rm e2e/tmp-drive.spec.ts
```

Screenshots land in `client/test-results/` (gitignored). **Look at
them** — a correct render shows the wireframe 5×5×5 lattice with
Staunton pieces; selecting a piece draws a gold ring under it and dots
on legal destinations.

Helper API (`client/e2e/helpers/board.ts`):

| function | what it does |
|---|---|
| `waitForBoard(page)` | waits until the game canvas has mounted (both players seated) |
| `getPlayerColor(page)` | reads this page's seat (`'white'`/`'black'`) — the creator's colour is random |
| `clickSquare(page, 'Ab2', seat)` | real mouse click on a square, ZXY notation, projected through the live camera |

Moving a piece is always two `clickSquare` calls: the piece, then a
legal destination. Clicks on illegal squares are silently ignored by
the app.

**Manual servers** (only for iterating outside Playwright, e.g. probing
with your own Playwright script):

```bash
cd server && uv run --extra test uvicorn modal_app:create_web_app --factory --host 127.0.0.1 --port 8000 &
cd client && VITE_WS_URL=ws://127.0.0.1:8000/ws npm run dev &
timeout 60 bash -c 'until curl -sf --noproxy "*" http://localhost:5173 >/dev/null; do sleep 1; done'
```

Stop with `lsof -ti:8000 -sTCP:LISTEN | xargs -r kill` (same for 5173).
If writing your own script instead of a spec, launch Chromium with
`executablePath: '/opt/pw-browsers/chromium'` and the same flags as
`playwright.config.ts` `launchOptions.args`, and import Playwright by
absolute path (`/…/3d-chess/node_modules/playwright/index.mjs`) — a
bare `import 'playwright'` fails from outside the repo tree.

## Run (human path)

```bash
cd client && npm run dev   # → http://localhost:5173, uses the deployed Modal backend. Ctrl-C to stop.
```

Set `VITE_WS_URL=ws://127.0.0.1:8000/ws` to use a local backend
instead (see manual servers above). Useless headless — a real game
needs two browsers anyway.

## Test

```bash
cd client && npm run lint && npm run test   # eslint; 9 vitest files, 98 tests
uv run --project server pytest              # 29 tests, spawns a real uvicorn
cd client && PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium npm run e2e
```

Vitest prints `<meshStandardMaterial /> is using incorrect casing`
warnings — pre-existing noise, not failures.

## Gotchas

- **Playwright browser-build mismatch (remote containers).** The
  repo's Playwright resolves a browser build (e.g. 1169) that the
  container image doesn't ship (it has 1194 at
  `/opt/pw-browsers/chromium`). Do NOT run `playwright install` — set
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium`
  (wired into `playwright.config.ts` `launchOptions`). On a normal dev
  machine with matching browsers installed, omit it.
- **Two browser *contexts*, never two tabs.** The seat colour persists
  in `localStorage` keyed by game id; tabs share a context's storage,
  so a second tab auto-rejoins the first tab's seat instead of taking
  the empty one.
- **The creator's colour is random.** Always detect seats via
  `getPlayerColor(page)` (reads the "You are playing as …" label);
  never assume the creator is White.
- **Board orientation flips per seat.** `toWorld` mirrors all three
  axes for Black so each player sees their own army identically. Pass
  the *clicking page's own* seat to `clickSquare`, or you'll click
  mirrored squares on the opponent's half.
- **Click-to-pixel goes through `window.__r3fState`.** r3f v9 doesn't
  expose its store on the canvas element; the Canvas `onCreated` hook
  in `GameScreen.tsx` publishes it, and `clickSquare` projects through
  the live camera at click time (correct even after orbiting). If that
  hook is removed, `clickSquare` throws `window.__r3fState missing`.
- **Don't drag.** A pressed-and-moved mouse is an OrbitControls rotate,
  not a click. `page.mouse.click(x, y)` is safe; avoid `move` between
  down and up.
- **The board only mounts with both players seated.** A single page
  stays on the waiting screen forever — there is nothing to screenshot
  until the second context joins.
- **`VITE_WS_URL` is baked in at dev-server start.** Vite inlines
  `import.meta.env.*`; export it before `npm run dev` (or rely on the
  Playwright `webServer` env), not before the test process.

## Troubleshooting

- **`Executable doesn't exist at /opt/pw-browsers/chromium_headless_shell-1169/...` with a "run playwright install" banner**:
  build mismatch above. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium`; don't install.
- **`Cannot find package 'playwright'` (ERR_MODULE_NOT_FOUND) from a standalone script**:
  Node resolves from the script's location, not cwd. Import by absolute
  path from the repo's `node_modules` (see manual-servers note).
- **e2e webServer timeout on port 8000**: run `cd server && uv sync
  --extra test` once first, and check nothing else holds the port
  (`lsof -ti:8000 -sTCP:LISTEN`).
