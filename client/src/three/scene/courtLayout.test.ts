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
  SLAB,
  STONE_HALF,
  STONES,
} from './courtLayout';

// The court's plan (court.tsx): its paving, its inlay and its stepping
// stones, and the colours it keeps to under the tower.

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
    // Clear of both of the inlay's rings (whole): no stone touches either
    for (const [x, z] of STONES) {
      const near = Math.hypot(Math.abs(x) - STONE_HALF, Math.max(Math.abs(z) - STONE_HALF, 0));
      const farthest = Math.hypot(Math.abs(x) + STONE_HALF, Math.abs(z) + STONE_HALF);
      for (const ring of [INLAY.inner, INLAY.outer]) {
        expect(near < ring && farthest > ring).toBe(false);
        expect(Math.min(Math.abs(near - ring), Math.abs(farthest - ring))).toBeGreaterThan(0.8);
      }
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

describe("the court's colours", () => {
  it('are near-grey and cool, nothing like a mark of play or a level', () => {
    const marks = [PALETTE.move, PALETTE.trace, PALETTE.capture, PALETTE.check, ...LEVEL_COLORS];
    for (const [name, hex] of Object.entries(COURT)) {
      const c = hexToOklch(hex);
      // Barely tinted: well under the least coloured mark
      expect(c.c, name).toBeLessThan(0.05);
      for (const m of marks.map(hexToOklch)) expect(c.c, name).toBeLessThan(m.c / 2);
    }
  });
});
