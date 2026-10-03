import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { clickSquare, waitForBoard, waitForDestination } from './helpers/board';

// A game against the computer: the landing page's second button, the side
// and level, then a move by clicking the board, answered by the computer's
// own move (its search runs in a worker; nothing goes through the server).

const moveCount = (page: Page) => page.getByTestId('move-announcer');

test('a player plays the computer: a move, and its reply', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Play the computer' }).click();
  await expect(page).toHaveURL(/\/computer$/);
  // The level is a choice of three; Medium unless picked before
  const easy = page.getByRole('radio', { name: 'Easy' });
  await expect(page.getByRole('radio', { name: 'Medium' })).toBeChecked();
  await easy.check();
  await page.getByRole('button', { name: /^White/ }).click();
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
  await context.close();
});

test('playing Black, the computer opens the game', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/computer');
  await page.getByRole('radio', { name: 'Hard' }).check();
  await page.getByRole('button', { name: /^Black/ }).click();
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
