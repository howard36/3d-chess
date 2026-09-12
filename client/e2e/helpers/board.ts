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
 * The projection and the occlusion check run in the page against the live
 * r3f state exposed by the Canvas onCreated hook in GameScreen.tsx, so they
 * stay correct if the camera moves or the default setup changes. A 3D board
 * is not a grid: the ray through a cell's centre often passes through another
 * cell first, and if that cell is also a legal destination (or holds a piece)
 * it takes the click, so the helper samples several points inside the target
 * cell and uses the first one whose ray reaches the target before any other
 * interactive object — mirroring how r3f dispatches to the nearest hit with a
 * handler. It throws if no such point exists rather than clicking blindly.
 */
export async function clickSquare(page: Page, zxy: string, seat: Orientation): Promise<void> {
  const world = toWorld(fromZXY(zxy), seat);
  const locate = () =>
    page.evaluate(([wx, wy, wz]) => {
      const state = (
        window as Window & {
          __r3fState?: { get?: () => unknown } & Record<string, unknown>;
        }
      ).__r3fState;
      if (!state) throw new Error('window.__r3fState missing — has the game Canvas mounted?');
      type Obj = {
        position: { x: number; y: number; z: number };
        userData: Record<string, unknown>;
        parent: Obj | null;
        children: Obj[];
      };
      // state.get() returns a fresh store snapshot (size changes on resize);
      // the camera and scene objects are live references either way.
      const { camera, size, scene, raycaster } = (state.get ? state.get() : state) as {
        camera: { updateMatrixWorld(): void; [k: string]: unknown };
        size: { width: number; height: number };
        scene: { children: Obj[] };
        raycaster: {
          setFromCamera(ndc: { x: number; y: number }, camera: unknown): void;
          intersectObjects(objects: Obj[], recursive: boolean): { object: Obj }[];
        };
      };
      camera.updateMatrixWorld();
      const project = ([x, y, z]: number[]) => {
        const apply = (m: { elements: number[] }, [px, py, pz]: number[]) => {
          const e = m.elements;
          const w = e[3] * px + e[7] * py + e[11] * pz + e[15];
          return [
            (e[0] * px + e[4] * py + e[8] * pz + e[12]) / w,
            (e[1] * px + e[5] * py + e[9] * pz + e[13]) / w,
            (e[2] * px + e[6] * py + e[10] * pz + e[14]) / w,
          ];
        };
        return apply(
          camera.projectionMatrix as { elements: number[] },
          apply(camera.matrixWorldInverse as { elements: number[] }, [x, y, z]),
        );
      };
      const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
      const atTarget = (o: Obj) =>
        near(o.position.x, wx) && near(o.position.y, wy) && near(o.position.z, wz);
      // The object r3f would hand this hit to: a piece (its outer group carries
      // the handler) or a destination cell; anything else is inert.
      const interactive = (hit: Obj): Obj | null => {
        for (let o: Obj | null = hit; o; o = o.parent) {
          if (o.userData.piece) return o;
          if (o.userData.cube) return o.userData.highlight ? o : null;
        }
        return null;
      };
      const describe = (o: Obj) => {
        const p = o.position;
        return `${Object.keys(o.userData).join(',') || 'object'}@(${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)})`;
      };
      const blockers: string[] = [];
      // Sample the centre first, then points spread inside the cell (the box
      // is 1 unit wide; spacing is a little more, so ±0.4 stays inside it).
      const offsets = [0, 0.4, -0.4];
      for (const dx of offsets) {
        for (const dy of offsets) {
          for (const dz of offsets) {
            const [nx, ny] = project([wx + dx, wy + dy, wz + dz]);
            raycaster.setFromCamera({ x: nx, y: ny }, camera);
            const hits = raycaster.intersectObjects(scene.children, true);
            let first: Obj | null = null;
            for (const hit of hits) {
              first = interactive(hit.object);
              if (first) break;
            }
            if (first && atTarget(first)) {
              return {
                pixel: { x: (nx * 0.5 + 0.5) * size.width, y: (-ny * 0.5 + 0.5) * size.height },
              };
            }
            if (blockers.length < 4) blockers.push(first ? describe(first) : 'nothing');
          }
        }
      }
      return { blockers, size: `${size.width}x${size.height}` };
    }, world);

  // A piece gliding through the line of sight (the last move's animation)
  // can block every sample for a moment; poll briefly before giving up.
  const deadline = Date.now() + 3000;
  let result = await locate();
  while (!result.pixel && Date.now() < deadline) {
    await page.waitForTimeout(100);
    result = await locate();
  }
  const pixel = result.pixel;
  if (!pixel) {
    throw new Error(
      `No pixel reaches ${zxy} (${seat}) before another piece or destination; ` +
        `canvas ${result.size}, first samples blocked by: ${result.blockers?.join(' | ')}`,
    );
  }

  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas has no bounding box');
  await page.mouse.click(box.x + pixel.x, box.y + pixel.y);
}

/** Waits until the game Canvas has mounted and published its r3f state. */
export async function waitForBoard(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as Window & { __r3fState?: unknown }).__r3fState);
}

/**
 * Waits until `zxy` is drawn as a legal destination of the current selection,
 * i.e. its cell box has flipped to `userData.highlight` and so carries the
 * pointer handler that turns a click into a move.
 *
 * Selecting a piece and clicking its destination are two separate React
 * commits. React yields to pending input, so a destination click sent straight
 * after the selection click can be raycast against the scene from *before*
 * the selection committed, where the cell is inert; the click is a no-op and
 * the move never happens. Playwright 1.62 delivers the follow-up click quickly
 * enough to hit that window every time, so the driver has to wait for the
 * commit explicitly.
 */
export async function waitForDestination(
  page: Page,
  zxy: string,
  seat: Orientation,
): Promise<void> {
  const world = toWorld(fromZXY(zxy), seat);
  await page.waitForFunction(([wx, wy, wz]) => {
    const state = (
      window as Window & {
        __r3fState?: { get?: () => unknown } & Record<string, unknown>;
      }
    ).__r3fState;
    if (!state) return false;
    const { scene } = (state.get ? state.get() : state) as {
      scene: {
        traverse(
          cb: (o: {
            position: { x: number; y: number; z: number };
            userData: Record<string, unknown>;
          }) => void,
        ): void;
      };
    };
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
    let found = false;
    scene.traverse((o) => {
      if (
        o.userData.cube &&
        o.userData.highlight &&
        near(o.position.x, wx) &&
        near(o.position.y, wy) &&
        near(o.position.z, wz)
      ) {
        found = true;
      }
    });
    return found;
  }, world);
}
