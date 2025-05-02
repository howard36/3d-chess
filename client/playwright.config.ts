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

  // Run your local dev server before starting the tests
  webServer: {
    command: 'npm run dev', // Command to start the dev server
    url: 'http://localhost:5173', // URL to wait for
    reuseExistingServer: !process.env.CI, // Reuse server if not in CI
    timeout: 120 * 1000, // Increase timeout for server start
  },

  use: {
    // Base URL to use in actions like `await page.goto('/')`
    baseURL: 'http://localhost:5173',

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',
  },
});
