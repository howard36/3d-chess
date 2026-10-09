import { describe, expect, it } from 'vitest';
import { PieceType } from '../../engine/pieces';
import { boardGroundGlsl } from './boardGround';
import { FALLEN, fallenPose, fallenStrokes } from './boardFallen';
import { moreRingsOf, sculptureOf } from './sculptures';
import { GROUND_Y } from './palette';
import { FALLEN_SLOT, GARDEN, SCALE, SQUARE, WHOLE_SLOTS } from './stage';
import { detailStrokes } from './boardDetail';
import { isLightSquare, lightOn, ON_DARK, RING_LIGHT, sculptureStrokes } from './sculptureStrokes';

// The colossal board's added detail: what it draws stays where it belongs
// (in its square, inside its outline, off the board, on the ground).

describe("the board's ground detail", () => {
  it('compiles in the frame only for a part its band lies in, the squares everywhere', () => {
    const frame = boardGroundGlsl(true);
    expect(frame.lines).toContain('electrodes');
    expect(frame.lines).toContain('INLAID');
    const squares = boardGroundGlsl(false);
    expect(squares.lines).not.toContain('electrodes');
    expect(squares.lines).toContain('INLAID');
    // The dark squares' polish, after the light is summed
    expect(squares.polish).toContain('sheen');
    expect(squares.decl).toBe(frame.decl);
  });
});

describe("the sculptures' detail", () => {
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

  it('take a slot each of gardenWhole, after the sculptures', () => {
    const slots = new Set(fallenStrokes(SCALE, GROUND_Y, FALLEN_SLOT).map((c) => c.sculpt));
    expect(slots.size).toBe(FALLEN.length);
    for (const s of slots) {
      expect(s!).toBeGreaterThanOrEqual(FALLEN_SLOT);
      expect(s!).toBeLessThan(WHOLE_SLOTS - 1);
    }
  });
});

describe('lines on light and dark squares', () => {
  it('knows the squares as any board does: a1 dark, h1 light', () => {
    expect(isLightSquare('a1')).toBe(false);
    expect(isLightSquare('h1')).toBe(true);
    expect(isLightSquare('d1')).toBe(true);
    expect(isLightSquare('e1')).toBe(false);
    expect(isLightSquare('e8')).toBe(true);
  });

  it('dims a line on a dark square only, the base rings less', () => {
    expect(lightOn('d1')).toBe(1);
    expect(lightOn('e1')).toBe(ON_DARK.line);
    expect(lightOn('e1', 'ring')).toBe(ON_DARK.ring);
    expect(ON_DARK.line).toBeLessThan(ON_DARK.ring);
    expect(ON_DARK.ring).toBeLessThan(1);
  });

  it('dims the footprints on dark squares, and only the base rings of the sculptures', () => {
    const footprints = detailStrokes().filter((s) => s.points.length === 4 && s.closed);
    expect(footprints).toHaveLength(GARDEN.length);
    const lit = footprints.map((s, i) => {
      const dark = !isLightSquare(GARDEN[i].square);
      return (s.light as number) / (dark ? ON_DARK.line : 1);
    });
    expect(GARDEN.some((g) => isLightSquare(g.square))).toBe(true);
    expect(GARDEN.some((g) => !isLightSquare(g.square))).toBe(true);
    for (const l of lit) expect(l).toBeCloseTo(lit[0], 9);
    const rings = sculptureStrokes(GARDEN, SCALE).filter(
      (s) => s.mode === 1 && s.points.length === 36,
    );
    expect(rings.length).toBeGreaterThan(GARDEN.length);
    for (const s of rings) {
      const base = s.points[0][1] < 0.1;
      const dark = !isLightSquare(GARDEN[s.sculpt!].square);
      expect(s.light).toBeCloseTo(RING_LIGHT * (base && dark ? ON_DARK.ring : 1), 9);
    }
  });
});
