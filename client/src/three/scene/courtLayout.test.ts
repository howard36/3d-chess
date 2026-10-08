import { describe, expect, it } from 'vitest';
import { hexToOklch } from './colors';
import { TOWER_SHADE } from './mask';
import { COURT, LEVEL_COLORS, PALETTE } from './palette';
import { squareCentre } from './stage';
import {
  COURT_SPAN,
  INLAY,
  jointBefore,
  KNIGHT_WAYS,
  SHADE_AT_VERTEX,
  mossPlan,
  SLAB,
  STONE_HALF,
  STONES,
} from './courtLayout';

// The court's plan (court.tsx): its paving, its inlay, its stepping stones
// and its moss, and the colours it keeps to under the tower.

describe("the tower's shade at a vertex", () => {
  it("is mask.ts's own shade, from the vertex's place on screen, not the pixel's", () => {
    expect(SHADE_AT_VERTEX).toContain('float towerShadeAt(vec2 p) {');
    expect(SHADE_AT_VERTEX).toContain('float shadeOfClip(vec4 clip) {');
    expect(SHADE_AT_VERTEX).not.toContain('gl_FragCoord');
    expect(SHADE_AT_VERTEX).not.toContain('towerShade()');
    // The rest of the function as mask.ts has it
    const body = (s: string) => s.slice(s.indexOf('// Signed distance'), s.indexOf('return 1.0'));
    expect(body(SHADE_AT_VERTEX)).toBe(body(TOWER_SHADE));
  });
});

describe('the paving', () => {
  it('cuts every row into slabs of two or three cells, staggered row to row', () => {
    for (let k = -10; k <= 10; k++) {
      const joints = Array.from({ length: 60 }, (_, i) => i - 30).filter((c) => jointBefore(c, k));
      for (let i = 1; i < joints.length; i++) {
        // The shader looks at most four cells each way for a joint
        expect(joints[i] - joints[i - 1]).toBeGreaterThanOrEqual(2);
        expect(joints[i] - joints[i - 1]).toBeLessThanOrEqual(3);
      }
      // A row's joints never all line up with the next row's
      const next = joints.filter((c) => jointBefore(c, k + 1));
      expect(next.length).toBeLessThan(joints.length);
    }
    expect(SLAB.row).toBeGreaterThan(SLAB.cell);
  });
});

describe('the inlay', () => {
  it("points its spokes the eight ways a knight jumps, not the compass's", () => {
    const angles = KNIGHT_WAYS.map(([x, z]) => ((Math.atan2(z, x) * 180) / Math.PI + 360) % 360);
    expect(angles.map((a) => Math.round(a * 100) / 100).sort((a, b) => a - b)).toEqual([
      26.57, 63.43, 116.57, 153.43, 206.57, 243.43, 296.57, 333.43,
    ]);
    for (const [x, z] of KNIGHT_WAYS) expect(Math.hypot(x, z)).toBeCloseTo(1, 9);
  });

  it('lies in the court, inside the colossal board coming back', () => {
    expect(INLAY.inner).toBeGreaterThan(COURT_SPAN.inner[1]);
    expect(INLAY.outer).toBeLessThan(COURT_SPAN.outer[0]);
    expect(INLAY.star[1]).toBeLessThanOrEqual(COURT_SPAN.outer[1]);
  });
});

describe('the stepping stones', () => {
  it("are laid a knight's jump apart, from the tower's foot to the board's edge", () => {
    for (let i = 1; i < STONES.length; i++) {
      const dx = Math.abs(STONES[i][0] - STONES[i - 1][0]);
      const dz = Math.abs(STONES[i][1] - STONES[i - 1][1]);
      // Two along and one across, on a grid of two units
      expect([dx, dz].sort((a, b) => a - b)).toEqual([2, 4]);
    }
    // From inside the court, clear of the shade's darkest round the tower
    const [x0, z0] = STONES[0];
    expect(Math.hypot(x0, z0)).toBeGreaterThan(COURT_SPAN.inner[1]);
    // Through the ring's gate: no stone touches the ring
    for (const [x, z] of STONES) {
      const near = Math.hypot(Math.abs(x) - STONE_HALF, Math.max(Math.abs(z) - STONE_HALF, 0));
      const farthest = Math.hypot(Math.abs(x) + STONE_HALF, Math.abs(z) + STONE_HALF);
      const crosses = near < INLAY.outer && farthest > INLAY.outer;
      if (crosses) expect(Math.abs(z) + STONE_HALF).toBeLessThan(INLAY.gap);
      else
        expect(
          Math.min(Math.abs(near - INLAY.outer), Math.abs(farthest - INLAY.outer)),
        ).toBeGreaterThan(0.1);
    }
    // The last stands at the colossal board's edge (±32)
    expect(Math.abs(STONES[STONES.length - 1][0])).toBeGreaterThan(31);
  });

  it('pass between the two knights, which face each other across the path', () => {
    const a4 = squareCentre('a4');
    const a5 = squareCentre('a5');
    expect(a4[0]).toBe(a5[0]);
    const lo = Math.min(a4[1], a5[1]);
    const hi = Math.max(a4[1], a5[1]);
    for (const [, z] of STONES) {
      expect(z - STONE_HALF).toBeGreaterThan(lo + 2);
      expect(z + STONE_HALF).toBeLessThan(hi - 2);
    }
  });
});

describe('the moss', () => {
  const { points, patches } = mossPlan();

  it('grows sparsely, in short patches toward the rim, clear of the tower', () => {
    expect(points.length).toBeGreaterThan(120);
    expect(points.length).toBeLessThan(400);
    for (const { at } of points) {
      const r = Math.hypot(at[0], at[2]);
      expect(r).toBeGreaterThan(COURT_SPAN.inner[1] - 2);
      expect(r).toBeLessThan(COURT_SPAN.outer[1]);
    }
    // Never a joint's whole length: the moss never draws the paving's grid
    for (const p of patches) expect(p.spread).toBeLessThan(SLAB.row / 2);
  });

  it('keeps off the stepping stones and the inlay', () => {
    for (const { at } of points) {
      const [x, , z] = at;
      for (const [sx, sz] of STONES)
        expect(Math.max(Math.abs(x - sx), Math.abs(z - sz))).toBeGreaterThan(STONE_HALF);
      expect(Math.abs(Math.hypot(x, z) - INLAY.outer)).toBeGreaterThan(0.3);
    }
  });

  it('is the same every time', () => {
    expect(mossPlan().points).toEqual(points);
  });
});

describe("the court's colours", () => {
  it('are near-grey and cool, nothing like a mark of play or a level', () => {
    const hueGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
    const marks = [PALETTE.move, PALETTE.trace, PALETTE.capture, PALETTE.check, ...LEVEL_COLORS];
    for (const [name, hex] of Object.entries(COURT)) {
      const c = hexToOklch(hex);
      // Barely tinted: well under the least coloured mark
      expect(c.c, name).toBeLessThan(0.05);
      for (const m of marks.map(hexToOklch)) expect(c.c, name).toBeLessThan(m.c / 2);
    }
    // The moss leans cool, away from the last move's mint
    const moss = hexToOklch(COURT.moss);
    expect(hueGap(moss.h, hexToOklch(PALETTE.trace).h)).toBeGreaterThan(20);
  });
});
