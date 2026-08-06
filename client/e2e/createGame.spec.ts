import { test, expect } from '@playwright/test';

// Requires the websocket backend to be reachable (the deployed Modal app by
// default, or a local server via VITE_WS_URL).
test('create game flow', async ({ page }) => {
  // Navigate to the start screen
  await page.goto('/');

  // Check if the start button is visible
  const startButton = page.getByRole('button', { name: 'Start New Game' });
  await expect(startButton).toBeVisible();

  // Click the start button
  await startButton.click();

  // The server's game_created response navigates to the game page
  const gameUrlRegex = /^http:\/\/localhost:\d+\/game\/[A-Z0-9]+/;
  await page.waitForURL(gameUrlRegex);
  expect(page.url()).toMatch(gameUrlRegex);

  // The creator sees the shareable game link
  await expect(page.getByText('Game created! Share this link with a friend:')).toBeVisible();
  const gameId = page.url().split('/game/')[1];
  await expect(page.getByText(`http://localhost:5173/game/${gameId}`)).toBeVisible();
});
