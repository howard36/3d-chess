import { describe, expect, it } from 'vitest';
import { PieceType } from '../../../engine/pieces';
import { hexToOklch } from '../kit/colors';
import { LEVEL_COLORS, PALETTE } from './palette';
import { bend, envelope, sculptureOf, simplify } from './sculptures';

// The rules Monolith's look depends on: five real level colours in a
// gradient, marker colours that can never be mistaken for a level, and the
// garden's line drawings built whole from the piece set's own profiles.

const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

describe('zenith palette', () => {
  const levels = LEVEL_COLORS.map(hexToOklch);

  it('has five real level colours in hue order, neighbours well apart', () => {
    expect(levels).toHaveLength(5);
    for (const c of levels) expect(c.c).toBeGreaterThan(0.1);
    const lab = ({ l, c, h }: { l: number; c: number; h: number }) => [
      l,
      c * Math.cos((h * Math.PI) / 180),
      c * Math.sin((h * Math.PI) / 180),
    ];
    for (let i = 1; i < 5; i++) {
      expect(levels[i].h).toBeGreaterThan(levels[i - 1].h + 25);
      const [p, q] = [lab(levels[i - 1]), lab(levels[i])];
      expect(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])).toBeGreaterThan(0.08);
    }
  });

  it('keeps capture and check red clear of the rose level', () => {
    for (const hex of [PALETTE.capture, PALETTE.check]) {
      const m = hexToOklch(hex);
      for (const c of levels) expect(hueGap(m.h, c.h)).toBeGreaterThan(30);
    }
    // White light for the last move and the held piece: nearly colourless
    for (const hex of [PALETTE.trace, PALETTE.light, PALETTE.neon]) {
      expect(hexToOklch(hex).c).toBeLessThan(0.03);
    }
  });
});

describe('zenith sculptures', () => {
  it('draws every piece as finite outlines standing on its base', () => {
    for (const type of Object.values(PieceType)) {
      const d = sculptureOf(type);
      expect(d.outlines.length).toBeGreaterThan(0);
      for (const o of d.outlines) {
        expect(o.points.length).toBeGreaterThan(1);
        for (const [x, y] of o.points) {
          expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
          expect(y).toBeGreaterThanOrEqual(-1e-6);
          expect(y).toBeLessThanOrEqual(0.9);
        }
      }
      // A base ring and a collar ring
      expect(d.rings).toHaveLength(2);
      expect(d.rings[0].y).toBeLessThan(0.01);
    }
  });

  it('keeps a stepped envelope square and meets the axis at the top', () => {
    const right = envelope([
      [
        [0.2, 0],
        [0.2, 0.1],
      ],
      [
        [0.1, 0.1],
        [0.1, 0.3],
        [0, 0.3],
      ],
    ]);
    expect(right[0]).toEqual([0.2, 0]);
    expect(right).toContainEqual([0.2, 0.1]);
    expect(right).toContainEqual([0.1, 0.1]);
    expect(right[right.length - 1][0]).toBeLessThan(1e-4);
  });

  it('bends corners and thins straight runs', () => {
    const corner = bend(
      [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
      1,
    );
    expect(corner).toHaveLength(6);
    expect(corner).not.toContainEqual([1, 0]);
    expect(
      simplify(
        [
          [0, 0],
          [0.5, 0.0001],
          [1, 0],
        ],
        0.01,
      ),
    ).toHaveLength(2);
  });
});
