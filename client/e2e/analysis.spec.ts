import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { waitForIntro } from './helpers/board';
import { openStandInGame } from './helpers/standIn';

// A finished game's review: nothing until "Review", then each position
// searched in the computer's worker (a node budget, so the same marks on any
// machine), the marks in the list, and on a marked move the better move on
// the board and named under the list; in a narrow window, the mark beside
// the move shown. The game is served by a stand-in for the server: Black
// mates in two, after Black's queen walked into a capture White let go.

const MATE = ['Ad1-Ac3', 'Ec4-Cc2', 'Ac2-Ad1', 'Cc2-Bb1'];

test.use({ contextOptions: { reducedMotion: 'reduce' } });

/** Whether the board draws the better move (a mark in its decoration). */
const betterOnBoard = (page: Page) =>
  page.evaluate(() => {
    type Obj = { name?: string; traverse(cb: (o: Obj) => void): void };
    const state = (window as Window & { __r3fState?: { get(): { scene: Obj } } }).__r3fState;
    let decor: Obj | null = null;
    state!.get().scene.traverse((o) => {
      if (o.name === 'board-decor') decor = o;
    });
    let found = false;
    (decor as Obj | null)?.traverse((o) => {
      if (o.name === 'better-move') found = true;
    });
    return found;
  });

test('a finished game is reviewed on asking: its blunders marked, the better move shown', async ({
  page,
}) => {
  await openStandInGame(page, 'white', 'REVIEWED', MATE);
  await waitForIntro(page);
  const history = page.getByTestId('move-history');
  await expect(history).not.toHaveAttribute('data-analysis');

  await page.getByRole('dialog').getByRole('button', { name: 'Review' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(history).toHaveAttribute('data-analysis', /running|done/);
  await expect(history).toHaveAttribute('data-analysis', 'done', { timeout: 30_000 });
  // Black's queen into a capture, and White letting it go into a mate in one
  await expect(page.locator('[data-ply="2"]')).toHaveAttribute('data-grade', 'blunder');
  await expect(page.locator('[data-ply="3"]')).toHaveAttribute('data-grade', 'blunder');
  await expect(page.locator('[data-ply="1"]')).not.toHaveAttribute('data-grade');
  await expect(page.locator('[data-ply="4"]')).not.toHaveAttribute('data-grade');
  for (const side of ['white', 'black']) {
    await expect(
      page.locator(`.hud-counts[data-side="${side}"] .hud-count[data-grade="blunder"]`),
    ).toHaveAttribute('data-count', '1');
  }

  // At the end (the mate, the best move): nothing more on the board, the
  // score the result
  await expect(history).not.toHaveAttribute('data-best');
  await expect(history).toHaveAttribute('data-evaluation', '0-1');
  expect(await betterOnBoard(page)).toBe(false);
  // White's blunder: the queen there for the taking
  await page.locator('[data-ply="3"]').click();
  await expect(history).toHaveAttribute('data-viewing-ply', '3');
  await expect(history).toHaveAttribute('data-best', 'Bc1-Cc2');
  await expect(page.getByTestId('best-move')).toBeVisible();
  await expect.poll(() => betterOnBoard(page)).toBe(true);
  // ...after which Black mates in one, on the game's graph beside the tower
  await expect(history).toHaveAttribute('data-evaluation', '#-1');
  await expect(page.locator('.hud-graph-score')).toHaveText('#\u22121');
  // An unmarked move keeps the board quiet
  await page.locator('[data-ply="1"]').click();
  await expect(history).not.toHaveAttribute('data-best');
  await expect.poll(() => betterOnBoard(page)).toBe(false);

  // On a phone the mark stands beside the move shown, the better move on the board
  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(history).toHaveAttribute('data-viewing-ply', '3');
  await expect(page.locator('.hud-now .hud-mark[data-grade="blunder"]')).toBeVisible();
  // ...and the score beside it, with no graph and, the list closed, no bar
  await expect(page.locator('.hud-now .hud-score')).toHaveText('#\u22121');
  await expect(page.getByTestId('advantage-graph')).toHaveCount(0);
  await expect(page.getByTestId('evaluation-bar')).toHaveCount(0);
  await expect(page.getByTestId('best-move')).toHaveCount(0);
  await expect.poll(() => betterOnBoard(page)).toBe(true);
  // ...and the list opened above the steps carries every mark
  await page.locator('.hud-now').click();
  await expect(page.locator('[data-ply="2"] .hud-mark')).toBeVisible();
  await expect(page.getByTestId('evaluation-bar')).toBeVisible();
  await expect(page.getByTestId('best-move')).toBeVisible();
  // Every mark as large as its move's words, its "?" and "!" as tall as their capitals
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll('.hud-ply .hud-mark, .hud-now .hud-mark')].map((mark) => [
      getComputedStyle(mark).fontSize,
      getComputedStyle(mark.parentElement!).fontSize,
    ]),
  );
  expect(sizes.length).toBeGreaterThan(1);
  for (const [mark, words] of sizes) expect(mark).toBe(words);
  // The move shown reads the same at the latest move as at an earlier one:
  // only the steps that go nowhere are dimmed
  const shown = page.locator('.hud-now');
  const earlier = await shown.evaluate((el) => getComputedStyle(el).color);
  await page.keyboard.press('End');
  await expect(history).not.toHaveAttribute('data-review');
  expect(await shown.evaluate((el) => getComputedStyle(el).color)).toBe(earlier);
});
