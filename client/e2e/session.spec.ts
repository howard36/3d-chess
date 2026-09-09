import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { startGame } from './helpers/game';
import { clickSquare, waitForBoard, waitForDestination } from './helpers/board';
import type { Orientation } from './helpers/board';

// The session layer: a seat survives a reload, and a second tab of the same
// game takes the seat over cleanly instead of the two tabs evicting each
// other forever.

/** Plays one move from `page` (seated as `seat`) without the Game helper. */
async function playFrom(page: Page, seat: Orientation, from: string, to: string) {
  await clickSquare(page, from, seat);
  await waitForDestination(page, to, seat);
  await clickSquare(page, to, seat);
}

test('a reloaded page rejoins its seat and restores the position', async ({ browser }) => {
  const game = await startGame(browser);
  await game.play('Ab2', 'Ab3');

  await game.white.reload();
  await waitForBoard(game.white);

  // Same seat, same position: role from localStorage, history from game_state
  await expect(game.white.getByText('You are playing as white.')).toBeVisible();
  await expect(game.white.getByText('Black to move')).toBeVisible();
  await expect(game.white.getByTestId('move-list')).toContainText('Ab2–Ab3');

  // The restored session is live: the opponent's next move arrives, and the
  // reloaded player can answer it.
  await game.play('Ed4', 'Ed3');
  await game.play('Ab3', 'Ab4');
  await expect(game.white.getByTestId('move-list')).toContainText('Ab3–Ab4');

  await game.close();
});

test('a second tab takes the seat over; the first stops reconnecting until asked', async ({
  browser,
}) => {
  const game = await startGame(browser);
  const first = game.white;
  const noticeIn = (page: Page) =>
    page.getByRole('alertdialog', { name: 'This game is open in another tab' });

  // Same browser context => same localStorage => same stored seat
  const second = await first.context().newPage();
  await second.goto(first.url());
  await waitForBoard(second);
  await expect(second.getByText('You are playing as white.')).toBeVisible();

  // The first tab was evicted by the server and must say so, not retry.
  await expect(noticeIn(first)).toBeVisible();

  // Before the fix the two tabs swapped the seat every ~500ms. Hold for a few
  // backoff periods and check the roles are stable.
  await first.waitForTimeout(2000);
  await expect(noticeIn(first)).toBeVisible();
  await expect(second.getByRole('alertdialog')).toHaveCount(0);
  await expect(second.getByText('Reconnecting…')).toHaveCount(0);

  // The second tab holds a working seat: it moves, the opponent sees it and
  // replies, and the second tab sees the reply.
  await playFrom(second, 'white', 'Ab2', 'Ab3');
  await expect(game.black.getByText('Black to move')).toBeVisible();
  await playFrom(game.black, 'black', 'Ed4', 'Ed3');
  await expect(second.getByText('White to move')).toBeVisible();

  // Take the game back in the first tab: it rejoins with the full history,
  // and now the second tab is the one told to stand down.
  await first.getByRole('button', { name: 'Play here' }).click();
  await expect(noticeIn(first)).toHaveCount(0);
  await expect(noticeIn(second)).toBeVisible();
  await expect(first.getByText('White to move')).toBeVisible();
  await expect(first.getByTestId('move-list')).toContainText('Ed4–Ed3');
  await first.waitForTimeout(1500);
  await expect(noticeIn(second)).toBeVisible();
  await expect(first.getByRole('alertdialog')).toHaveCount(0);

  // ...and the first tab's seat is live again.
  await game.play('Ab3', 'Ab4');
  await expect(game.black.getByTestId('move-list')).toContainText('Ab3–Ab4');

  await second.close();
  await game.close();
});
