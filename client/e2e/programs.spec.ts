import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { startGame } from './helpers/game';
import { clickSquare, waitForBoard, waitForDestination } from './helpers/board';
import { openStandInGame } from './helpers/standIn';

// A shader program's first draw compiles and links it and waits on the GPU
// (seconds in software): the board warms every mark's program up once it is
// at rest (WarmPrograms), and a mark that goes keeps its program
// (scene/programs.ts). So once warm, nothing a player does links one: not a
// piece picked up and put down, not a move, a capture, check or mate. A new
// kind of mark left out of the warm-up, or a material disposed instead of
// retired, fails here.

// Black mates in two, taking on Bb1 as it does (gameOver.spec.ts)
const MATE = ['Ad1-Ac3', 'Ec4-Cc2', 'Ac2-Ad1', 'Cc2-Bb1'];

/**
 * Counts, from now on, every program the page's WebGL context links, with
 * the start of its fragment shader's main (a released program leaves three's
 * list again, so the list alone could miss one linked and dropped)
 */
const countLinks = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as {
      __r3fState: { get: () => { gl: { getContext: () => WebGL2RenderingContext } } };
      __links: string[];
    };
    const ctx = w.__r3fState.get().gl.getContext();
    const link = ctx.linkProgram.bind(ctx);
    w.__links = [];
    ctx.linkProgram = (program: WebGLProgram) => {
      const shaders = ctx.getAttachedShaders(program) ?? [];
      const src = shaders.map((sh) => ctx.getShaderSource(sh) ?? '').join('\n');
      w.__links.push(src.slice(src.lastIndexOf('void main')).replace(/\s+/g, ' ').slice(0, 80));
      link(program);
    };
  });
const links = (page: Page) =>
  page.evaluate(() => (window as unknown as { __links: string[] }).__links);

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
  for (const page of [game.white, game.black]) await countLinks(page);
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
  expect(await links(game.white)).toEqual([]);
  expect(await links(game.black)).toEqual([]);
  await game.close();
});

test('the board’s first frame links no shader program: they are linked before it', async ({
  page,
}) => {
  // Every program linked, and whether inside a render() (the board's
  // renderer's, wrapped as GameCanvas publishes it for the tests)
  await page.addInitScript(() => {
    const w = window as unknown as {
      __linked: { inRender: boolean }[];
      __renders: number;
      __r3fState?: unknown;
    };
    w.__linked = [];
    w.__renders = 0;
    let rendering = false;
    const link = WebGL2RenderingContext.prototype.linkProgram;
    WebGL2RenderingContext.prototype.linkProgram = function (program: WebGLProgram) {
      w.__linked.push({ inRender: rendering });
      return link.call(this, program);
    };
    let state: { gl: { render: (...a: unknown[]) => void } } | undefined;
    Object.defineProperty(window, '__r3fState', {
      configurable: true,
      get: () => state,
      set: (v: { gl: { render: (...a: unknown[]) => void } }) => {
        state = v;
        const render = v.gl.render;
        v.gl.render = function (...a: unknown[]) {
          rendering = true;
          try {
            return render.apply(this, a);
          } finally {
            rendering = false;
            w.__renders++;
          }
        };
      },
    });
  });
  await openStandInGame(page, 'white', 'FIRSTFRAME');
  await page.waitForFunction(
    () => (window as unknown as { __renders: number }).__renders > 0,
    null,
    { timeout: 120_000 },
  );
  const linked = await page.evaluate(
    () => (window as unknown as { __linked: { inRender: boolean }[] }).__linked,
  );
  // The garden's and the tower's, all of them before the first frame
  expect(linked.length).toBeGreaterThan(20);
  expect(linked.filter((l) => l.inRender)).toEqual([]);
});
