import { describe, expect, it } from 'vitest';
import { hexToOklch, levelRamp, oklchToOkhsv } from './colors';
import { LEVEL_COLORS, LEVEL_RAMP, PALETTE } from './palette';

// The rules the board's look depends on: five real level colours in a
// gradient, and marker colours that can never be mistaken for a level.

const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

describe('the palette', () => {
  const levels = LEVEL_COLORS.map(hexToOklch);

  it('is levelRamp written out', () => {
    expect(LEVEL_COLORS).toEqual(levelRamp(LEVEL_RAMP));
  });

  it('has five real level colours in hue order, neighbours well apart', () => {
    expect(levels).toHaveLength(5);
    for (const c of levels) expect(c.c).toBeGreaterThan(0.1);
    const lab = ({ l, c, h }: { l: number; c: number; h: number }) => [
      l,
      c * Math.cos((h * Math.PI) / 180),
      c * Math.sin((h * Math.PI) / 180),
    ];
    for (let i = 1; i < 5; i++) {
      // Rose at the base round to sky at the top, hue falling level by level
      expect(levels[i].h).toBeLessThan(levels[i - 1].h - 25);
      const [p, q] = [lab(levels[i - 1]), lab(levels[i])];
      expect(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])).toBeGreaterThan(0.08);
    }
  });

  it('looks equally vivid on every level, none of them dim', () => {
    for (const c of levels) {
      expect(oklchToOkhsv(c).s).toBeCloseTo(LEVEL_RAMP.saturation, 2);
      expect(c.l).toBeGreaterThanOrEqual(LEVEL_RAMP.minLightness - 0.005);
    }
  });

  it('keeps capture and check red clear of the rose level', () => {
    for (const hex of [PALETTE.capture, PALETTE.check]) {
      const m = hexToOklch(hex);
      for (const c of levels) expect(hueGap(m.h, c.h)).toBeGreaterThan(30);
    }
    // White light for the held piece and the sculptures: nearly colourless
    for (const hex of [PALETTE.light, PALETTE.neon]) {
      expect(hexToOklch(hex).c).toBeLessThan(0.03);
    }
  });

  it('gives moves and the last move colours of their own, clear of every level', () => {
    const move = hexToOklch(PALETTE.move);
    const trace = hexToOklch(PALETTE.trace);
    for (const c of levels) {
      // A move's gold is far from every level, so it never reads as a level ring
      expect(hueGap(move.h, c.h)).toBeGreaterThan(60);
      expect(hueGap(trace.h, c.h)).toBeGreaterThan(30);
    }
    for (const red of [PALETTE.capture, PALETTE.check].map(hexToOklch)) {
      expect(hueGap(move.h, red.h)).toBeGreaterThan(40);
      expect(hueGap(trace.h, red.h)).toBeGreaterThan(90);
    }
    expect(hueGap(move.h, trace.h)).toBeGreaterThan(60);
    // Both clearly coloured, unlike the white light of the held piece
    expect(move.c).toBeGreaterThan(0.08);
    expect(trace.c).toBeGreaterThan(0.05);
  });
});
