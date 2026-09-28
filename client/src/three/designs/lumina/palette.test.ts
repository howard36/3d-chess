import { describe, expect, it } from 'vitest';
import { hexToOklch } from '../kit/colors';
import { LEVEL_COLORS, PALETTE } from './palette';

// The colour rules Lumina's look depends on: five real level colours in a
// gradient, marker colours that can never be mistaken for a level, and a
// graphite army whose edge light stays dim, so it never reads as white.

const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

describe('lumina palette', () => {
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
      expect(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])).toBeGreaterThan(0.1);
    }
  });

  it('keeps every marker colour off the level colours', () => {
    for (const hex of [PALETTE.move, PALETTE.select, PALETTE.capture, PALETTE.check]) {
      const m = hexToOklch(hex);
      for (const c of levels) expect(hueGap(m.h, c.h)).toBeGreaterThan(40);
    }
    // The last move's ice is nearly colourless: it reads as light, not as a level
    expect(hexToOklch(PALETTE.trace).c).toBeLessThan(0.05);
  });

  it('keeps the armies far apart in value, the dark edge dim', () => {
    const l = (hex: string) => hexToOklch(hex).l;
    expect(l(PALETTE.white) - l(PALETTE.black)).toBeGreaterThan(0.5);
    // The graphite army's edge light is darker than the pearl army's darkest part
    expect(l(PALETTE.blackRim)).toBeLessThan(l(PALETTE.whiteBase) - 0.2);
  });
});
