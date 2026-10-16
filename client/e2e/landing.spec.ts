import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// The start page's preview: its picture from the first render, the live
// preview faded in over it, and then the games and the turn under way. The
// canvas draws on demand, so a part that sets off without asking for a frame
// leaves the page standing still on its first one.

test.use({ reducedMotion: 'no-preference' });

/** The picture on the page, decoded: a box alone is visible even when its file is missing. */
async function expectPicture(page: Page) {
  const img = page.getByTestId('landing-picture').locator('img');
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0))
    .toBe(true);
}

test('the preview fades in over its picture, and then plays', async ({ page }) => {
  await page.goto('/');
  await expectPicture(page);
  const preview = page.locator('.landing-preview');
  // Faded in (software rendering draws the first frames slowly), and the
  // picture gone from under it
  await expect(preview).toHaveCSS('opacity', '1', { timeout: 90_000 });
  await expect(page.getByTestId('landing-picture')).toHaveCount(0);
  const canvas = page.getByTestId('landing-canvas');
  const first = await canvas.screenshot();
  // The camera turns from the first frame after the fade (the first move
  // comes a few seconds later)
  await expect
    .poll(async () => !(await canvas.screenshot()).equals(first), { timeout: 30_000 })
    .toBe(true);
});

test('for a player who asked for less motion, the picture is all there is', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/');
  await expectPicture(page);
  await page.waitForTimeout(2000);
  await expect(page.getByTestId('landing-canvas')).toHaveCount(0);
  await context.close();
});

// r3f mounts a canvas's scene within the canvas's own commit, so a page
// left the moment its canvas comes (the preview's, the tutorial's) has
// nothing left to connect its events to a gone container
test('leaving the start page or the tutorial the moment its canvas comes throws nothing', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (let i = 0; i < 3; i++) {
    await page.goto('/');
    await page.getByTestId('landing-canvas').waitFor({ state: 'attached' });
    await page.getByRole('button', { name: 'How to play' }).click();
    await page.getByTestId('learn-canvas').waitFor({ state: 'attached' });
    await page.goBack();
    await page.getByTestId('landing-canvas').waitFor({ state: 'attached' });
  }
  // Long enough for a late first commit to land
  await page.waitForTimeout(1000);
  expect(errors).toEqual([]);
});
