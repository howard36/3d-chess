import { test, expect } from '@playwright/test';
import { clickSquare, getPlayerColor, waitForBoard } from './helpers/board';
import type { Orientation } from './helpers/board';

// Plays the opening moves of a real two-player game by clicking the WebGL
// canvas: piece, then highlighted destination. Covers the full loop — canvas
// raycast -> client engine -> WebSocket -> server relay -> both clients
// re-deriving the board from the move log.
test('two players each play a move by clicking the board', async ({ browser }) => {
  // Two browser *contexts*, not tabs: the seat colour is persisted in
  // localStorage per game id, so tabs in one context would share a seat.
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  // Creator starts a game, joiner follows the shared link.
  await pageA.goto('/');
  await pageA.getByRole('button', { name: 'Start New Game' }).click();
  await pageA.waitForURL(/\/game\/[A-Z0-9]+/);
  await pageB.goto(pageA.url());
  await pageB.getByRole('button', { name: 'Join Game' }).click();

  await waitForBoard(pageA);
  await waitForBoard(pageB);

  const bySeat = {} as Record<Orientation, typeof pageA>;
  for (const page of [pageA, pageB]) {
    bySeat[await getPlayerColor(page)] = page;
  }
  expect(bySeat.white).toBeTruthy();
  expect(bySeat.black).toBeTruthy();

  await expect(pageA.getByText('White to move')).toBeVisible();

  // White: pawn Ab2 one step forward. Select, then click the destination.
  await clickSquare(bySeat.white, 'Ab2', 'white');
  await clickSquare(bySeat.white, 'Ab3', 'white');

  // The move round-trips through the server; both clients flip the turn.
  await expect(bySeat.white.getByText('Black to move')).toBeVisible();
  await expect(bySeat.black.getByText('Black to move')).toBeVisible();

  // Black replies in kind (Ed4 -> Ed3), proving the mirrored-orientation
  // projection and the reverse relay direction both work.
  await clickSquare(bySeat.black, 'Ed4', 'black');
  await clickSquare(bySeat.black, 'Ed3', 'black');

  await expect(bySeat.white.getByText('White to move')).toBeVisible();
  await expect(bySeat.black.getByText('White to move')).toBeVisible();

  await contextA.close();
  await contextB.close();
});
