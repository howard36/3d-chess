import { test, expect, chromium } from '@playwright/test';

// A browser that gives the page no WebGL (turned off, a blocklisted GPU,
// no GPU since Chrome dropped its software fallback): the 3D scene is left
// out and the rest of the app works, the move box in sight to play by.
test('without WebGL the start page, the tutorial and a game still work', async ({ baseURL }) => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--disable-webgl', '--disable-3d-apis', '--no-sandbox'],
  });
  const page = await browser.newPage({ baseURL });
  try {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Play the computer' })).toBeVisible();
    await expect(page.getByText('Something went wrong')).toHaveCount(0);

    await page.goto('/learn');
    await expect(page.getByRole('heading', { level: 1, name: 'Setup' })).toBeVisible();

    await page.goto('/computer');
    await page.getByRole('button', { name: /^White/ }).click();
    await page
      .getByRole('group', { name: 'Difficulty' })
      .getByRole('button', { name: 'Easy' })
      .click();
    await expect(page.getByTestId('board-failed')).toHaveText(
      'No 3D board: WebGL is off in this browser',
    );
    const field = page.getByRole('textbox', { name: 'Type a move, like Bb1-Cb1' });
    await field.fill('Bb1-Cb1');
    await field.press('Enter');
    await expect(page.getByTestId('move-announcer')).toHaveAttribute('data-move-count', '2');
  } finally {
    await browser.close();
  }
});
