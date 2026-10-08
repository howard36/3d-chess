import { describe, expect, it } from 'vitest';
import { PieceType } from '../../engine/pieces';
import { BOARD_GROUND_OFF, boardGroundGlsl, crackOf } from './boardGround';
import { FALLEN, fallenCurves, fallenPose } from './boardFallen';
import { neonCurves, ringPoints } from './boardNeon';
import { innerOutlinesOf, knightEyeOf, moreRingsOf, sculptureOf } from './sculptures';
import { GROUND_Y } from './palette';
import { FALLEN_SLOT, SCALE, SQUARE, WHOLE_SLOTS } from './stage';

// The colossal board's added detail: what it draws stays where it belongs
// (in its square, inside its outline, off the board, on the ground), and
// with everything off the board's shader is the board as it was.

const ANCHORS: [number, number][] = [[0, 28]];

describe("the board's ground detail", () => {
  it('compiles in nothing when it is all off', () => {
    expect(boardGroundGlsl(BOARD_GROUND_OFF, ANCHORS)).toBeNull();
  });

  it('compiles in each part only when it is on', () => {
    const frame = boardGroundGlsl({ ...BOARD_GROUND_OFF, frame: true }, ANCHORS)!;
    expect(frame.lines).toContain('electrodes');
    expect(frame.lines).not.toContain('vPool');
    expect(frame.vertex).toBe('');
    const subtle = boardGroundGlsl({ ...BOARD_GROUND_OFF, squares: 'subtle' }, ANCHORS)!;
    expect(subtle.lines).toContain('INLAID');
    expect(subtle.lines).not.toContain('Kintsugi');
    const rich = boardGroundGlsl({ ...BOARD_GROUND_OFF, squares: 'rich' }, ANCHORS)!;
    expect(rich.lines).toContain('Kintsugi');
    expect(rich.lines).toContain('Worn');
    expect(rich.vertex).toBe('');
    const pools = boardGroundGlsl({ ...BOARD_GROUND_OFF, pools: true }, ANCHORS)!;
    // Worked out per vertex, read per pixel
    expect(pools.vertex).toContain('POOLS');
    expect(pools.lines).toContain('vPool');
    expect(pools.polish).toBe('');
  });

  it('keeps every crack inside its own square, thinning as it goes', () => {
    for (const seed of [7, 23, 41, 1, 2, 3]) {
      const segs = crackOf(seed);
      expect(segs.length).toBeGreaterThan(3);
      for (const { a, b, w } of segs) {
        for (const [x, y] of [a, b]) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(SQUARE);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(SQUARE);
        }
        expect(w).toBeGreaterThan(0);
        expect(w).toBeLessThanOrEqual(0.05);
      }
    }
  });
});

describe("the sculptures' detail", () => {
  it('bends the inner tube inside each outline, clear of it, above the foot', () => {
    for (const type of Object.values(PieceType)) {
      const runs = innerOutlinesOf(type);
      expect(runs.length, type).toBeGreaterThan(0);
      const { top } = sculptureOf(type);
      for (const run of runs) {
        for (const [x, y] of run) {
          expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
          expect(y).toBeGreaterThan(0.04);
          expect(y).toBeLessThan(top);
          expect(Math.abs(x)).toBeLessThan(0.3);
        }
      }
    }
  });

  it('rings each piece where it is round, inside its foot', () => {
    for (const type of Object.values(PieceType)) {
      const rings = moreRingsOf(type);
      expect(rings.length).toBeGreaterThan(0);
      for (const r of rings) {
        expect(r.radius).toBeGreaterThan(0.03);
        expect(r.radius).toBeLessThanOrEqual(sculptureOf(type).rings[0].radius + 1e-6);
      }
    }
  });

  it('gives the twin knights eyes, and one a wink', () => {
    expect(knightEyeOf(false).closed).toBe(true);
    expect(knightEyeOf(true).closed).toBe(false);
  });
});

describe('the fallen giants', () => {
  it('lie past the board and its frame, resting on the ground, never under it', () => {
    const edge = 4 * SQUARE + 2.2;
    for (const f of FALLEN) {
      const { at, axis, radius } = fallenPose(f, SCALE, GROUND_Y);
      expect(Math.max(Math.abs(at[0]), Math.abs(at[2])), f.type).toBeGreaterThan(edge + radius);
      // Its axis lies level or dips toward the head, never up
      expect(axis[1]).toBeLessThanOrEqual(0);
      expect(Math.hypot(...axis)).toBeCloseTo(1);
      // However its drawing turns about the axis, nothing sinks into the ground
      const cosDip = Math.hypot(axis[0], axis[2]);
      let lowest = Infinity;
      for (const o of sculptureOf(f.type).outlines) {
        for (const [x, y] of o.points) {
          lowest = Math.min(lowest, at[1] + axis[1] * y * SCALE - Math.abs(x) * SCALE * cosDip);
        }
      }
      expect(lowest, f.type).toBeGreaterThan(GROUND_Y - 0.15);
      expect(lowest, f.type).toBeLessThan(GROUND_Y + 0.3);
    }
  });

  it('take a slot each of the whole-fade, after the sculptures', () => {
    const curves = fallenCurves(SCALE, GROUND_Y, FALLEN_SLOT);
    const slots = new Set(curves.map((c) => c.sculpt));
    expect(slots.size).toBe(FALLEN.length);
    for (const s of slots) expect(s!).toBeLessThan(WHOLE_SLOTS - 1);
    // Some of each one's tube has gone dark
    for (let i = 0; i < FALLEN.length; i++) {
      const lights = curves
        .filter((c) => c.sculpt === FALLEN_SLOT + i)
        .flatMap((c) => (typeof c.light === 'number' ? [c.light] : (c.light ?? [])));
      expect(Math.min(...lights)).toBeLessThan(0.05);
      expect(Math.max(...lights)).toBeGreaterThan(0.3);
    }
  });
});

describe('the neon tubes', () => {
  it('make a ribbon of two vertices a point, with every attribute the shader reads', () => {
    const g = neonCurves([
      { at: [0, 0, 0], points: ringPoints(1, 0, 8), closed: true, mode: 1, sculpt: 3, light: 0.5 },
      {
        at: [1, 0, 0],
        points: [
          [0, 0, 0],
          [0, 1, 0],
        ],
        closed: false,
      },
    ]);
    expect(g.getAttribute('position').count).toBe(2 * (8 + 2));
    for (const name of [
      'aAnchor',
      'aToward',
      'aTangent',
      'aSide',
      'aMode',
      'aAxis',
      'aSculpt',
      'aLight',
    ])
      expect(g.getAttribute(name).count, name).toBe(20);
    // Closed: as many segments as points; open: one fewer
    expect(g.getIndex()!.count).toBe(6 * (8 + 1));
    expect(g.getAttribute('aSculpt').getX(0)).toBe(3);
    expect(g.getAttribute('aLight').getX(0)).toBe(0.5);
    expect(g.getAttribute('aLight').getX(19)).toBe(1);
  });
});
