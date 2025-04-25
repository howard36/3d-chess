import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', // Only run tests in the e2e directory
  // other configurations can be added here if needed
});
