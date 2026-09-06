import { test } from '@playwright/test';
import { startGame } from './helpers/game';
import type { Orientation } from './helpers/board';

/**
 * Parameterised driver for looking at the board, not a regression test.
 * Skipped unless DRIVE_MOVES is set, so `npm run e2e` never runs it.
 *
 *   DRIVE_MOVES="Ab2-Ab3 Ed4-Ed3" npx playwright test drive
 *
 * Plays the moves in order (sides alternate automatically) and screenshots
 * the board into test-results/ after each one, plus the starting position.
 * DRIVE_VIEW=black takes the screenshots from Black's page instead.
 */
const moves = (process.env.DRIVE_MOVES ?? '').split(/[\s,]+/).filter(Boolean);
const view = (process.env.DRIVE_VIEW === 'black' ? 'black' : 'white') as Orientation;

test.skip(moves.length === 0, 'set DRIVE_MOVES to use the driver');

test('drive: play moves and screenshot', async ({ browser }) => {
  const game = await startGame(browser);
  console.log(await game.screenshot('drive-0-start', view));
  for (const [i, m] of moves.entries()) {
    const [from, to] = m.split('-');
    await game.play(from, to);
    console.log(await game.screenshot(`drive-${i + 1}-${from}-${to}`, view));
  }
  await game.close();
});
