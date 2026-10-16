import { test, expect } from '@playwright/test';
import { waitForBoard } from './helpers/board';

// (Preview) Screenshots the double check in each way of marking the checkers:
// OUT_DIR=<dir> [STYLES=none,lines,...] npx playwright test checkersPreview
test('checkers preview', async ({ browser }) => {
  test.skip(!process.env.OUT_DIR, 'set OUT_DIR to take the screenshots');
  test.setTimeout(300_000);
  const context = await browser.newContext({
    reducedMotion: 'reduce',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto('/computer');
  await page.getByRole('button', { name: /^Black/ }).click();
  await page
    .getByRole('group', { name: 'Difficulty' })
    .getByRole('button', { name: 'Easy' })
    .click();
  await page.waitForURL(/\/computer\/[a-z0-9]+$/);
  await waitForBoard(page);
  await expect(page.getByTestId('move-announcer')).toHaveAttribute('data-move-count', '1', {
    timeout: 20_000,
  });
  const url = page.url();
  const out = process.env.OUT_DIR!;
  for (const style of (process.env.STYLES ?? 'none,lines,rings,glow,path').split(',')) {
    await page.goto(`${url}?demo=doublecheck&checkers=${style}`);
    await waitForBoard(page);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/${style}.png` });
  }
  await context.close();
});
