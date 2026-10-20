import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  elevationOf,
  FIT_SOFTNESS,
  fitView,
  HUD_TOP_PX,
  hudTop,
  orbitSweep,
  ringBounds,
} from '../three/cameraFit';
import { layout } from '../three/scene/palette';
import { ROOM_BESIDE, SIDE_GAP, SIDE_ROOM, TOP_LAYOUT } from './hudLayout';

// The game's view, as GameCanvas fits it: its field of view, the HUD's band
// and the balance under the pill, and the elevations the orbit reaches
const FOV = 36;
const SWEEP = orbitSweep(layout.orbit);
const OPENING = elevationOf(new Vector3(...layout.viewDirection), new Vector3());

/** The move history beside the tower once the game is over: its width and its inset from the right edge (index.css). */
const PANEL = 240 + 12;

/**
 * How far the tower reaches either side of the window's middle, in CSS px:
 * the rings the fit keeps in frame (the tower and its labels at any azimuth),
 * at the fitted distance, from the elevation of the sweep where they reach farthest.
 */
function towerHalfWidth(width: number, height: number): number {
  const rings = layout.frameRings!;
  const { distance } = fitView(OPENING, rings, {
    width,
    height,
    fov: FOV,
    topInset: hudTop(height),
    balanceInset: HUD_TOP_PX,
    sweep: SWEEP,
  });
  let right = 0;
  for (let e = SWEEP[0]; e <= SWEEP[1] + 1e-9; e += Math.PI / 180) {
    right = Math.max(right, ringBounds(rings, e, distance, FIT_SOFTNESS).right);
  }
  const tanH = Math.tan((FOV * Math.PI) / 360) * (width / height);
  return (right / tanH) * (width / 2);
}

/** Room between the tower at its widest and the move history beside it. */
const gap = (width: number, height: number) => width / 2 - towerHalfWidth(width, height) - PANEL;

describe('room beside the tower', () => {
  it('is written as its numbers say', () => {
    const query = ([aspect, width]: readonly [number, number]) =>
      `((min-aspect-ratio: ${aspect === 1.5 ? '3/2' : aspect === 4 / 3 ? '4/3' : aspect}) and (min-width: ${width}px))`;
    expect(ROOM_BESIDE).toBe(SIDE_ROOM.map(query).join(' or '));
  });

  it('leaves the move history well clear of the tower in every window it lets in', () => {
    // The narrowest window let in at each height (a wider one has more
    // room): whichever pair lets in the narrowest, each its width's floor up
    // to where its aspect takes over
    const narrowest = (h: number) =>
      Math.ceil(Math.min(...SIDE_ROOM.map(([aspect, width]) => Math.max(aspect * h, width))));
    const corners = SIDE_ROOM.map(([aspect, width]) => width / aspect);
    const heights = [481, ...corners];
    for (let h = 481; h <= 2200; h += 8) heights.push(h);
    const least = Math.min(...heights.map((h) => gap(narrowest(h), h)));
    expect(least).toBeGreaterThanOrEqual(SIDE_GAP);
    // ...and not much more where each pair's two cutoffs meet: they are as
    // loose as the gap allows
    for (const [aspect, width] of SIDE_ROOM) {
      expect(gap(width, width / aspect)).toBeLessThan(SIDE_GAP + 10);
    }
  });

  it('is what index.css switches the layout on, in every one of its queries', () => {
    const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');
    expect(css).not.toMatch(/13\s*\/\s*9/);
    // Every query of the HUD's layouts (each asks for some height, 481 px up)
    const queries = [...css.matchAll(/@media ([^{]*min-height: 481px[^{]*)\{/g)].map((m) =>
      m[1].replace(/\s+/g, ' ').trim(),
    );
    expect(queries.length).toBeGreaterThanOrEqual(7);
    for (const q of queries) expect(q).toContain(ROOM_BESIDE);
    expect(queries.filter((q) => q.startsWith(TOP_LAYOUT)).length).toBeGreaterThanOrEqual(4);
  });
});
