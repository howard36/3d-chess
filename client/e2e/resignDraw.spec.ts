import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { startGame } from './helpers/game';
import { clickSquare, waitForBoard, waitForDestination } from './helpers/board';

// Ending a game by the players' own decision: a resignation, and a draw
// offered and declined, cancelled by a move, then agreed. Both players see
// every step, and a reload comes back to it.

const menu = (page: Page) => page.getByRole('button', { name: 'Resign or offer a draw' });

async function resign(page: Page) {
  await menu(page).click();
  await page.getByRole('button', { name: 'Resign', exact: true }).click();
  await expect(page.getByText('Resign?')).toBeVisible();
  // The question ignores a click hard on the heels of the one that asked it
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Resign', exact: true }).click();
}

async function offerDraw(page: Page) {
  await menu(page).click();
  await page.getByRole('button', { name: 'Offer draw' }).click();
  await expect(page.getByTestId('draw-pending')).toBeVisible();
}

test('a resignation ends the game for both players', async ({ browser }) => {
  const game = await startGame(browser);
  await game.play('Bc2', 'Cc2');
  await resign(game.white);

  for (const [page, verdict] of [
    [game.white, 'You lose'],
    [game.black, 'You win'],
  ] as const) {
    const pill = page.getByTestId('turn-indicator');
    await expect(pill).toHaveAttribute('data-result', 'resignation');
    await expect(pill).toHaveAttribute('data-winner', 'black');
    await expect(pill).toContainText(`White resigned · ${verdict.toLowerCase()}`);
    await expect(page.getByRole('dialog', { name: verdict })).toContainText('White resigned');
    await expect(page.getByTestId('game-actions')).toHaveCount(0);
  }

  // The server keeps the ending: a reload opens on the finished game
  await game.black.reload();
  await waitForBoard(game.black);
  await expect(game.black.getByTestId('turn-indicator')).toHaveAttribute(
    'data-result',
    'resignation',
  );
  await expect(game.black.getByRole('dialog', { name: 'You win' })).toBeVisible();
  await game.close();
});

test('a draw offered, declined, cancelled by a move, then agreed', async ({ browser }) => {
  const game = await startGame(browser);

  // White offers; Black declines, and play goes on
  await offerDraw(game.white);
  const prompt = game.black.getByTestId('draw-offer');
  await expect(prompt).toContainText('Draw offered');
  await prompt.getByRole('button', { name: 'Decline' }).click();
  await expect(prompt).toHaveCount(0);
  await expect(game.white.getByTestId('draw-declined')).toBeVisible();
  await expect(game.white.getByTestId('draw-pending')).toHaveCount(0);
  await game.play('Bc2', 'Cc2');
  await expect(game.white.getByTestId('draw-declined')).toHaveCount(0);

  // White offers again on Black's move; Black plays on instead, which cancels it
  await offerDraw(game.white);
  await expect(prompt).toBeVisible();
  await game.play('Dc4', 'Dc3');
  await expect(prompt).toHaveCount(0);
  await expect(game.white.getByTestId('draw-pending')).toHaveCount(0);

  // Black offers, and the offer stands through a reload of White's page
  await offerDraw(game.black);
  await game.white.reload();
  await waitForBoard(game.white);
  const whitePrompt = game.white.getByTestId('draw-offer');
  await whitePrompt.getByRole('button', { name: 'Accept' }).click();

  for (const page of [game.white, game.black]) {
    const pill = page.getByTestId('turn-indicator');
    await expect(pill).toHaveAttribute('data-result', 'agreement');
    await expect(pill).toContainText('Draw agreed');
    await expect(page.getByRole('dialog', { name: 'Draw' })).toContainText('by agreement');
  }
  await game.close();
});

test('against the computer: it declines an even draw, and takes a resignation', async ({
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

  // Even at the start: declined after a moment's thought
  await offerDraw(page);
  await expect(page.getByTestId('draw-declined')).toBeVisible({ timeout: 20_000 });
  // ...and it plays on
  await clickSquare(page, 'Bc2', 'white');
  await waitForDestination(page, 'Cc2');
  await clickSquare(page, 'Cc2', 'white');
  const announcer = page.getByTestId('move-announcer');
  await expect(announcer).toHaveAttribute('data-move-count', '2', { timeout: 20_000 });

  await resign(page);
  const pill = page.getByTestId('turn-indicator');
  await expect(pill).toHaveAttribute('data-result', 'resignation');
  await expect(pill).toContainText('White resigned · you lose');
  // Kept with the game in the browser
  await page.reload();
  await waitForBoard(page);
  await expect(pill).toHaveAttribute('data-result', 'resignation');
  await context.close();
});
