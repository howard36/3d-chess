import { describe, expect, it } from 'vitest';
import { hexToOklch } from '../kit/colors';
import { LEVEL_COLORS, LIFT, PALETTE } from './palette';

// The rules Codex's look depends on: five real level colours in a gradient,
// marker colours that can never be mistaken for a level, two armies far apart
// in value, and a held piece only a little above a hovered one.

const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

const lab = ({ l, c, h }: { l: number; c: number; h: number }) => [
  l,
  c * Math.cos((h * Math.PI) / 180),
  c * Math.sin((h * Math.PI) / 180),
];

describe('codex palette', () => {
  const levels = LEVEL_COLORS.map(hexToOklch);

  it('has five real level colours in hue order, neighbours well apart', () => {
    expect(levels).toHaveLength(5);
    for (const c of levels) expect(c.c).toBeGreaterThan(0.1);
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
    // The last move's phosphor is nearly colourless: it reads as light, not a level
    expect(hexToOklch(PALETTE.trace).c).toBeLessThan(0.05);
  });

  it('keeps the armies far apart in value', () => {
    expect(hexToOklch(PALETTE.white).l - hexToOklch(PALETTE.black).l).toBeGreaterThan(0.6);
    // The dark army's edge light stays darker than the pale army's body
    expect(hexToOklch(PALETTE.blackRim).l).toBeLessThan(hexToOklch(PALETTE.white).l - 0.3);
  });

  it('lifts a held piece only a little above a hovered one', () => {
    expect(LIFT.selected).toBeGreaterThan(LIFT.hover);
    expect(LIFT.selected - LIFT.hover).toBeLessThanOrEqual(0.06);
  });
});
