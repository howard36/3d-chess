import { expect, test } from '@playwright/test';
import { startGame } from './helpers/game';

// A frame at rest redraws only what changed (three/scene/damage.ts, drawn in
// part by backdropCache.tsx): every such frame must come out exactly as the
// same frame drawn whole. Through a pick, a move gliding in, the opponent's
// reply and the last move's shimmer, the page draws each display frame twice
// in one task (so nothing moves between them), first as the board would, in
// part, then whole, and compares the pixels.

test('a frame drawn in part is the frame drawn whole, pixel for pixel', async ({ browser }) => {
  test.setTimeout(240000);
  const game = await startGame(browser, { motion: 'full' });
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
      gl.render(scene, camera);
      if (gl.getScissorTest()) check.partial++;
      gl.setScissorTest(false);
      read(ctx, inPart);
      scene.userData.wholeFrames = true;
      gl.render(scene, camera);
      scene.userData.wholeFrames = false;
      read(ctx, whole);
      let n = 0;
      for (let i = 0; i < size; i++) if (inPart[i] !== whole[i]) n++;
      check.frames++;
      if (n) check.differ.push(n);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  // A quiet move, the reply, then a capture and its recapture
  await game.playAll(['Ad2-Ac3', 'Eb5-Ec3', 'Ab2-Ba3', 'Ed5-Ce5']);
  await page.waitForTimeout(1500);
  const check = await page.evaluate(
    () =>
      (
        window as unknown as {
          __damageCheck: { frames: number; partial: number; differ: number[] };
        }
      ).__damageCheck,
  );
  // Most frames at rest are drawn in part, and none differs from the whole
  expect(check.partial).toBeGreaterThan(check.frames / 2);
  expect(check.differ).toEqual([]);
  await game.close();
});
