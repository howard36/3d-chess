import { describe, expect, it } from 'vitest';
import { RIM_SAMPLES, rimColour, rimGradient, rimPoints } from './rim';

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
});
