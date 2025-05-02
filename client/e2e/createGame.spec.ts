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
  // It should match /game/game_ followed by some characters
  await page.waitForURL(/^http:\/\/localhost:\d+\/game\/game_[a-z0-9]+/);
  expect(page.url()).toMatch(/^http:\/\/localhost:\d+\/game\/game_[a-z0-9]+/);

  // Check if the game screen content (placeholder) is visible
  const gameScreenTitle = page.getByRole('heading', { name: 'Game Screen' });
  await expect(gameScreenTitle).toBeVisible();

  const emptyBoard = page.getByTestId('empty-board');
  await expect(emptyBoard).toHaveText('Empty Board Placeholder');
});
