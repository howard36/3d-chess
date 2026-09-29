import { defineConfig } from '@playwright/test';

// CI splits the suite over parallel jobs, one per group (E2E_GROUP, the e2e
// matrix in ci.yml): every page draws in software, so the suite is bound by
// the runner's CPU and only more runners make it faster. Playwright's own
// --shard splits by test count, which leaves one job with all the games
// played move by move, so the groups are named here, balanced by their
// measured time. `rest` is every file not named, so a new spec always runs.
// Unset, the whole suite runs.
const GROUPS: Record<string, string[]> = {
  games: ['gameOver', 'promotion'],
  session: ['session', 'playMove', 'createGame'],
};
const named = Object.values(GROUPS)
  .flat()
  .map((name) => `**/${name}.spec.ts`);
const group = process.env.E2E_GROUP;
if (group && group !== 'rest' && !GROUPS[group]) {
  throw new Error(`E2E_GROUP=${group}: expected one of ${[...Object.keys(GROUPS), 'rest']}`);
}
const selection = !group
  ? {}
  : group === 'rest'
    ? { testIgnore: named }
    : { testMatch: GROUPS[group].map((name) => `**/${name}.spec.ts`) };

export default defineConfig({
  testDir: './e2e', // Only run tests in the e2e directory
  ...selection,
  // Tests of one file run side by side too, so a file's tests spread over
  // the workers instead of queueing on one. Each test makes its own game.
  fullyParallel: true,
  // Every page draws the real board in software (SwiftShader, below). A frame
  // of the scene costs a few hundred milliseconds of CPU, several times that
  // on a busy machine, and each move takes several frames on each of a game's
  // two pages, during which a page answers slowly. So a test that plays a few
  // moves needs far longer than the default 30 s, and a page may take longer
  // than the default 5 s to show what a move changed.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  // On CI, retry once so a failure leaves a trace (trace: 'on-first-retry'
  // below), and write the HTML report the workflow uploads on failure. The
  // default reporter never writes playwright-report/, so the upload step
  // used to find nothing.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['dot'], ['html', { open: 'never' }]] : 'list',
  // Start the websocket backend locally (no Modal deploy needed) and the Vite
  // dev server before running the tests. Export VITE_WS_URL to point the app
  // at a different backend (e.g. a deployed Modal app) instead.
  webServer: [
    {
      command:
        'cd ../server && uv run --extra test uvicorn modal_app:create_web_app --factory --host 127.0.0.1 --port 8000',
      url: 'http://127.0.0.1:8000/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
      // Vite inlines import.meta.env.* at startup, so the override must be in
      // the dev server's environment, not the test process's.
      env: { VITE_WS_URL: process.env.VITE_WS_URL ?? 'ws://127.0.0.1:8000/ws' },
    },
  ],

  use: {
    // Base URL to use in actions like `await page.goto('/')`
    baseURL: 'http://localhost:5173',

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',

    launchOptions: {
      // Escape hatch for environments whose Chromium build doesn't match this
      // Playwright version (e.g. sandboxed agent containers with a
      // pre-installed browser at /opt/pw-browsers/chromium): point at that
      // binary instead of running `playwright install`.
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: [
        // Headless Chromium has no GPU; without an explicit software-GL
        // backend, WebGL context creation can fail or silently fall back,
        // leaving three.js with a blank canvas. SwiftShader renders the real
        // scene in software, identically in CI and locally.
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        // Chromium refuses to start as root (containers) with its sandbox on.
        // The suite only ever loads the local dev server, so this is safe.
        '--no-sandbox',
      ],
    },
  },
});
