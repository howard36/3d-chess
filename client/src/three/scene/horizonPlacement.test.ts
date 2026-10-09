import { describe, expect, it } from 'vitest';
import { PieceType } from '../../engine/pieces';
import { PROFILES } from '../pieces';
import { GARDEN } from './stage';
import { GROUND_Y } from './palette';
import { sculptureOf } from './sculptures';
import { RANGES, silhouetteOf } from './horizonSkyline';
import type { Summit } from './horizonSkyline';
import { eyeAt } from './testKit';

// The hills' secret pieces never stand in line with the garden's neon
// sculptures from the views a player spends the game in: either seat's
// opening azimuth, from the lowest look up to the opening's elevation,
// at the opening's distance or zoomed in (as the low look-up is), on a
// desktop or an upright phone. Two crossed
// silhouettes stacked read as clutter and undercut each other.

const DEG = Math.PI / 180;
/** The sculptures' scale (stage.tsx's SCALE). */
const SCULPTURE_SCALE = 6.5;
/** The opening azimuth; the fitted distances and half the frame's width (desktop 16:10, upright phone). */
const OPENING = 16;
const FRAMES = [
  { distance: 19, halfWidth: Math.atan(1.6 * Math.tan(18 * DEG)) },
  { distance: 29.1, halfWidth: Math.atan(0.46 * Math.tan(18 * DEG)) },
];
const POSES = FRAMES.flatMap(({ distance, halfWidth }) =>
  [0.7, 1].map((zoom) => ({ distance: distance * zoom, halfWidth })),
);
/** The camera never comes nearer the ground than this (stage.tsx's CameraFloor). */
const CLEARANCE = 1.2;
/** Clear air wanted between a secret piece and a sculpture, side to side. */
const MARGIN = 1.5 * DEG;

interface Span {
  /** Azimuth from the camera (radians) and half-width (radians). */
  az: number;
  half: number;
  /** Elevations from the camera (radians), bottom and top. */
  lo: number;
  hi: number;
}

const halfOf = (type: PieceType) =>
  Math.max(
    ...silhouetteOf(type)
      .solid.flat()
      .map(([x]) => Math.abs(x)),
  );

const seen = (eye: number[], x: number, z: number, width: number, y0: number, y1: number) => {
  const [cx, cy, cz] = eye;
  const d = Math.hypot(x - cx, z - cz);
  return {
    az: Math.atan2(x - cx, z - cz),
    half: Math.atan2(width, d),
    lo: Math.atan2(y0 - cy, d),
    hi: Math.atan2(y1 - cy, d),
  };
};

const turnBy = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The sculptures (by square) a secret piece lines up with, from any common pose. */
const clashes = (s: Summit, radius: number): string[] => {
  const out = new Set<string>();
  for (const turn of [1, -1] as const)
    for (let el = -14; el <= 18; el += 1)
      for (const { distance, halfWidth } of POSES) {
        const eye = eyeAt(OPENING, el, distance);
        if (eye[1] < GROUND_Y + CLEARANCE) continue;
        const look = Math.atan2(-eye[0], -eye[2]);
        const a = (s.azimuth + (turn < 0 ? 180 : 0)) * DEG;
        const secret = seen(
          eye,
          Math.sin(a) * radius,
          Math.cos(a) * radius,
          halfOf(s.type) * s.scale,
          GROUND_Y + s.top * (s.hill ?? 0.5),
          GROUND_Y + s.top,
        );
        // Only in frame
        if (Math.abs(turnBy(secret.az - look)) - secret.half > halfWidth) continue;
        for (const { type, square, at } of GARDEN) {
          const g: Span = seen(
            eye,
            at[0] * turn,
            at[2] * turn,
            PROFILES.radius[type] * SCULPTURE_SCALE,
            GROUND_Y,
            GROUND_Y + sculptureOf(type).top * SCULPTURE_SCALE,
          );
          const up = secret.lo < g.hi && g.lo < secret.hi;
          const side = Math.abs(turnBy(secret.az - g.az)) - secret.half - g.half;
          if (up && side < MARGIN) out.add(square);
        }
      }
  return [...out];
};

describe('the secret pieces in the hills', () => {
  it('never line up with a sculpture from the opening azimuths, low to the opening', () => {
    for (const { radius, summits } of RANGES)
      for (const s of summits) expect(clashes(s, radius), `${s.type} at ${s.azimuth}°`).toEqual([]);
  });
});
