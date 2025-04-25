import { test, expect } from '@playwright/test';

// Assumes dev server is running on http://localhost:5173

test('homepage title includes Vite + React', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await expect(page).toHaveTitle(/Vite \+ React/);
});
