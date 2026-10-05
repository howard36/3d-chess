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
  await page.getByRole('button', { name: 'How to play' }).click();
  await expect(page).toHaveURL(/\/learn$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Setup' })).toBeVisible();
  await expect(page.getByTestId('learn-canvas')).toBeVisible();

  await page.getByRole('button', { name: 'Next: Rook' }).click();
  await expect(page).toHaveURL(/\/learn\/rook$/);
  await expect(page.getByTestId('learn-count')).toHaveAttribute('data-count', '12');

  await page.getByRole('button', { name: 'Unicorn', exact: true }).click();
  await expect(page).toHaveURL(/\/learn\/unicorn$/);
  await expect(page.getByText('New', { exact: true })).toBeVisible();
  await expect(page.getByTestId('learn-count')).toHaveAttribute('data-count', '16');

  await page.getByRole('button', { name: 'Next: Queen' }).click();
  await expect(page.getByTestId('learn-count')).toHaveAttribute('data-count', '52');

  await page.getByRole('button', { name: 'Pawn', exact: true }).click();
  // Black's pawn, mirroring White's, on the board as it stands
  await page.getByRole('button', { name: 'Next: Black' }).click();
  await expect(page.getByTestId('learn-count')).toHaveAttribute('data-count', '2');
  await page.getByRole('button', { name: 'Next: Capture' }).click();
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

// Every lesson and step, at the sizes the card takes each of its layouts: the
// lesson's words never run into the foot (the count, Reset, Next), nor have
// to scroll above it, nothing runs past the card's sides, and the card stays
// in the window under Home.
const CARD_SIZES = [
  [1280, 800], // beside the tower
  [1024, 768], // along the bottom, wide
  [390, 844], // a phone upright
  [320, 568], // a small phone upright
  [844, 390], // a phone on its side
  [568, 320], // a small phone on its side
] as const;

test('the card holds every lesson with room above its foot, at every size', async ({ page }) => {
  const problems: string[] = [];
  for (const [width, height] of CARD_SIZES) {
    await page.setViewportSize({ width, height });
    for (const lesson of ['', 'rook', 'bishop', 'unicorn', 'queen', 'king', 'knight', 'pawn']) {
      await page.goto(`/learn/${lesson}`);
      await expect(page.locator('.learn-card')).toBeVisible();
      // Measured in the page's own type, not the fallback it shows while that loads
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const steps = await page.locator('.learn-step').count();
      for (let i = 0; i < Math.max(steps, 1); i++) {
        if (steps) await page.locator('.learn-step').nth(i).click();
        const found = await page.evaluate(() => {
          const card = document.querySelector('.learn-card')!.getBoundingClientRect();
          const body = document.querySelector('.learn-body')!;
          let words = 0;
          for (const el of Array.from(body.querySelectorAll('p, figure')))
            words = Math.max(words, el.getBoundingClientRect().bottom);
          let foot = Infinity;
          for (const el of Array.from(document.querySelectorAll('.learn-foot > *')))
            foot = Math.min(foot, el.getBoundingClientRect().top);
          // Nothing in the card runs past its sides
          let spill = 0;
          for (const el of Array.from(
            document.querySelectorAll('.learn-menu, .learn-head > *, .learn-foot > *'),
          )) {
            const b = el.getBoundingClientRect();
            spill = Math.max(spill, b.right - card.right, card.left - b.left);
          }
          return {
            spill: Math.round(spill),
            room: Math.round(foot - words),
            scrolls: body.scrollHeight - body.clientHeight > 1,
            out: card.top < 56 || card.bottom > innerHeight,
          };
        });
        const at = `${width}x${height} ${lesson || 'setup'}${steps ? ` step ${i + 1}` : ''}`;
        if (found.room < 10) problems.push(`${at}: ${found.room} px over the foot`);
        if (found.scrolls) problems.push(`${at}: the lesson scrolls`);
        if (found.out) problems.push(`${at}: the card leaves the window`);
        if (found.spill > 0) problems.push(`${at}: ${found.spill} px past the card's side`);
      }
    }
  }
  expect(problems).toEqual([]);
});
