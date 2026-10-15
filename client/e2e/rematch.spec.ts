import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resign, startGame } from './helpers/game';
import { clickSquare, getPlayerColor, waitForBoard, waitForDestination } from './helpers/board';

// A rematch between friends: offered from the result card, declined, offered
// back and accepted, which takes both players straight into a new game with
// the colours swapped. The finished game, opened again, leads to it.

const go = (page: Page) => page.getByTestId('rematch-go');

test('a rematch declined, offered back and accepted swaps the colours', async ({ browser }) => {
  const game = await startGame(browser);
  const { white, black } = game;
  await game.play('Bc2', 'Cc2');
  await resign(white);
  await expect(white.getByRole('dialog', { name: 'You lose' })).toBeVisible();
  await expect(black.getByRole('dialog', { name: 'You win' })).toBeVisible();
  const oldUrl = white.url();

  // White offers; Black declines: White's turns to the way home, Black's stays
  await expect(go(white)).toHaveText('Rematch');
  await go(white).click();
  await expect(go(white)).toHaveAttribute('data-state', 'mine');
  await expect(go(black)).toHaveText('Accept rematch');
  await black.getByRole('button', { name: 'Decline' }).click();
  await expect(white.getByTestId('rematch-declined')).toBeVisible();
  await expect(go(white)).toHaveText('Home');
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

test('against the computer, a rematch starts at once: the same level, the colours swapped', async ({
  browser,
}) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/computer');
  await page.getByRole('button', { name: /^White/ }).click();
  await page
    .getByRole('group', { name: 'Difficulty' })
    .getByRole('button', { name: 'Easy' })
    .click();
  await page.waitForURL(/\/computer\/[a-z0-9]+$/);
  await waitForBoard(page);
  const oldUrl = page.url();
  await resign(page);
  await expect(page.getByRole('dialog', { name: 'You lose' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Home' })).toBeVisible();
  await expect(go(page)).toBeFocused();
  await go(page).click();

  // A new game at once, the player Black: the computer, White now, opens it
  await page.waitForURL(
    (url) => /^\/computer\/[a-z0-9]+$/.test(url.pathname) && url.href !== oldUrl,
  );
  await expect(page.getByTestId('seat')).toHaveAttribute('data-seat', 'black');
  await waitForBoard(page);
  await expect(page.getByTestId('turn-indicator')).toContainText('Computer');
  await expect(page.getByTestId('turn-indicator')).not.toHaveAttribute('data-result');
  await expect(page.getByTestId('move-announcer')).toHaveAttribute('data-move-count', '1', {
    timeout: 20_000,
  });
  await context.close();
});
