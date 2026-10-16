import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { clickSquare } from './helpers/board';
import { closeResult, resign, startGame } from './helpers/game';

// The move history, out of sight while the game is on (no list, no steps, the
// arrows step nowhere), and once it is over a way back through it: a move in
// the list shows the board as it stood after it, the board takes no move
// there, and the arrows and the way back step on to the final position.

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

test('the move history waits out the game, then steps back through it', async ({ browser }) => {
  const game = await startGame(browser);
  const { white, black } = game;
  await game.playAll(['Bb1-Cb1', 'Dd5-Cd5', 'Cb1-Db1']);
  const history = (page: Page) => page.getByTestId('move-history');

  // While the game is on: the record in the page for a screen reader, but
  // nothing to see or press, and the arrows step nowhere
  await expect(history(white)).toHaveAttribute('data-hidden', 'true');
  await expect(history(white)).toHaveAttribute('data-viewing-ply', '3');
  await expect(white.getByTestId('move-list')).toContainText('Pawn to Db1');
  await expect(white.locator('[data-ply], .hud-step')).toHaveCount(0);
  await white.keyboard.press('ArrowLeft');
  await white.keyboard.press('Home');
  await expect(history(white)).toHaveAttribute('data-viewing-ply', '3');
  expect(await pieceOn(white, 'Db1')).toBe('white pawn');

  // Black resigns: the record comes into sight with the result
  await resign(black);
  for (const page of [white, black]) {
    await closeResult(page);
    await expect(history(page)).not.toHaveAttribute('data-hidden');
    await expect(page.getByTestId('move-list')).not.toHaveClass(/sr-only/);
  }

  // Black looks back at the position after White's first move: their pawn
  // still on Dd5, and the board takes no move there
  await black.locator('[data-ply="1"]').click();
  await expect(history(black)).toHaveAttribute('data-viewing-ply', '1');
  await expect(history(black)).toHaveAttribute('data-review', 'true');
  await expect.poll(() => pieceOn(black, 'Dd5')).toBe('black pawn');
  await expect.poll(() => pieceOn(black, 'Cd5')).toBe(null);
  expect(await pieceOn(black, 'Cb1')).toBe('white pawn');
  await clickSquare(black, 'Dd5', 'black');
  await black.waitForTimeout(500);
  expect(await anyDestination(black)).toBe(false);
  // The pill still says how the game ended
  await expect(black.getByTestId('turn-indicator')).toHaveAttribute('data-result', 'resignation');

  // White steps on with the arrow key, to Black's reply
  await white.locator('[data-ply="1"]').click();
  await expect(history(white)).toHaveAttribute('data-viewing-ply', '1');
  await white.keyboard.press('ArrowRight');
  await expect(history(white)).toHaveAttribute('data-viewing-ply', '2');
  await expect.poll(() => pieceOn(white, 'Cd5')).toBe('black pawn');
  await expect.poll(() => pieceOn(white, 'Db1')).toBe(null);

  // Back to the end: with the way back for White, End for Black
  await white.getByRole('button', { name: 'Latest' }).click();
  await expect(history(white)).toHaveAttribute('data-viewing-ply', '3');
  await expect(history(white)).not.toHaveAttribute('data-review');
  await expect.poll(() => pieceOn(white, 'Db1')).toBe('white pawn');
  await black.keyboard.press('End');
  await expect(history(black)).not.toHaveAttribute('data-review');
  // (The canvas draws the final position a moment after the HUD says so)
  await expect.poll(() => pieceOn(black, 'Cd5')).toBe('black pawn');

  await game.close();
});

test('on a phone the steps stand under the tower once the game is over, the list a tap away', async ({
  browser,
}) => {
  const game = await startGame(browser);
  const { white } = game;
  await white.setViewportSize({ width: 390, height: 844 });
  await game.playAll(['Bb1-Cb1', 'Dd5-Cd5']);
  const history = white.getByTestId('move-history');
  // While the game is on, no steps under the tower
  await expect(history).toHaveAttribute('data-hidden', 'true');
  await expect(white.getByRole('button', { name: 'Back', exact: true })).toHaveCount(0);
  await resign(white);
  await closeResult(white);
  // Closed: the list out of sight, but in the page for screen readers
  await expect(white.getByTestId('move-list')).toHaveClass(/sr-only/);
  await white.getByRole('button', { name: 'Back', exact: true }).click();
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
