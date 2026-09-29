import { describe, expect, it } from 'vitest';
import { hexToOklch, levelRamp, oklchToHex } from './colors';

const hueGap = (a: number, b: number) => {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return d;
};

describe('levelRamp', () => {
  it('gives five real colours, evenly spaced in hue, of one lightness and vividness', () => {
    const ramp = levelRamp({ from: 250, to: 20, lightness: [0.7, 0.7], chroma: 0.12 });
    expect(ramp).toHaveLength(5);
    expect(new Set(ramp).size).toBe(5);
    const lch = ramp.map(hexToOklch);
    for (const c of lch) {
      expect(c.l).toBeCloseTo(0.7, 2);
      // No white, black or grey: every colour keeps its chroma
      expect(c.c).toBeGreaterThan(0.1);
    }
    const steps = lch.slice(1).map((c, i) => hueGap(lch[i].h, c.h));
    for (const s of steps) expect(s).toBeCloseTo(-57.5, 0);
  });

  it('runs the way it is given, and can ramp lightness too', () => {
    const long = levelRamp({ from: 20, to: 260, lightness: [0.72, 0.72], chroma: 0.13 }).map(
      hexToOklch,
    );
    // Through yellow and green (about 110° and 145°), not magenta
    expect(long[2].h).toBeGreaterThan(120);
    expect(long[2].h).toBeLessThan(160);
    const shaded = levelRamp({ from: 200, to: 280, lightness: [0.5, 0.9], chroma: 0.13 }).map(
      hexToOklch,
    );
    for (let i = 1; i < 5; i++) expect(shaded[i].l).toBeGreaterThan(shaded[i - 1].l);
    expect(shaded[0].l).toBeCloseTo(0.5, 2);
    expect(shaded[4].l).toBeCloseTo(0.9, 2);
  });

  it('keeps a colour sRGB cannot show at its lightness and hue, giving up only chroma', () => {
    // A vivid cyan-green at high chroma is far outside sRGB
    const hex = oklchToHex({ l: 0.8, c: 0.3, h: 170 });
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    const back = hexToOklch(hex);
    expect(back.l).toBeCloseTo(0.8, 2);
    expect(Math.abs(hueGap(back.h, 170))).toBeLessThan(2);
    expect(back.c).toBeLessThan(0.3);
    expect(back.c).toBeGreaterThan(0.1);
  });

  it('round-trips colours sRGB can show', () => {
    for (const hex of ['#4cc9f0', '#ffd166', '#e8b0d0', '#2352b0']) {
      expect(oklchToHex(hexToOklch(hex))).toBe(hex);
    }
  });
});
