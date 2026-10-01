import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { startGame } from './helpers/game';
import { clickSquare, waitForBoard, waitForDestination } from './helpers/board';

// A shader program's first draw compiles and links it and waits on the GPU
// (seconds in software): the board warms every mark's program up once it is
// at rest (WarmPrograms), and a mark that goes keeps its program
// (scene/programs.ts). So once warm, nothing a player does links one: not a
// piece picked up and put down, not a move, a capture, check or mate. A new
// kind of mark left out of the warm-up, or a material disposed instead of
// retired, fails here.

// Black mates in two, taking on Bb1 as it does (gameOver.spec.ts)
const MATE = ['Ad1-Ac3', 'Ec4-Cc2', 'Ac2-Ad1', 'Cc2-Bb1'];

/** The ids of the programs the page's renderer holds (three.js numbers each anew). */
const programs = (page: Page) =>
  page.evaluate(() => {
    const st = (
      window as unknown as {
        __r3fState: { get: () => { gl: { info: { programs: { id: number; name: string }[] } } } };
      }
    ).__r3fState.get();
    return st.gl.info.programs.map((p) => `${p.id} ${p.name}`);
  });

const warm = (page: Page) =>
  page.locator('canvas[data-warm="done"]').waitFor({ state: 'attached', timeout: 120_000 });

test('a whole game links no shader program once the board is warm', async ({ browser }) => {
  // In full motion: under reduced motion a capture burns nothing away and the
  // last move has no shimmer, so their programs would never be asked for.
  // That makes it the slowest spec (about 50 s on 4 cores in software).
  test.setTimeout(360_000);
  const game = await startGame(browser, { motion: 'full' });
  for (const page of [game.white, game.black]) {
    await waitForBoard(page);
    await warm(page);
  }
  const before = await Promise.all([programs(game.white), programs(game.black)]);
  // White picks a knight up (Ab1: its destinations show)...
  await clickSquare(game.white, 'Ab1', 'white');
  await waitForDestination(game.white, 'Aa3');
  await game.white.waitForTimeout(1000);
  // ...and puts it down with a click on empty space beside the tower
  const box = (await game.white.locator('canvas').boundingBox())!;
  await game.white.mouse.click(box.x + box.width * 0.04, box.y + box.height * 0.5);
  // (no destination left on the board: the next click picks up afresh)
  await game.white.waitForFunction(() => {
    const st = (
      window as unknown as {
        __r3fState: {
          get: () => {
            scene: { traverse: (f: (o: { userData: Record<string, unknown> }) => void) => void };
          };
        };
      }
    ).__r3fState.get();
    let held = false;
    st.scene.traverse((o) => {
      if (o.userData.cube && o.userData.highlight) held = true;
    });
    return !held;
  });
  await game.playAll(MATE);
  await expect(game.white.getByTestId('turn-indicator')).toHaveAttribute(
    'data-result',
    'checkmate',
  );
  // The mated king's fall and the card
  await game.white.waitForTimeout(3000);
  const after = await Promise.all([programs(game.white), programs(game.black)]);
  for (const i of [0, 1]) expect(after[i].filter((p) => !before[i].includes(p))).toEqual([]);
  await game.close();
});
