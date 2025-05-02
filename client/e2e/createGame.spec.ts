import { test, expect } from '@playwright/test';

test('create game flow', async ({ page }) => {
  // Navigate to the start screen
  await page.goto('/');

  // Check if the start button is visible
  const startButton = page.getByRole('button', { name: 'Start New Game' });
  await expect(startButton).toBeVisible();

  // Click the start button
  await startButton.click();

  // Wait for navigation and check the URL
  // It should match /game/ followed by some ID
  const gameUrlRegex = /^http:\/\/localhost:\d+\/game\/[^/]+/; // Looser regex: matches /game/ followed by any non-slash characters
  await page.waitForURL(gameUrlRegex);
  expect(page.url()).toMatch(gameUrlRegex);

  // Check if the game screen content (placeholder) is visible
  const gameScreenTitle = page.getByRole('heading', { name: 'Game Screen' });
  await expect(gameScreenTitle).toBeVisible();

  const emptyBoard = page.getByTestId('empty-board');
  await expect(emptyBoard).toHaveText('Empty Board Placeholder');
});
