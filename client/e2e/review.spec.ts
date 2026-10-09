import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { startGame } from './helpers/game';
import { clickSquare } from './helpers/board';

// Stepping back through a game with the move history: a move in the list
// shows the board as it stood after it, the board takes no move there, the
// arrows step on to the live position, a move landing meanwhile leaves the
// view where it is, and a move is played again once back at the latest.

/** The piece on a square as the 3D board draws it ("white pawn"), or null. */
const pieceOn = (page: Page, zxy: string) =>
  page.evaluate((target) => {
    type Obj = {
      name?: string;
      position: { x: number; y: number; z: number };
      userData: Record<string, unknown>;
      children: Obj[];
      traverse(cb: (o: Obj) => void): void;
    };
    const state = (window as Window & { __r3fState?: { get(): { scene: Obj } } }).__r3fState;
    let grid: Obj | null = null;
    state!.get().scene.traverse((o) => {
      if (o.name === 'board-grid') grid = o;
    });
    const at = (o: Obj) =>
      [o.position.x, o.position.y, o.position.z].map((v) => v.toFixed(3)).join();
    // Each cell's box stands at its square, as each piece does (a gliding
    // piece within its glide's wrapper, at rest by the time this is read)
    let square: string | null = null;
    for (const o of (grid as unknown as Obj).children) {
      if (o.userData.cube && o.userData.zxy === target) square = at(o);
    }
    let found: string | null = null;
    (grid as unknown as Obj).traverse((o) => {
      const piece = o.userData.piece as { type: string; color: string } | undefined;
      if (piece && at(o) === square) found = `${piece.color} ${piece.type.toLowerCase()}`;
    });
    return found;
  }, zxy);

/** Whether the board shows any destination (a piece picked up). */
const anyDestination = (page: Page) =>
  page.evaluate(() => {
    type Obj = { userData: Record<string, unknown> };
    const state = (
      window as Window & {
        __r3fState?: { get(): { scene: { traverse(cb: (o: Obj) => void): void } } };
      }
    ).__r3fState;
    let found = false;
    state!.get().scene.traverse((o) => {
      if (o.userData.cube && o.userData.highlight) found = true;
    });
    return found;
  });

test('the move history steps back through the game and on to the live position', async ({
  browser,
}) => {
  const game = await startGame(browser);
  const { white, black } = game;
  await game.playAll(['Bb1-Cb1', 'Dd5-Cd5', 'Cb1-Db1']);
  const history = (page: Page) => page.getByTestId('move-history');
  await expect(history(white)).toHaveAttribute('data-viewing-ply', '3');
  await expect(history(white)).not.toHaveAttribute('data-review');

  // Black, to move, looks back at the position after White's first move:
  // their pawn still on Dd5, and the board takes no move there
  await black.locator('[data-ply="1"]').click();
  await expect(history(black)).toHaveAttribute('data-viewing-ply', '1');
  await expect(history(black)).toHaveAttribute('data-review', 'true');
  await expect.poll(() => pieceOn(black, 'Dd5')).toBe('black pawn');
  await expect.poll(() => pieceOn(black, 'Cd5')).toBe(null);
  expect(await pieceOn(black, 'Cb1')).toBe('white pawn');
  await clickSquare(black, 'Dd5', 'black');
  await black.waitForTimeout(500);
  expect(await anyDestination(black)).toBe(false);
  // The pill still says whose move it is in the game
  await expect(black.getByTestId('turn-indicator')).toHaveAttribute('data-turn', 'black');

  // White steps on with the arrow key, to Black's reply
  await white.locator('[data-ply="1"]').click();
  await expect(history(white)).toHaveAttribute('data-viewing-ply', '1');
  await white.keyboard.press('ArrowRight');
  await expect(history(white)).toHaveAttribute('data-viewing-ply', '2');
  await expect.poll(() => pieceOn(white, 'Cd5')).toBe('black pawn');
  await expect.poll(() => pieceOn(white, 'Db1')).toBe(null);

  // Black goes back to the game (End) and plays; White's view stays where it
  // is, the way back marking the newer move
  await black.keyboard.press('End');
  await expect(history(black)).not.toHaveAttribute('data-review');
  // (The canvas draws the live position a moment after the HUD says so)
  await expect.poll(() => pieceOn(black, 'Cd5')).toBe('black pawn');
  await game.play('Ed5', 'Cc5');
  await expect(history(white)).toHaveAttribute('data-viewing-ply', '2');
  await expect(white.locator('.hud-latest')).toHaveAttribute('data-newer', 'true');
  expect(await pieceOn(white, 'Cc5')).toBe(null);

  // On to the live position, and White plays from it
  await white.keyboard.press('ArrowRight');
  await expect(history(white)).toHaveAttribute('data-viewing-ply', '3');
  await white.getByRole('button', { name: 'Latest' }).click();
  await expect(history(white)).toHaveAttribute('data-viewing-ply', '4');
  await expect(history(white)).not.toHaveAttribute('data-review');
  await expect.poll(() => pieceOn(white, 'Cc5')).toBe('black knight');
  await game.play('Ab1', 'Cc1');
  await expect(history(black)).toHaveAttribute('data-viewing-ply', '5');

  await game.close();
});

test('on a phone the steps stand under the tower, the list a tap away', async ({ browser }) => {
  const game = await startGame(browser);
  const { white } = game;
  await white.setViewportSize({ width: 390, height: 844 });
  await game.playAll(['Bb1-Cb1', 'Dd5-Cd5']);
  const history = white.getByTestId('move-history');
  // Closed: the list out of sight, but in the page for screen readers
  await expect(white.getByTestId('move-list')).toHaveClass(/sr-only/);
  await white.getByRole('button', { name: 'Back' }).click();
  await expect(history).toHaveAttribute('data-viewing-ply', '1');
  await expect.poll(() => pieceOn(white, 'Cd5')).toBe(null);
  // The move shown opens the list, whose moves show the board after them
  await white.getByRole('button', { name: /Move list/ }).click();
  await expect(white.getByTestId('move-list')).not.toHaveClass(/sr-only/);
  await white.locator('[data-ply="2"]').click();
  await expect(history).not.toHaveAttribute('data-review');
  await expect.poll(() => pieceOn(white, 'Cd5')).toBe('black pawn');

  await game.close();
});
