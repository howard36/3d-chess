import { test, expect } from '@playwright/test';
import { startGame } from './helpers/game';

// The end of a game: both players see the result, and "Start new game" takes
// each of them to a fresh side choice that stays put. The creator used to be
// bounced straight back into the finished game, because the start screen saw
// that game's game_created still in the log and treated it as the reply to a
// new request.

// Shortest cooperative mate from the starting position (found by exhaustive
// search with the engine): Black's queen lands on Bb1, defended along the
// Db3-Cb2 diagonal, and every other neighbour of White's king is White's own.
const MATE = ['Ad1-Ac3', 'Ec4-Cc2', 'Ac2-Ad1', 'Cc2-Bb1'];

test('a finished game shows the result and lets both players start over', async ({ browser }) => {
  const game = await startGame(browser);
  await game.playAll(MATE);

  // Each is told the result from their own side, in the dialog and the pill
  for (const [page, verdict] of [
    [game.white, 'You lose'],
    [game.black, 'You win'],
  ] as const) {
    // The card waits for the mated king to fall on the board; drawn in
    // software on a busy machine that can take up to the page's 12 s fallback
    await expect(page.getByRole('dialog', { name: verdict })).toBeVisible({ timeout: 30_000 });
    const pill = page.getByTestId('turn-indicator');
    await expect(pill).toHaveAttribute('data-result', 'checkmate');
    await expect(pill).toHaveAttribute('data-winner', 'black');
    await expect(pill).toContainText(`Checkmate · ${verdict.toLowerCase()}`);
  }

  const oldUrl = game.white.url();
  for (const page of [game.white, game.black]) {
    await page.getByRole('button', { name: 'Start new game' }).click();
    await expect(page.getByRole('heading', { name: 'Choose your side' })).toBeVisible();
    // The bounce happened within the first render of the next page; hold a
    // moment and make sure the page is still there and the old game is gone.
    await page.waitForTimeout(1000);
    await expect(page).toHaveURL(/\/new$/);
    await expect(page.getByTestId('end-game')).toHaveCount(0);
  }

  // The session is fresh: choosing a side from here starts a new game.
  await game.white.getByRole('button', { name: /^White/ }).click();
  await game.white.waitForURL(/\/game\/[A-Z0-9]+/);
  expect(game.white.url()).not.toBe(oldUrl);
  await expect(game.white.getByTestId('invite-card')).toBeVisible();

  await game.close();
});
