import { expect, test } from '@playwright/test';
import type { Browser } from '@playwright/test';
import { startGame } from './helpers/game';

// A frame at rest redraws only what changed (three/scene/damage.ts, drawn in
// part by backdropCache.tsx): every such frame must come out exactly as the
// same frame drawn whole. Through a pick, a move gliding in, the opponent's
// reply and the last move's shimmer, the page draws each display frame twice
// in one task (so nothing moves between them), first as the board would, in
// part, then whole, and compares the pixels. Whichever of the board's frame
// and this loop runs first in a display frame, the picture read back after
// the first draw is the board's own frame drawn in part. Only frames whose
// garden came from its copy throughout are compared: a frame that retakes
// the copy draws the garden itself, which may differ from the copy by a step
// where a garden edge meets a tower edge (backdropCache.tsx).

const check = async (
  browser: Browser,
  device: { viewport?: { width: number; height: number }; deviceScaleFactor?: number },
) => {
  const game = await startGame(browser, { motion: 'full', device });
  const page = game.white;
  await page.evaluate(() => {
    type Check = { frames: number; partial: number; differ: number[] };
    const w = window as unknown as {
      __r3fState: {
        gl: import('three').WebGLRenderer;
        scene: import('three').Scene;
        camera: import('three').Camera;
      };
      __damageCheck: Check;
    };
    const check: Check = (w.__damageCheck = { frames: 0, partial: 0, differ: [] });
    const read = (ctx: WebGL2RenderingContext, out: Uint8Array) =>
      ctx.readPixels(
        0,
        0,
        ctx.drawingBufferWidth,
        ctx.drawingBufferHeight,
        ctx.RGBA,
        ctx.UNSIGNED_BYTE,
        out,
      );
    const loop = () => {
      const { gl, scene, camera } = w.__r3fState;
      const ctx = gl.getContext() as WebGL2RenderingContext;
      const size = ctx.drawingBufferWidth * ctx.drawingBufferHeight * 4;
      const inPart = new Uint8Array(size);
      const whole = new Uint8Array(size);
      // The garden drawn from its copy (left shown by the last frame drawn)
      const copy = scene.getObjectByName('backdrop-copy');
      let cached = copy?.visible === true;
      gl.render(scene, camera);
      cached &&= copy?.visible === true;
      if (gl.getScissorTest()) check.partial++;
      gl.setScissorTest(false);
      read(ctx, inPart);
      scene.userData.wholeFrames = true;
      gl.render(scene, camera);
      scene.userData.wholeFrames = false;
      cached &&= copy?.visible === true;
      if (cached) {
        read(ctx, whole);
        let n = 0;
        for (let i = 0; i < size; i++) if (inPart[i] !== whole[i]) n++;
        check.frames++;
        if (n) check.differ.push(n);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  // A quiet move, the reply, then a capture and its recapture
  await game.playAll(['Ad2-Ac3', 'Eb5-Ec3', 'Ab2-Ba3', 'Ed5-Ce5']);
  await page.waitForTimeout(1500);
  const result = await page.evaluate(
    () =>
      (
        window as unknown as {
          __damageCheck: { frames: number; partial: number; differ: number[] };
        }
      ).__damageCheck,
  );
  // Most frames at rest are drawn in part, and none differs from the whole
  expect(result.frames).toBeGreaterThan(20);
  expect(result.partial).toBeGreaterThan(result.frames / 2);
  expect(result.differ).toEqual([]);
  await game.close();
};

test.describe.configure({ timeout: 300000 });

test('a frame drawn in part is the frame drawn whole, pixel for pixel', async ({ browser }) => {
  await check(browser, {});
});

test('...and on a phone, three device pixels to a CSS pixel', async ({ browser }) => {
  await check(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
});
