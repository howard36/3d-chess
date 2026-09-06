import { test, expect } from '@playwright/test';
import { startGame } from './helpers/game';

// Plays the opening moves of a real two-player game by clicking the WebGL
// canvas: piece, then highlighted destination. Covers the full loop — canvas
// raycast -> client engine -> WebSocket -> server relay -> both clients
// re-deriving the board from the move log.
test('two players each play a move by clicking the board', async ({ browser }) => {
  const game = await startGame(browser);
  await expect(game.white.getByText('White to move')).toBeVisible();
  await expect(game.black.getByText('White to move')).toBeVisible();

  // White: pawn Ab2 one step forward. play() waits for both clients to flip
  // the turn, which proves the move round-tripped through the server.
  await game.play('Ab2', 'Ab3');
  expect(await game.turn()).toBe('black');

  // Black replies in kind (Ed4 -> Ed3), proving the mirrored-orientation
  // projection and the reverse relay direction both work.
  await game.play('Ed4', 'Ed3');
  expect(await game.turn()).toBe('white');

  await game.close();
});
