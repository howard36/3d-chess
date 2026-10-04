import { test, expect } from '@playwright/test';

// The tutorial (/learn): the real tower and rules, a lesson per piece. Its
// moves are played in the unit tests (LearnScreen.test.tsx); here, that the
// page loads from the start page and draws its board in a real browser.

test('the start page leads to the tutorial, which draws its board and walks the pieces', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.getByRole('button', { name: 'How the pieces move' }).click();
  await expect(page).toHaveURL(/\/learn$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Rook' })).toBeVisible();
  await expect(page.getByTestId('learn-canvas')).toBeVisible();

  await page.getByRole('button', { name: 'Unicorn', exact: true }).click();
  await expect(page).toHaveURL(/\/learn\/unicorn$/);
  await expect(page.getByText('New', { exact: true })).toBeVisible();
  await expect(page.getByTestId('learn-count')).toHaveAttribute('data-count', '16');

  await page.getByRole('button', { name: 'Next: Queen' }).click();
  await expect(page.getByTestId('learn-count')).toHaveAttribute('data-count', '52');

  await page.getByRole('button', { name: 'Pawn', exact: true }).click();
  await page.getByRole('button', { name: 'Capture', exact: true }).click();
  await expect(page.getByTestId('learn-count')).toHaveAttribute('data-count', '7');

  // A drag turns the view: the board takes it, the page does not move
  const canvas = page.getByTestId('learn-canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.45, { steps: 10 });
  await page.mouse.up();

  // Only the game's canvas publishes the store e2e projects clicks through
  expect(await page.evaluate(() => '__r3fState' in window)).toBe(false);
  expect(errors).toEqual([]);
});
