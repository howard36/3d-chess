import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { getPlayerColor, waitForBoard } from './helpers/board';

// The way into a game: the landing page's button, the side choice, the
// invitation the creator sends, and the invitation as its guest opens it.

const choose = async (page: Page, side: 'White' | 'Black' | 'Random') => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start a game' }).click();
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
  await expect(card).toContainText('You play Black');
  const { origin, pathname } = new URL(page.url());
  await expect(page.getByTestId('share-link')).toHaveAttribute('data-link', `${origin}${pathname}`);
  await expect(
    page.getByRole('status').filter({ hasText: 'Waiting for them to join' }),
  ).toBeVisible();
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
  await guest.getByRole('button', { name: 'Take your seat' }).click();
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
  const gone = await (await browser.newContext()).newPage();
  await gone.goto('/game/NOPE99');
  await expect(gone.getByRole('heading', { name: 'No game here' })).toBeVisible();
  await gone.getByRole('button', { name: 'Start a new game' }).click();
  await expect(gone).toHaveURL(/\/new$/);

  const host = await (await browser.newContext()).newPage();
  const guest = await (await browser.newContext()).newPage();
  const third = await (await browser.newContext()).newPage();
  await choose(host, 'White');
  await guest.goto(host.url());
  await guest.getByRole('button', { name: 'Take your seat' }).click();
  await waitForBoard(guest);
  await third.goto(host.url());
  await expect(third.getByRole('heading', { name: 'This game is taken' })).toBeVisible();
  for (const p of [gone, host, guest, third]) await p.context().close();
});
