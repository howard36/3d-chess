import { test, expect } from '@playwright/test';

// The start page's preview: its picture from the first render, the live
// preview faded in over it, and then the games and the turn under way. The
// canvas draws on demand, so a part that sets off without asking for a frame
// leaves the page standing still on its first one.

test.use({ reducedMotion: 'no-preference' });

test('the preview fades in over its picture, and then plays', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('landing-picture').locator('img')).toBeVisible();
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
  await expect(page.getByTestId('landing-picture').locator('img')).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(page.getByTestId('landing-canvas')).toHaveCount(0);
  await context.close();
});
