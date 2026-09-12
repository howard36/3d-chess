import { test, expect } from '@playwright/test';
import { startGame } from './helpers/game';

// The end of a game: both players see the result, and "Start new game" takes
// each of them to a fresh start screen that stays put. The creator used to be
// bounced straight back into the finished game, because the start screen saw
// that game's game_created still in the log and treated it as the reply to a
// new request.

// Shortest cooperative mate from the starting position (found by exhaustive
// search with the engine): Black's queen lands on Ab2, defended along the
// Cb4-Bb3 diagonal, and every other neighbour of White's king is White's own.
const MATE = ['Ad1-Cc1', 'Dc5-Bc3', 'Bc1-Ad1', 'Bc3-Ab2'];

test('a finished game shows the result and lets both players start over', async ({ browser }) => {
  const game = await startGame(browser);
  await game.playAll(MATE);

  for (const page of [game.white, game.black]) {
    await expect(page.getByText('Black wins by checkmate!')).toBeVisible();
  }

  const oldUrl = game.white.url();
  for (const page of [game.white, game.black]) {
    await page.getByRole('button', { name: 'Start new game' }).click();
    await expect(page.getByRole('button', { name: 'Start New Game' })).toBeVisible();
    // The bounce happened within the first render of the start screen; hold a
    // moment and make sure the page is still there and the old game is gone.
    await page.waitForTimeout(1000);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText('Black wins by checkmate!')).toHaveCount(0);
  }

  // The session is fresh: creating a game from here starts a new one.
  await game.white.getByRole('button', { name: 'Start New Game' }).click();
  await game.white.waitForURL(/\/game\/[A-Z0-9]+/);
  expect(game.white.url()).not.toBe(oldUrl);
  await expect(game.white.getByText('Game created! Share this link with a friend:')).toBeVisible();

  await game.close();
});
