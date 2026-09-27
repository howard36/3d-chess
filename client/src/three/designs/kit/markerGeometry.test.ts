import { describe, expect, it } from 'vitest';
import { markerMetrics, pathDistances, pointAlong, tracePath, tubeData } from './markerGeometry';
import { movePoint } from '../../movePath';
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

describe('tracePath', () => {
  it('runs straight from the centre of one floor to the centre of the other, just off the platform', () => {
    for (const [from, to] of [
      [
        [-1, 0, 1],
        [2, 0, -1],
      ],
      // Between levels: still one straight segment
      [
        [0, 0, 0],
        [1, 2.7, -1],
      ],
      [
        [0, 2.7, 0],
        [-2, 0, 0],
      ],
    ] as [Vec3, Vec3][]) {
      const path = tracePath(from, to, { lift: 0.03 });
      expect(path).toEqual([
        [from[0], from[1] + 0.03, from[2]],
        [to[0], to[1] + 0.03, to[2]],
      ]);
    }
  });

  it('runs a vertical move straight up or down through the squares’ centres', () => {
    for (const [from, to] of [
      [
        [1, 0, 1],
        [1, 2.7, 1],
      ],
      [
        [1, 2.7, 1],
        [1, 0, 1],
      ],
    ] as [Vec3, Vec3][]) {
      const path = tracePath(from, to);
      expect(path).toHaveLength(2);
      for (const p of path) {
        expect(p[0]).toBe(1);
        expect(p[2]).toBe(1);
      }
      expect(path[0][1]).toBeGreaterThan(from[1]);
      expect(path[1][1] - path[0][1]).toBeCloseTo(to[1] - from[1]);
    }
  });

  it('follows a knight’s arc exactly where the piece flies, at the same height whatever the level change', () => {
    for (const to of [
      [2, 0, 1],
      [1, 1.35, -2],
      [0, 2.7, 1],
      [2, -1.35, 0],
    ] as Vec3[]) {
      const from: Vec3 = [0, 0, 0];
      const path = tracePath(from, to, { lift: 0.03, arc: 0.6, segments: 20 });
      expect(path).toHaveLength(21);
      path.forEach((p, i) => {
        const on = movePoint(from, to, i / 20, 0.6);
        expect(p[0]).toBeCloseTo(on[0]);
        expect(p[1]).toBeCloseTo(on[1] + 0.03);
        expect(p[2]).toBeCloseTo(on[2]);
      });
      // Mid-flight it is the arc's height above the straight line between the ends
      const mid = path[10];
      expect(mid[1] - (0.03 + to[1] / 2)).toBeCloseTo(0.6);
    }
  });
});

describe('pointAlong', () => {
  const points: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 2, 0],
  ];

  it('walks the path by distance, clamped to its ends', () => {
    expect(pathDistances(points)).toEqual([0, 1, 3]);
    expect(pointAlong(points, 0.5).point).toEqual([0.5, 0, 0]);
    expect(pointAlong(points, 2).point).toEqual([1, 1, 0]);
    expect(pointAlong(points, 2).tangent).toEqual([0, 1, 0]);
    expect(pointAlong(points, -1).point).toEqual([0, 0, 0]);
    expect(pointAlong(points, 9).point).toEqual([1, 2, 0]);
  });
});

const vec = (a: Float32Array, i: number): Vec3 => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]];

describe('tubeData', () => {
  const straight = tracePath([0, 0, 0], [2, 0, -1], { lift: 0.03 });
  const arc = tracePath([0, 0, 0], [1, 1.35, -2], { arc: 0.6, segments: 16 });
  const vertical = tracePath([1, 0, 1], [1, 2.7, 1]);

  it('is a round tube of the given radius round the path, with rounded ends', () => {
    for (const points of [straight, arc, vertical]) {
      const tube = tubeData(points, { radius: 0.02, radialSegments: 8, capSegments: 3 });
      const n = tube.along.length;
      const distances = pathDistances(points);
      const length = distances[distances.length - 1];
      expect(tube.length).toBeCloseTo(length);
      for (let v = 0; v < n; v++) {
        const p = vec(tube.position, v);
        const s = tube.along[v];
        // Every vertex lies a radius from the path (the caps from its ends)
        const { point } = pointAlong(points, Math.min(Math.max(s, 0), length));
        const d = Math.hypot(p[0] - point[0], p[1] - point[1], p[2] - point[2]);
        expect(d).toBeCloseTo(0.02, 4);
        // Unit normals, pointing out of the tube
        const nrm = vec(tube.normal, v);
        expect(Math.hypot(...nrm)).toBeCloseTo(1, 4);
        const out = [p[0] - point[0], p[1] - point[1], p[2] - point[2]];
        expect(nrm[0] * out[0] + nrm[1] * out[1] + nrm[2] * out[2]).toBeGreaterThan(0.019);
      }
      // The caps run a radius past either end
      expect(Math.min(...tube.along)).toBeCloseTo(-0.02);
      expect(Math.max(...tube.along)).toBeCloseTo(length + 0.02);
    }
  });

  it('winds every triangle to face out of the tube', () => {
    const tube = tubeData(straight, { radius: 0.05, radialSegments: 6, capSegments: 0 });
    const { index, position, normal } = tube;
    expect(index.length % 3).toBe(0);
    for (let i = 0; i < index.length; i += 3) {
      const [a, b, c] = [index[i], index[i + 1], index[i + 2]].map((v) => vec(position, v));
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const face = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      const nrm = vec(normal, index[i]);
      expect(face[0] * nrm[0] + face[1] * nrm[1] + face[2] * nrm[2]).toBeGreaterThan(0);
    }
  });

  it('tapers where asked, and says where round the tube each vertex is', () => {
    const tube = tubeData(straight, {
      radius: 0.04,
      radialSegments: 4,
      capSegments: 0,
      radiusAt: (s, total) => 0.04 * (0.25 + (0.75 * s) / total),
    });
    // Two rings of five vertices (the seam repeats)
    expect(tube.along.length).toBe(10);
    const ringRadius = (ring: number) => {
      const p = vec(tube.position, ring * 5);
      const c = straight[ring];
      return Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
    };
    expect(ringRadius(0)).toBeCloseTo(0.01);
    expect(ringRadius(1)).toBeCloseTo(0.04);
    expect(Array.from(tube.angle.slice(0, 5))).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
});
