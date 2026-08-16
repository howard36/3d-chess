import type { Page } from '@playwright/test';
import { fromZXY } from '../../src/engine/coords';
import { toWorld } from '../../src/three/layout';
import type { Orientation } from '../../src/three/layout';

export type { Orientation };

/**
 * Reads which colour a page is seated as, from the in-game indicator.
 * The creator's colour is random, so tests must discover it rather than
 * assume it.
 */
export async function getPlayerColor(page: Page): Promise<Orientation> {
  const label = await page.locator('text=/You are playing as/').textContent();
  const match = label?.match(/as (white|black)/);
  if (!match) throw new Error(`Could not read player colour from "${label}"`);
  return match[1] as Orientation;
}

/**
 * Clicks a board square (ZXY notation, e.g. 'Ab2') on the WebGL canvas with a
 * real mouse event, so the click travels the app's actual raycasting path.
 *
 * The board renders mirrored per player (toWorld flips all three axes for
 * Black), so the pixel depends on which seat this page holds — pass the
 * colour from getPlayerColor.
 *
 * The world -> pixel projection runs in the page against the live camera
 * exposed by the Canvas onCreated hook in GameScreen.tsx, so it stays correct
 * if the camera moves or the default setup changes. Playwright can't pass a
 * three.js camera across the page boundary, and the page doesn't expose the
 * THREE namespace, so the projection (Vector3.project: world -> view ->
 * clip space) is spelled out as raw column-major matrix maths.
 */
export async function clickSquare(page: Page, zxy: string, seat: Orientation): Promise<void> {
  const world = toWorld(fromZXY(zxy), seat);
  const pixel = await page.evaluate(([wx, wy, wz]) => {
    const state = (
      window as Window & {
        __r3fState?: { get?: () => unknown } & Record<string, unknown>;
      }
    ).__r3fState;
    if (!state) throw new Error('window.__r3fState missing — has the game Canvas mounted?');
    // state.get() returns a fresh store snapshot (size changes on resize);
    // the camera object itself is a live reference either way.
    const { camera, size } = (state.get ? state.get() : state) as {
      camera: {
        updateMatrixWorld(): void;
        matrixWorldInverse: { elements: number[] };
        projectionMatrix: { elements: number[] };
      };
      size: { width: number; height: number };
    };
    camera.updateMatrixWorld();
    const applyMatrix4 = (m: { elements: number[] }, [x, y, z]: number[]) => {
      const e = m.elements;
      const w = e[3] * x + e[7] * y + e[11] * z + e[15];
      return [
        (e[0] * x + e[4] * y + e[8] * z + e[12]) / w,
        (e[1] * x + e[5] * y + e[9] * z + e[13]) / w,
        (e[2] * x + e[6] * y + e[10] * z + e[14]) / w,
      ];
    };
    const ndc = applyMatrix4(camera.projectionMatrix, applyMatrix4(camera.matrixWorldInverse, [wx, wy, wz]));
    return { x: (ndc[0] * 0.5 + 0.5) * size.width, y: (-ndc[1] * 0.5 + 0.5) * size.height };
  }, world);

  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas has no bounding box');
  await page.mouse.click(box.x + pixel.x, box.y + pixel.y);
}

/** Waits until the game Canvas has mounted and published its r3f state. */
export async function waitForBoard(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as Window & { __r3fState?: unknown }).__r3fState);
}
