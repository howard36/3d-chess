import { test, expect } from '@playwright/test';
import { startGame } from './helpers/game';

// Plays the opening moves of a real two-player game by clicking the WebGL
// canvas: piece, then highlighted destination. Covers the full loop — canvas
// raycast -> client engine -> WebSocket -> server relay -> both clients
// re-deriving the board from the move log.
test('two players each play a move by clicking the board', async ({ browser }) => {
  const game = await startGame(browser);
  // Both pills light White's side: "Your move" for White, "Their move" for Black
  await expect(game.white.getByTestId('turn-indicator')).toHaveAttribute('data-turn', 'white');
  await expect(game.black.getByTestId('turn-indicator')).toHaveAttribute('data-turn', 'white');
  await expect(game.white.getByTestId('turn-indicator')).toContainText('Your move');
  await expect(game.black.getByTestId('turn-indicator')).toContainText('Their move');
  // The HUD carries the gear that opens the board's settings
  await expect(game.white.getByTestId('settings')).toBeVisible();

  // White: pawn Bb1 one step up. play() waits for both clients to flip
  // the turn, which proves the move round-tripped through the server.
  await game.play('Bb1', 'Cb1');
  expect(await game.turn()).toBe('black');

  // Black replies in kind (Dd5 -> Cd5), proving the mirrored-orientation
  // projection and the reverse relay direction both work.
  await game.play('Dd5', 'Cd5');
  expect(await game.turn()).toBe('white');

  await game.close();
});

// The keyboard's way to play: Tab reaches the move field (hidden until then),
// Enter sends the move, and it lands on both boards. With the Notation panel on,
// the move card stays on screen with the moves so far.
test('a player can play from the keyboard, and show the moves with the Notation panel', async ({
  browser,
}) => {
  const game = await startGame(browser);
  const white = game.white;
  const field = white.getByRole('textbox', { name: 'Type a move, like Bb1-Cb1' });
  await expect(white.getByTestId('move-card')).toHaveAttribute('data-hidden', '');
  for (let i = 0; i < 5; i++) {
    if (await field.evaluate((el) => el === document.activeElement)) break;
    await white.keyboard.press('Tab');
  }
  await expect(field).toBeFocused();
  await expect(white.getByTestId('move-card')).not.toHaveAttribute('data-hidden');
  await white.keyboard.type('Bb1-Cb1');
  await white.keyboard.press('Enter');
  for (const page of [game.white, game.black]) {
    await expect(page.getByTestId('turn-indicator')).toHaveAttribute('data-turn', 'black');
    await expect(page.getByTestId('move-announcer')).toHaveAttribute('data-last-move', 'Bb1-Cb1');
  }

  // The Notation panel, from the settings panel: the card and its list stay shown
  const black = game.black;
  await black.getByTestId('settings').click();
  await black.getByRole('switch', { name: 'Notation panel' }).click();
  await black.getByRole('button', { name: 'Close settings' }).click();
  await expect(black.getByTestId('move-card')).not.toHaveAttribute('data-hidden');
  await expect(black.getByRole('list', { name: 'Move history' })).toBeVisible();
  await expect(black.getByRole('list', { name: 'Move history' })).toContainText('Bb1–Cb1');

  await game.close();
});
