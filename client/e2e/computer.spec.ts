import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { clickSquare, waitForBoard, waitForDestination } from './helpers/board';

// A game against the computer: the landing page's second button, the side,
// then the computer's level, then a move by clicking the board, answered by the computer's
// own move (its search runs in a worker; nothing goes through the server).

const moveCount = (page: Page) => page.getByTestId('move-announcer');

test('a player plays the computer: a move, and its reply', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Play the computer' }).click();
  await expect(page).toHaveURL(/\/computer$/);
  // The side first; then the level, a choice of three, Medium unless
  // played before
  await page.getByRole('button', { name: /^White/ }).click();
  const levels = page.getByRole('group', { name: 'Difficulty' });
  await expect(page.getByRole('heading', { name: 'Choose difficulty' })).toBeVisible();
  await expect(levels.getByRole('button', { name: 'Medium' })).toBeFocused();
  await levels.getByRole('button', { name: 'Easy' }).click();
  await page.waitForURL(/\/computer\/[a-z0-9]+$/);
  await waitForBoard(page);

  const pill = page.getByTestId('turn-indicator');
  await expect(pill).toHaveAttribute('data-turn', 'white');
  await expect(pill).toContainText('Computer');
  await page.screenshot({ path: 'test-results/computer-start.png' });

  await clickSquare(page, 'Bc2', 'white');
  await waitForDestination(page, 'Cc2');
  await clickSquare(page, 'Cc2', 'white');
  await expect(moveCount(page)).toHaveAttribute('data-last-move', 'Bc2-Cc2');
  // The computer thinks, then plays Black's first move
  await expect(moveCount(page)).toHaveAttribute('data-move-count', '2', { timeout: 20_000 });
  await expect(pill).toHaveAttribute('data-turn', 'white');
  await page.screenshot({ path: 'test-results/computer-reply.png' });

  // A reload comes back to the same game, on the player's move
  await page.reload();
  await waitForBoard(page);
  await expect(moveCount(page)).toHaveAttribute('data-move-count', '2');
  await expect(page.getByTestId('seat')).toHaveAttribute('data-seat', 'white');

  // How to play, from the game, and back to it from the tutorial
  const game = page.url();
  await page.getByRole('button', { name: 'How to play' }).click();
  await expect(page).toHaveURL(/\/learn$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Setup' })).toBeVisible();
  await page.getByRole('button', { name: 'Knight', exact: true }).click();
  await page.getByRole('button', { name: /Game/ }).click();
  await expect(page).toHaveURL(game);
  await waitForBoard(page);
  await expect(moveCount(page)).toHaveAttribute('data-move-count', '2');
  await context.close();
});

test('playing Black, the computer opens the game', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/computer');
  await page.getByRole('button', { name: /^Black/ }).click();
  await page
    .getByRole('group', { name: 'Difficulty' })
    .getByRole('button', { name: 'Hard' })
    .click();
  await page.waitForURL(/\/computer\/[a-z0-9]+$/);
  await waitForBoard(page);
  await expect(page.getByTestId('seat')).toHaveAttribute('data-seat', 'black');
  await expect(moveCount(page)).toHaveAttribute('data-move-count', '1', { timeout: 20_000 });
  await expect(page.getByTestId('turn-indicator')).toHaveAttribute('data-turn', 'black');
  await context.close();
});

test('a computer game that is not stored here says so', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/computer/nosuchgame');
  await expect(page.getByRole('heading', { name: 'No game here' })).toBeVisible();
  await page.getByRole('button', { name: 'Start a new game' }).click();
  await expect(page).toHaveURL(/\/computer$/);
  await context.close();
});
