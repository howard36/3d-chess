import { expect, test } from '@playwright/test';
import type { Browser } from '@playwright/test';
import { startGame } from './helpers/game';

// A frame at rest redraws only what changed (three/scene/damage.ts, drawn in
// part by backdropCache.tsx): every such frame must come out exactly as the
// same frame drawn whole. Through a pick, a move gliding in, the opponent's
// reply and the last move's shimmer, each of the board's own frames (the
// frame pacer's, every pass of it) is read back as it left the canvas and
// drawn again whole in the same task (so nothing moves between them), and
// the pixels compared. Only frames whose garden came from its copy
// throughout are compared: a frame that retakes
// the copy draws the garden itself, which may differ from the copy by a step
// where a garden edge meets a tower edge (backdropCache.tsx). The frames
// after such a frame are checked on purpose first: the garden changed and
// changed back, drawn itself, its copy taken, then a frame from the copy.

const check = async (
  browser: Browser,
  device: { viewport?: { width: number; height: number }; deviceScaleFactor?: number },
) => {
  const game = await startGame(browser, { motion: 'full', device });
  const page = game.white;
  const afterCapture = await page.evaluate(() => {
    const { gl, scene, camera } = (
      window as unknown as {
        __r3fState: {
          gl: import('three').WebGLRenderer;
          scene: import('three').Scene;
          camera: import('three').Camera;
        };
      }
    ).__r3fState;
    const ctx = gl.getContext() as WebGL2RenderingContext;
    const size = ctx.drawingBufferWidth * ctx.drawingBufferHeight * 4;
    const read = () => {
      const out = new Uint8Array(size);
      gl.setScissorTest(false);
      ctx.readPixels(
        0,
        0,
        ctx.drawingBufferWidth,
        ctx.drawingBufferHeight,
        ctx.RGBA,
        ctx.UNSIGNED_BYTE,
        out,
      );
      return out;
    };
    // A frame, in as many passes as it takes (the frame pacer's way)
    const frame = () => {
      gl.render(scene, camera);
      while ((scene.userData.nextPass as (() => boolean) | undefined)?.()) gl.render(scene, camera);
    };
    const part = scene.getObjectByName('backdrop')!.children[0];
    part.visible = !part.visible;
    frame();
    part.visible = !part.visible;
    frame();
    frame();
    // Two frames from the copy, then the same drawn whole
    frame();
    frame();
    const inPart = read();
    scene.userData.wholeFrames = true;
    frame();
    scene.userData.wholeFrames = false;
    const whole = read();
    let n = 0;
    for (let i = 0; i < size; i++) if (inPart[i] !== whole[i]) n++;
    return n;
  });
  expect(afterCapture).toBe(0);
  await page.evaluate(() => {
    type Check = {
      frames: number;
      /** Of them, frames the board drew in two passes or more. */
      multiPass: number;
      notWhole: number;
      differ: number[];
      /** The board's own frames (PaceOnGpu's): the share of the canvas each redrew. */
      shares: number[];
    };
    const w = window as unknown as {
      __r3fState: {
        gl: import('three').WebGLRenderer;
        scene: import('three').Scene;
        camera: import('three').Camera;
      };
      __damageCheck: Check;
    };
    const check: Check = (w.__damageCheck = {
      frames: 0,
      multiPass: 0,
      notWhole: 0,
      differ: [],
      shares: [],
    });
    // The board's frames (the frame pacer's: every pass of one in one task):
    // what part of the canvas each drew, and, once its last pass is drawn
    // (a microtask), the picture it left compared with the same frame drawn
    // whole, before anything can move
    const { gl } = w.__r3fState;
    const render = gl.render;
    let ours = false;
    // The passes of one frame (renders in one task) count as one share
    let sameFrame = false;
    let passes = 0;
    // (getScissor copies into a Vector4, in CSS px; its width and height are z and w)
    const box = { z: 0, w: 0 };
    const target = { copy: (v: { z: number; w: number }): unknown => Object.assign(box, v) };
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
    const compare = () => {
      const { scene, camera } = w.__r3fState;
      // Only a frame whose garden came from its copy (left shown by its last pass)
      const copy = scene.getObjectByName('backdrop-copy');
      if (copy?.visible !== true) return;
      const ctx = gl.getContext() as WebGL2RenderingContext;
      const size = ctx.drawingBufferWidth * ctx.drawingBufferHeight * 4;
      const inPart = new Uint8Array(size);
      const whole = new Uint8Array(size);
      gl.setScissorTest(false);
      read(ctx, inPart);
      ours = true;
      scene.userData.wholeFrames = true;
      gl.render(scene, camera);
      scene.userData.wholeFrames = false;
      ours = false;
      // (the hook is read only in a dev build: on a build this check would compare nothing)
      if (gl.getScissorTest()) check.notWhole++;
      if (copy.visible !== true) return;
      read(ctx, whole);
      let n = 0;
      for (let i = 0; i < size; i++) if (inPart[i] !== whole[i]) n++;
      check.frames++;
      if (passes > 1) check.multiPass++;
      if (n) check.differ.push(n);
    };
    gl.render = function (...args) {
      render.apply(this, args);
      if (ours) return;
      const canvas = gl.domElement;
      let share = 1;
      if (gl.getScissorTest()) {
        gl.getScissor(target as unknown as import('three').Vector4);
        share = (box.z * box.w) / (canvas.clientWidth * canvas.clientHeight);
      }
      passes++;
      if (sameFrame) check.shares[check.shares.length - 1] += share;
      else {
        check.shares.push(share);
        sameFrame = true;
        queueMicrotask(() => {
          sameFrame = false;
          compare();
          passes = 0;
        });
      }
    };
  });
  // A quiet move, the reply, then a capture and its recapture
  await game.playAll(['Ad2-Ac3', 'Eb5-Ec3', 'Ab2-Ba3', 'Ed5-Ce5']);
  await page.waitForTimeout(1500);
  // On a loaded machine the game is over in fewer frames: the last move's
  // shimmer, travelling at rest, gives the frames still to compare
  await page.waitForFunction(
    () => {
      const c = (window as unknown as { __damageCheck: { frames: number; shares: number[] } })
        .__damageCheck;
      return c.frames > 20 && c.shares.length > 20;
    },
    null,
    { timeout: 60000 },
  );
  const result = await page.evaluate(
    () =>
      (
        window as unknown as {
          __damageCheck: {
            frames: number;
            multiPass: number;
            notWhole: number;
            differ: number[];
            shares: number[];
          };
        }
      ).__damageCheck,
  );
  // Most of the board's frames are drawn in part, a small part of the canvas
  // (a pick's or a move's: a few pieces and marks), and none differs from the whole
  const { shares } = result;
  expect(shares.length).toBeGreaterThan(20);
  expect(shares.filter((s) => s < 1).length).toBeGreaterThan(shares.length * 0.75);
  expect(shares.toSorted((a, b) => a - b)[shares.length >> 1]).toBeLessThan(0.25);
  expect(result.frames).toBeGreaterThan(20);
  // ...some of them in several passes, a rect each (the frame pacer's loop)
  expect(result.multiPass).toBeGreaterThan(0);
  expect(result.notWhole).toBe(0);
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
