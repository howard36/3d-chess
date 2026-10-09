import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { getPlayerColor, waitForBoard } from './helpers/board';

// The way into a game: the landing page's button, the side choice, the
// invitation the creator sends, and the invitation as its guest opens it.

const choose = async (page: Page, side: 'White' | 'Black' | 'Random') => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play a friend' }).click();
  await expect(page).toHaveURL(/\/new$/);
  await expect(page.getByRole('heading', { name: 'Choose your side' })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(`^${side}`) }).click();
  await page.waitForURL(/\/game\/[A-Z0-9]+$/);
};

test('the creator picks a side and gets a link to send', async ({ page }) => {
  await choose(page, 'Black');
  const card = page.getByTestId('invite-card');
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('data-seat', 'black');
  const { origin, pathname } = new URL(page.url());
  await expect(page.getByTestId('share-link')).toHaveAttribute('data-link', `${origin}${pathname}`);
  await expect(page.getByRole('heading', { name: 'You play Black' })).toBeVisible();
  await expect(page.getByText('Waiting for your friend…')).toBeVisible();
  // Back leaves the invitation for the landing page, not the side choice
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
});

test('the guest is told their side before taking the seat, and both boards open', async ({
  browser,
}) => {
  const host = await (await browser.newContext()).newPage();
  const guest = await (await browser.newContext()).newPage();
  await choose(host, 'White');
  await guest.goto(host.url());
  await expect(guest.getByRole('heading', { name: "You're invited to play Black" })).toBeVisible();
  await guest.getByRole('button', { name: 'Join game' }).click();
  await waitForBoard(host);
  await waitForBoard(guest);
  expect(await getPlayerColor(host)).toBe('white');
  expect(await getPlayerColor(guest)).toBe('black');
  await host.context().close();
  await guest.context().close();
});

test('Random lands on a side and the invitation offers the other', async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await choose(host, 'Random');
  const seat = await host.getByTestId('invite-card').getAttribute('data-seat');
  expect(seat === 'white' || seat === 'black').toBe(true);
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(host.url());
  const other = seat === 'white' ? 'Black' : 'White';
  await expect(
    guest.getByRole('heading', { name: `You're invited to play ${other}` }),
  ).toBeVisible();
  await host.context().close();
  await guest.context().close();
});

test('an invitation to a game that is full or gone says so', async ({ browser }) => {
  // What the pages say, not how the way in moves: reduced motion keeps its
  // three pages light enough for a busy runner (the handover in full is the
  // test above's)
  const page = async () => (await browser.newContext({ reducedMotion: 'reduce' })).newPage();
  const gone = await page();
  await gone.goto('/game/NOPE99');
  await expect(gone.getByRole('heading', { name: 'No game here' })).toBeVisible();
  await gone.getByRole('button', { name: 'Play a friend' }).click();
  await expect(gone).toHaveURL(/\/new$/);
  await gone.context().close();

  const host = await page();
  const guest = await page();
  const third = await page();
  await choose(host, 'White');
  await guest.goto(host.url());
  await guest.getByRole('button', { name: 'Join game' }).click();
  await waitForBoard(guest);
  await third.goto(host.url());
  await expect(third.getByRole('heading', { name: 'This game is taken' })).toBeVisible();
  for (const p of [host, guest, third]) await p.context().close();
});

test('an address with no page says so, and leads home', async ({ page }) => {
  await page.goto('/game/');
  await expect(page.getByRole('heading', { name: 'Nothing here' })).toBeVisible();
  await page.getByRole('button', { name: 'Home' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('button', { name: 'Play a friend' })).toBeVisible();
});
