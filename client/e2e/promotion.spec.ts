import { test, expect } from '@playwright/test';
import { startGame } from './helpers/game';
import { clickSquare, waitForDestination } from './helpers/board';

// A pawn reaching a promotion square asks which piece it becomes; the move is
// sent with the chosen piece and both players see it.

// Shortest legal line to a promotion (found with the engine): White's a-file
// pawn takes two steps, then captures forward-up twice, the second onto the
// black rook's square Ea5, which is rank 5 on level E. Black pushes a pawn.
const APPROACH = ['Ba2-Ba3', 'Ee4-Ee3', 'Ba3-Ca3', 'Ee3-Ee2', 'Ca3-Da4', 'Ee2-Ee1'];

test('a promoting pawn lets the player pick the piece', async ({ browser }) => {
  const game = await startGame(browser);
  await game.playAll(APPROACH);

  await clickSquare(game.white, 'Da4', 'white');
  await waitForDestination(game.white, 'Ea5', 'white');
  await clickSquare(game.white, 'Ea5', 'white');

  const dialog = game.white.getByRole('dialog', { name: 'Promote to' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button')).toHaveText([
    'Queen',
    'Rook',
    'Bishop',
    'Knight',
    'Unicorn',
    'Cancel',
  ]);
  // Nothing is sent until a piece is picked
  await expect(game.white.getByText('White to move')).toBeVisible();
  await game.screenshot('promotion-picker', 'white');

  await dialog.getByRole('button', { name: 'Unicorn' }).click();
  await expect(dialog).toHaveCount(0);
  for (const page of [game.white, game.black]) {
    await expect(page.getByText('Black to move')).toBeVisible();
    await expect(page.getByTestId('move-list')).toContainText('Da4–Ea5=U');
  }

  await game.close();
});
