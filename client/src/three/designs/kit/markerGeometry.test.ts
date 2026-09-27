import { describe, expect, it } from 'vitest';
import { markerMetrics, ribbonData, tracePath } from './markerGeometry';
import type { Vec3 } from '../types';

describe('markerMetrics', () => {
  it('keeps every stroke inside its own square', () => {
    for (const pitch of [1, 1.25]) {
      const m = markerMetrics(pitch, { inset: 0.05, lineWidth: 0.1 });
      expect(m.half + m.lineWidth / 2).toBeLessThanOrEqual(pitch / 2);
      expect(m.ringRadius + m.lineWidth / 2).toBeLessThanOrEqual(pitch / 2);
      expect(m.quad).toBe(pitch);
    }
  });

  it('rings a piece where it stands, clear of the widest base', () => {
    // The Staunton king's base is 0.28 across its radius
    expect(markerMetrics(1).ringRadius).toBeGreaterThan(0.28);
  });

  it('widens a capture ring past the victim’s base, its ticks pointing out and inside the square', () => {
    for (const pitch of [1, 1.2]) {
      const m = markerMetrics(pitch);
      expect(m.captureRing).toBeGreaterThanOrEqual(0.42 * pitch);
      expect(m.captureRing).toBeGreaterThan(m.ringRadius);
      expect(m.captureRing + m.lineWidth / 2).toBeLessThanOrEqual(pitch / 2);
      // Outward along the diagonal, ending before the square's corner
      expect(m.captureTick).toBeGreaterThan(0.1 * pitch);
      const end = (m.captureRing + m.lineWidth / 2 + m.captureTick) / Math.SQRT2;
      expect(end + m.lineWidth / 2).toBeLessThanOrEqual(pitch / 2);
    }
    // Never smaller than an explicitly larger plain ring
    expect(markerMetrics(1, { ringRadius: 0.45 }).captureRing).toBeCloseTo(0.45);
  });

  it('stops the brackets short of the middle of each side, where the capture ticks go', () => {
    const m = markerMetrics(1);
    expect(m.bracketStart).toBeGreaterThan(m.lineWidth);
    expect(m.bracketStart).toBeLessThan(m.half);
    expect(m.tickLength).toBeLessThan(m.half);
  });
});

const flatDist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);

describe('tracePath', () => {
  it('runs straight along a platform, lifted off it, stopping short of the piece that moved', () => {
    const from: Vec3 = [-1, 0, 1];
    const to: Vec3 = [2, 0, -1];
    const path = tracePath(from, to, { lift: 0.05, endInset: 0.3, startInset: 0.1 });
    expect(path).toHaveLength(2);
    const [a, b] = path;
    expect(a[1]).toBeCloseTo(0.05);
    expect(b[1]).toBeCloseTo(0.05);
    expect(flatDist(b, to)).toBeCloseTo(0.3);
    expect(flatDist(a, from)).toBeCloseTo(0.1);
    // Still heading from the source toward the destination
    expect(flatDist(a, to)).toBeGreaterThan(flatDist(b, to));
  });

  it('arcs over the higher level between levels, and lands on the destination from above', () => {
    for (const [from, to] of [
      [
        [0, 0, 0],
        [1, 2.7, -1],
      ],
      [
        [0, 2.7, 0],
        [-2, 0, 0],
      ],
    ] as [Vec3, Vec3][]) {
      const path = tracePath(from, to, { arc: 0.4 });
      expect(path.length).toBeGreaterThan(10);
      const top = Math.max(...path.map((p) => p[1]));
      // The apex clears the higher end by the arc (within the sampling)
      expect(top).toBeCloseTo(Math.max(from[1], to[1]) + 0.04 + 0.4, 2);
      const end = path[path.length - 1];
      const before = path[path.length - 2];
      expect(end[1]).toBeLessThan(before[1]);
      expect(end[1]).toBeCloseTo(to[1] + 0.04);
    }
  });

  it('runs a purely vertical move up the front of its column', () => {
    const path = tracePath([1, 0, 1], [1, 2.7, 1], { endInset: 0.35 });
    expect(path).toHaveLength(2);
    for (const p of path) {
      expect(p[0]).toBeCloseTo(1);
      expect(p[2]).toBeCloseTo(1.35);
    }
  });

  it('never lets the insets swallow a one-square move', () => {
    const [a, b] = tracePath([0, 0, 0], [0.5, 0, 0], { endInset: 0.4, startInset: 0.2 });
    expect(b[0] - a[0]).toBeGreaterThan(0.15);
  });
});

describe('ribbonData', () => {
  const points: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
    [3, 0, 0],
  ];
  const data = ribbonData(points, { width: 0.1, headLength: 0.3, headWidth: 0.3 });

  it('ends in the arrow tip, at the last point, with no width', () => {
    const n = data.side.length;
    for (const v of [n - 2, n - 1]) {
      expect(Array.from(data.position.slice(v * 3, v * 3 + 3))).toEqual([3, 0, 0]);
      expect(data.halfWidth[v]).toBe(0);
      expect(data.along[v]).toBeCloseTo(3);
    }
    expect(data.length).toBeCloseTo(3);
  });

  it('widens to the arrowhead at its neck, a head length before the tip', () => {
    const halves = Array.from(data.halfWidth);
    expect(Math.max(...halves)).toBeCloseTo(0.15);
    const neck = halves.findIndex((h) => Math.abs(h - 0.15) < 1e-6);
    expect(data.along[neck]).toBeCloseTo(2.7);
    expect(data.position[neck * 3]).toBeCloseTo(2.7);
  });

  it('pairs every centreline sample into two sides and stitches them into triangles', () => {
    const n = data.side.length;
    expect(n % 2).toBe(0);
    for (let i = 0; i < n; i += 2) {
      expect(data.side[i]).toBe(-1);
      expect(data.side[i + 1]).toBe(1);
    }
    expect(data.index.length % 3).toBe(0);
    expect(Math.max(...data.index)).toBe(n - 1);
    // Tangents point along the path
    for (let i = 0; i < n; i++) expect(data.tangent[i * 3]).toBeCloseTo(1);
  });

  it('keeps the arrowhead within a short path', () => {
    const short = ribbonData(
      [
        [0, 0, 0],
        [0.2, 0, 0],
      ],
      { width: 0.1, headLength: 0.3, headWidth: 0.3 },
    );
    const neck = Array.from(short.halfWidth).findIndex((h) => Math.abs(h - 0.15) < 1e-6);
    expect(short.along[neck]).toBeGreaterThan(0);
  });
});
