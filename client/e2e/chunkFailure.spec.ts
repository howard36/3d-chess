import { test, expect } from '@playwright/test';
import { waitForBoard } from './helpers/board';
import { openStandInGame } from './helpers/standIn';

// The scene's chunks failing to load (a dropped connection, a deploy that
// replaced them): the page goes on without its canvas, never the app's
// "Something went wrong".

test('the start page goes without its preview, its picture standing in', async ({ page }) => {
  let aborted = 0;
  await page.route(/\/src\/screens\/LandingPreview\.tsx/, (route) => {
    aborted++;
    return route.abort('failed');
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '3D Chess' })).toBeVisible();
  // The failure handled (the description becomes the picture's) before the
  // page is judged: the heading shows before the chunk is even asked for
  await expect(page.getByText(/^Preview: the five-level tower, every piece/)).toHaveCount(1);
  await expect(page.getByTestId('landing-picture').locator('img')).toBeVisible();
  expect(aborted).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Play a friend' })).toBeVisible();
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
});

test('a board that fails to load leaves the HUD up, and Retry brings it', async ({ page }) => {
  let blocked = true;
  await page.route(/\/src\/screens\/GameCanvas\.tsx/, (route) =>
    blocked ? route.abort('failed') : route.fallback(),
  );
  await openStandInGame(page, 'white', 'CHUNK0', ['Bb1-Cb1']);

  const notice = page.getByTestId('board-failed');
  await expect(notice).toBeVisible();
  await expect(notice).toHaveText(/Couldn't load the board/);
  await expect(page.getByTestId('turn-indicator')).toHaveAttribute('data-turn', 'black');
  await expect(page.getByTestId('move-announcer')).toHaveAttribute('data-move-count', '1');
  await expect(page.locator('[data-intro]')).toHaveAttribute('data-intro', 'done');
  await expect(page.getByText('Something went wrong')).toHaveCount(0);

  // Where the browser holds on to the failed chunk the retry loads the page
  // afresh; either way the board comes, on the game as it stands
  blocked = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  await waitForBoard(page);
  await expect(notice).toHaveCount(0);
  await expect(page.getByTestId('move-announcer')).toHaveAttribute('data-move-count', '1');
});
