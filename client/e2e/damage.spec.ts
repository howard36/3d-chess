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
    const part = scene.getObjectByName('backdrop')!.children[0];
    part.visible = !part.visible;
    gl.render(scene, camera);
    part.visible = !part.visible;
    gl.render(scene, camera);
    gl.render(scene, camera);
    // Two frames from the copy, then the same drawn whole
    gl.render(scene, camera);
    gl.render(scene, camera);
    const inPart = read();
    scene.userData.wholeFrames = true;
    gl.render(scene, camera);
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
      notWhole: 0,
      differ: [],
      shares: [],
    });
    // The board's frames, told from this loop's own: what part of the canvas each drew
    const { gl } = w.__r3fState;
    const render = gl.render;
    let ours = false;
    // (getScissor copies into a Vector4, in CSS px; its width and height are z and w)
    const box = { z: 0, w: 0 };
    const target = { copy: (v: { z: number; w: number }): unknown => Object.assign(box, v) };
    gl.render = function (...args) {
      render.apply(this, args);
      if (ours) return;
      const canvas = gl.domElement;
      if (!gl.getScissorTest()) check.shares.push(1);
      else {
        gl.getScissor(target as unknown as import('three').Vector4);
        check.shares.push((box.z * box.w) / (canvas.clientWidth * canvas.clientHeight));
      }
    };
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
      ours = true;
      gl.render(scene, camera);
      cached &&= copy?.visible === true;
      gl.setScissorTest(false);
      read(ctx, inPart);
      scene.userData.wholeFrames = true;
      gl.render(scene, camera);
      scene.userData.wholeFrames = false;
      ours = false;
      // (the hook is read only in a dev build: on a build this check would compare nothing)
      if (gl.getScissorTest()) check.notWhole++;
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
          __damageCheck: {
            frames: number;
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
