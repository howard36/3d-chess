import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', // Only run tests in the e2e directory
  // Configure projects for major browsers
  // projects: [
  //   {
  //     name: 'chromium',
  //     use: { ...devices['Desktop Chrome'] },
  //   },
  // ],

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
  },
});
