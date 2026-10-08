import { describe, expect, it } from 'vitest';
import type { BufferGeometry } from 'three';
import { GROUND_RADIUS, groundParts } from './horizonGround';
import { VEIL } from './horizon';

// The plain's footprint: a disc nearly as wide as the sky, rim the same
// distance off on every side, in parts that meet with no seam, and the veil
// thick before any rim is reached.

const points = (g: BufferGeometry) => {
  const p = g.getAttribute('position');
  return Array.from({ length: p.count }, (_, i): [number, number, number] => [
    p.getX(i),
    p.getY(i),
    p.getZ(i),
  ]);
};
/** The outermost ring of a part (its last rays + 1 vertices). */
const rim = (g: BufferGeometry, rays = 128) => points(g).slice(-(rays + 1));
/** The innermost ring of a part (its first rays + 1 vertices). */
const inner = (g: BufferGeometry) => points(g).slice(0, 129);

describe('the plain', () => {
  it('is a disc inside the sky, centred on the tower, all of it on the ground', () => {
    const { middle, court, board, far } = groundParts(17, 29, 38, false, true);
    for (const g of [middle, court, board, far]) for (const [, y] of points(g)) expect(y).toBe(0);
    for (const [x, , z] of rim(far)) expect(Math.hypot(x, z)).toBeCloseTo(GROUND_RADIUS, 3);
    expect(GROUND_RADIUS).toBeLessThan(400);
  });

  it('is in parts that meet with no seam: the clear middle, the court, the board to its band, the rest', () => {
    const { middle, court, board, far } = groundParts(17, 29, 38, false, true);
    // The middle reaches under the court's ring all round (its sides past the ring's hole)
    const m = rim(middle, 64);
    for (let i = 0; i + 1 < m.length; i++) {
      const [a, b] = [m[i], m[i + 1]];
      expect(Math.hypot((a[0] + b[0]) / 2, (a[2] + b[2]) / 2)).toBeGreaterThan(17);
    }
    for (const [x, , z] of inner(court)) expect(Math.hypot(x, z)).toBeCloseTo(17, 3);
    expect(inner(board)).toEqual(rim(court));
    expect(inner(far)).toEqual(rim(board));
    for (const [x, , z] of rim(court)) expect(Math.hypot(x, z)).toBeCloseTo(29, 3);
    for (const [x, , z] of rim(board))
      expect(Math.max(Math.abs(x), Math.abs(z))).toBeCloseTo(38, 3);
  });

  it('faces up', () => {
    for (const g of Object.values(groundParts(17, 29, 38, false, true))) {
      const p = points(g);
      const index = g.getIndex()!;
      for (let t = 0; t < index.count; t += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => p[index.getX(t + k)]);
        // (a, b, c) counterclockwise seen from above, or of no area
        const up = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
        expect(up).toBeGreaterThanOrEqual(-1e-6);
      }
    }
  });

  it('is main’s square with the fix off, its corners kept', () => {
    const pts = rim(groundParts(17, 29, 38, true, false).far);
    for (const [x, , z] of pts) expect(Math.max(Math.abs(x), Math.abs(z))).toBeCloseTo(130, 3);
    const corners = pts.filter(
      ([x, , z]) => Math.abs(Math.abs(x) - 130) < 1e-3 && Math.abs(Math.abs(z) - 130) < 1e-3,
    );
    expect(corners.length).toBeGreaterThanOrEqual(4);
  });

  it('is the night’s own colour before its rim, from wherever the camera stands', () => {
    // The camera stands at most about 45 from the axis (zoomed out on a phone)
    expect(VEIL[1]).toBeLessThanOrEqual(GROUND_RADIUS - 50);
    // and the colossal board (±32) and its sculptures stay clear of it
    expect(VEIL[0]).toBeGreaterThan(32 + 30);
  });
});
