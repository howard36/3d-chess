import { describe, expect, it } from 'vitest';
import {
  hexToOklch,
  levelRamp,
  mixWithWhite,
  okhsvToOklch,
  oklchToHex,
  oklchToOkhsv,
} from './colors';

const hueGap = (a: number, b: number) => {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return d;
};

describe('levelRamp', () => {
  const okhsv = (hex: string) => oklchToOkhsv(hexToOklch(hex));

  it('gives five real colours, evenly spaced in hue, all equally vivid', () => {
    const ramp = levelRamp({ from: 20, to: 140, saturation: 0.7, value: 0.95, minLightness: 0 });
    expect(ramp).toHaveLength(5);
    expect(new Set(ramp).size).toBe(5);
    const lch = ramp.map(hexToOklch);
    const steps = lch.slice(1).map((c, i) => hueGap(lch[i].h, c.h));
    for (const s of steps) expect(s).toBeCloseTo(30, 0);
    for (const hex of ramp) {
      expect(okhsv(hex).s).toBeCloseTo(0.7, 2);
      expect(okhsv(hex).v).toBeCloseTo(0.95, 2);
    }
  });

  it('is equally vivid where one chroma is not: a full cyan and a pastel blue are not alike', () => {
    // One OKLCH chroma (0.13): cyan at the edge of what sRGB shows, blue far inside it
    const cyan = oklchToOkhsv({ l: 0.8, c: 0.13, h: 200 }).s;
    const blue = oklchToOkhsv({ l: 0.75, c: 0.13, h: 275 }).s;
    expect(cyan - blue).toBeGreaterThan(0.4);
    const [c, b] = levelRamp({ from: 200, to: 275, saturation: 0.6, value: 0.93, minLightness: 0 })
      .filter((_, i) => i === 0 || i === 4)
      .map(okhsv);
    expect(c.s).toBeCloseTo(b.s, 2);
  });

  it('holds a dark hue at the lightness floor, as vivid as sRGB lets it be there', () => {
    // Blue at this saturation and value is darker than 0.62 ...
    expect(okhsvToOklch(265, 0.8, 0.93).l).toBeLessThan(0.6);
    const ramp = levelRamp({
      from: 265,
      to: 205,
      saturation: 0.8,
      value: 0.93,
      minLightness: 0.62,
    });
    const blue = hexToOklch(ramp[0]);
    // ... so it stands at the floor, and gives up only what sRGB cannot show there
    expect(blue.l).toBeCloseTo(0.62, 2);
    expect(okhsv(ramp[0]).s).toBeGreaterThan(0.7);
    // A light hue is untouched by the floor
    expect(okhsv(ramp[4]).s).toBeCloseTo(0.8, 2);
    expect(hexToOklch(ramp[4]).l).toBeGreaterThan(0.7);
  });

  it('round-trips Okhsv', () => {
    for (const [h, s, v] of [
      [30, 0.5, 0.9],
      [200, 0.8, 0.95],
      [300, 0.3, 0.6],
    ]) {
      const back = oklchToOkhsv(okhsvToOklch(h, s, v));
      expect(back.s).toBeCloseTo(s, 4);
      expect(back.v).toBeCloseTo(v, 4);
    }
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

describe('mixWithWhite', () => {
  it('lightens evenly and fades the colour in proportion, holding the hue', () => {
    const blue = '#4180f3';
    const a = hexToOklch(blue);
    const b = hexToOklch(mixWithWhite(blue, 0.2));
    expect(b.l).toBeCloseTo(a.l + (1 - a.l) * 0.2, 2);
    expect(b.c).toBeCloseTo(a.c * 0.8, 2);
    expect(Math.abs(hueGap(a.h, b.h))).toBeLessThan(1);
    expect(mixWithWhite(blue, 0)).toBe(blue);
    expect(mixWithWhite(blue, 1)).toBe('#ffffff');
  });
});
