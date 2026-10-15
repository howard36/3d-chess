import { describe, expect, it } from 'vitest';
import { RIM_SAMPLES, rimColour, rimFacing, rimGradient, rimPoints } from './rim';

const SKY = 'rgb(71,187,236)';
const VIOLET = 'rgb(143,97,252)';
const ROSE = 'rgb(236,83,155)';

/** The colour the gradient gives at a bearing it has a stop at. */
const colourAt = (css: string, angle: number) =>
  css.match(new RegExp(`(rgb\\([^)]*\\)) ${angle.toFixed(2)}deg`))?.[1];

describe('the rim of the pill of starlight', () => {
  it('runs sky to rose along a half turn', () => {
    expect(rimColour(0)).toBe(SKY);
    expect(rimColour(0.08)).toBe(SKY);
    expect(rimColour(0.5)).toBe(VIOLET);
    expect(rimColour(0.92)).toBe(ROSE);
    expect(rimColour(1)).toBe(ROSE);
  });

  it('places its colours at even steps of distance round the pill, bearings in order', () => {
    for (const [w, h] of [
      [240, 52],
      [360, 52],
      [270, 58],
      [52, 52],
    ]) {
      const points = rimPoints(w, h);
      expect(points).toHaveLength(RIM_SAMPLES);
      points.forEach((p, i) => expect(p.at).toBeCloseTo(i / RIM_SAMPLES));
      for (let i = 1; i < points.length; i++) {
        expect(points[i].angle).toBeGreaterThan(points[i - 1].angle);
      }
      // The right end, the bottom's middle and the left end are a quarter,
      // a half and three quarters round from the top's middle
      expect(points[RIM_SAMPLES / 4].angle).toBeCloseTo(90);
      expect(points[RIM_SAMPLES / 2].angle).toBeCloseTo(180);
      expect(points[(3 * RIM_SAMPLES) / 4].angle).toBeCloseTo(270);
    }
  });

  it('crosses the long edges no faster than the ends', () => {
    // A straight gradient turned at an even rate sweeps the top edge in the
    // few degrees it spends near upright; here the share of a lap a colour
    // spends on the top edge is that edge's share of the rim
    const [w, h] = [240, 52];
    const r = (h - 2) / 2;
    const length = 2 * (w - h) + 2 * Math.PI * r;
    const half = (w - h) / 2;
    const corner = (Math.atan2(half, r) * 180) / Math.PI;
    const onTop = rimPoints(w, h).filter((p) => p.angle <= corner || p.angle >= 360 - corner);
    expect(onTop.length / RIM_SAMPLES).toBeCloseTo((w - h) / length, 1);
  });

  it('rests sky at the left end and rose at the right, and turns clockwise', () => {
    const points = rimPoints(240, 52);
    const rest = rimGradient(points, 0);
    expect(rest).toMatch(/^conic-gradient\(.*360deg\)$/);
    expect(colourAt(rest, 90)).toBe(ROSE);
    expect(colourAt(rest, 270)).toBe(SKY);
    const quarter = rimGradient(points, 0.25);
    expect(colourAt(quarter, 180)).toBe(ROSE);
    expect(colourAt(quarter, 0)).toBe(SKY);
    expect(rimGradient(points, 1)).toBe(rest);
  });

  it("runs round a tile's rounded corners at the same even steps", () => {
    // The start page's tile: 14 px corners, the rim's middle 0.75 px in
    const [w, h, radius, inset] = [165, 116, 14, 0.75];
    const points = rimPoints(w, h, { radius, inset });
    for (let i = 1; i < points.length; i++) {
      expect(points[i].angle).toBeGreaterThan(points[i - 1].angle);
    }
    // The middles of the sides a quarter round apart, as in any box
    expect(rimFacing(w, h, { radius, inset }, 90)).toBeCloseTo(0.25, 5);
    expect(rimFacing(w, h, { radius, inset }, 180)).toBeCloseTo(0.5, 5);
    expect(rimFacing(w, h, { radius, inset }, 270)).toBeCloseTo(0.75, 5);
    // The share of a lap a colour spends on the top's straight run is its share of the rim
    const r = radius - inset;
    const across = w - 2 * inset - 2 * r;
    const down = h - 2 * inset - 2 * r;
    const length = 2 * across + 2 * down + 2 * Math.PI * r;
    const end = (Math.atan2(across / 2, h / 2 - inset) * 180) / Math.PI;
    const onTop = points.filter((p) => p.angle <= end || p.angle >= 360 - end);
    expect(onTop.length / RIM_SAMPLES).toBeCloseTo(across / length, 1);
  });

  it('finds the point of the rim facing a way', () => {
    // A pill's ends, whichever way round the bearing is given
    expect(rimFacing(240, 52, {}, 270)).toBeCloseTo(0.75, 5);
    expect(rimFacing(240, 52, {}, -90)).toBeCloseTo(0.75, 5);
    expect(rimFacing(240, 52, {}, 0)).toBe(0);
    // A tile's corner faces the diagonal: on its arc, where its points' bearings
    // lean that way, nowhere near the top's middle
    const [w, h, radius, inset] = [146, 46, 14, 0.75];
    const at = rimFacing(w, h, { radius, inset }, 308);
    const r = radius - inset;
    const across = w - 2 * inset - 2 * r;
    const down = h - 2 * inset - 2 * r;
    const length = 2 * across + 2 * down + 2 * Math.PI * r;
    const cornerStart = (across / 2 + across + 2 * down + (3 * Math.PI * r) / 2) / length;
    expect(at).toBeGreaterThan(cornerStart);
    expect(at).toBeLessThan(cornerStart + (Math.PI * r) / 2 / length);
    expect(rimFacing(0, 0, {}, 90)).toBe(0);
  });

  it('rests sky where it is asked to', () => {
    const box = { radius: 14, inset: 0.75 };
    const points = rimPoints(165, 116, box);
    const sky = rimFacing(165, 116, box, 308);
    const css = rimGradient(points, 0, sky);
    const first = points.find((p) => Math.abs(p.at - sky) < 1 / RIM_SAMPLES)!;
    expect(colourAt(css, first.angle)).toBe(SKY);
    const rose = (sky + 0.5) % 1;
    const across = points.find((p) => Math.abs(p.at - rose) < 1 / RIM_SAMPLES)!;
    expect(colourAt(css, across.angle)).toBe(ROSE);
  });
});
