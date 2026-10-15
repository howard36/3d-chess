import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { startGame } from './helpers/game';
import { clickSquare, getPlayerColor, waitForBoard, waitForDestination } from './helpers/board';

// A rematch between friends: offered from the result card, declined, offered
// back and accepted, which takes both players straight into a new game with
// the colours swapped. The finished game, opened again, leads to it.

async function resign(page: Page) {
  await page.getByRole('button', { name: 'Resign or offer a draw' }).click();
  await page.getByRole('button', { name: 'Resign', exact: true }).click();
  await expect(page.getByText('Resign?')).toBeVisible();
  // The question ignores a click hard on the heels of the one that asked it
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Resign', exact: true }).click();
}

const go = (page: Page) => page.getByTestId('rematch-go');

test('a rematch declined, offered back and accepted swaps the colours', async ({ browser }) => {
  const game = await startGame(browser);
  const { white, black } = game;
  await game.play('Bc2', 'Cc2');
  await resign(white);
  await expect(white.getByRole('dialog', { name: 'You lose' })).toBeVisible();
  await expect(black.getByRole('dialog', { name: 'You win' })).toBeVisible();
  const oldUrl = white.url();

  // White offers; Black declines: White's turns to a new game, Black's stays
  await expect(go(white)).toHaveText('Rematch');
  await go(white).click();
  await expect(go(white)).toHaveAttribute('data-state', 'mine');
  await expect(go(black)).toHaveText('Accept rematch');
  await black.getByRole('button', { name: 'Decline' }).click();
  await expect(white.getByTestId('rematch-declined')).toBeVisible();
  await expect(go(white)).toHaveText('New game');
  await expect(go(black)).toHaveText('Rematch');

  // Black offers one back, from below the tower, and White accepts
  await black.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await expect(black.getByTestId('rematch')).toHaveAttribute('data-bar');
  await go(black).click();
  await expect(go(white)).toHaveText('Accept rematch');
  await go(white).click();

  // Both are in the new game at once, each in the other colour
  for (const page of [white, black]) {
    await page.waitForURL(
      (url) => /\/game\/[A-Z0-9]{6}$/.test(url.pathname) && url.href !== oldUrl,
    );
    await waitForBoard(page);
    await expect(page.getByTestId('turn-indicator')).toHaveAttribute('data-turn', 'white');
    await expect(page.getByTestId('turn-indicator')).not.toHaveAttribute('data-result');
  }
  expect(white.url()).toBe(black.url());
  expect(await getPlayerColor(white)).toBe('black');
  expect(await getPlayerColor(black)).toBe('white');

  // ...and play it: the old Black opens
  await clickSquare(black, 'Bc2', 'white');
  await waitForDestination(black, 'Cc2');
  await clickSquare(black, 'Cc2', 'white');
  for (const page of [white, black]) {
    await expect(page.getByTestId('move-announcer')).toHaveAttribute('data-last-move', 'Bc2-Cc2');
  }

  // The finished game, opened again, leads to the rematch rather than offer another
  await white.goto(oldUrl);
  await waitForBoard(white);
  await expect(go(white)).toHaveText('Join rematch');
  await go(white).click();
  // (the old game's page, its board up, stands until the new one's replaces it)
  await expect(white.getByTestId('seat')).toHaveAttribute('data-seat', 'black');
  await waitForBoard(white);
  expect(white.url()).toBe(black.url());
  await expect(white.getByTestId('move-announcer')).toHaveAttribute('data-move-count', '1');
  await game.close();
});
