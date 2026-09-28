import { describe, expect, it } from 'vitest';
import { markerMetrics, pathDistances, pointAlong, tracePath, tubeData } from './markerGeometry';
import { movePoint } from '../../movePath';
import { fromZXY } from '../../../engine/coords';
import type { Orientation } from '../../layout';
import { clarityTower } from './layouts';
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

describe('the last-move line’s ends', () => {
  const layout = clarityTower();
  // MarkerProps.floor, as Board computes it: the cell's centre dropped to its floor
  const floorOf = (zxy: string, o: Orientation): Vec3 => {
    const [x, y, z] = layout.toWorld(fromZXY(zxy), o);
    return [x, y + layout.floorY, z];
  };
  // Moves that come down onto their destination: diagonally (along a rank, a
  // file, and through the cube), straight down, and over a knight's arc
  const MOVES: [string, string, number][] = [
    ['Eb4', 'Cb2', 0],
    ['Eb4', 'Da4', 0],
    ['Ed4', 'Ba1', 0],
    ['Dc4', 'Cc4', 0],
    ['Cc4', 'Bc3', 0],
    ['Eb5', 'Db3', 0.6],
    ['Eb5', 'Ec3', 0.6],
  ];
  const ringCentre = (tube: ReturnType<typeof tubeData>, s: number): Vec3 => {
    const c: Vec3 = [0, 0, 0];
    let n = 0;
    tube.along.forEach((a, v) => {
      // Each ring once round (its last vertex repeats its first, for the seam)
      if (Math.abs(a - s) > 1e-6 || tube.angle[v] === 1) return;
      const p = vec(tube.position, v);
      c[0] += p[0];
      c[1] += p[1];
      c[2] += p[2];
      n++;
    });
    return [c[0] / n, c[1] / n, c[2] / n];
  };

  it('sit exactly `lift` above the centres of both floors, from either seat', () => {
    for (const o of ['white', 'black'] as const) {
      for (const [a, b, arc] of MOVES) {
        const from = floorOf(a, o);
        const to = floorOf(b, o);
        const lift = 0.0225;
        const path = tracePath(from, to, { lift, arc, segments: 24 });
        expect(path[0]).toEqual([from[0], from[1] + lift, from[2]]);
        expect(path[path.length - 1]).toEqual([to[0], to[1] + lift, to[2]]);
        // And the tube built round it ends there too, not above the square
        const tube = tubeData(path, { radius: 0.01, radialSegments: 8 });
        const start = ringCentre(tube, 0);
        const end = ringCentre(tube, tube.length);
        for (let i = 0; i < 3; i++) {
          expect(start[i]).toBeCloseTo(path[0][i], 5);
          expect(end[i]).toBeCloseTo(path[path.length - 1][i], 5);
        }
      }
    }
  });

  it('with an inset, land on the destination floor beside its piece and never pass through it', () => {
    const inset = 0.268;
    const lift = 0.02;
    for (const o of ['white', 'black'] as const) {
      for (const [a, b, arc] of [...MOVES, ['Cc4', 'Dc4', 0] as [string, string, number]]) {
        const from = floorOf(a, o);
        const to = floorOf(b, o);
        const path = tracePath(from, to, { lift, arc, segments: 24, inset });
        expect(path[0]).toEqual([from[0], from[1] + lift, from[2]]);
        const end = path[path.length - 1];
        // On the destination's floor, `inset` from its centre...
        expect(end[1]).toBeCloseTo(to[1] + lift);
        expect(Math.hypot(end[0] - to[0], end[2] - to[2])).toBeCloseTo(inset);
        // ...on the side facing the source (or +x for a move straight up or down)
        const dx = from[0] - to[0];
        const dz = from[2] - to[2];
        const facing =
          Math.hypot(dx, dz) > 1e-6
            ? (end[0] - to[0]) * dx + (end[2] - to[2]) * dz
            : end[0] - to[0];
        expect(facing).toBeGreaterThan(0);
        // Nowhere within the piece's footprint, at any height up to its top
        for (const p of path) {
          const r = Math.hypot(p[0] - to[0], p[2] - to[2]);
          const above = p[1] - to[1];
          if (above > -0.01 && above < 0.7) expect(r).toBeGreaterThan(0.12);
        }
      }
    }
  });
});

describe('the last-move line’s landing, seen from the seat', () => {
  const layout = clarityTower();
  const floorOf = (zxy: string, o: Orientation): Vec3 => {
    const [x, y, z] = layout.toWorld(fromZXY(zxy), o);
    return [x, y + layout.floorY, z];
  };
  it('never lands behind the piece from the seat (+z), and still clears it', () => {
    const inset = 0.268;
    const moves: [string, string][] = [
      ['Ec4', 'Dc3'],
      ['Ec5', 'Dd4'],
      ['Aa1', 'Aa2'],
      ['Cc3', 'Dc4'],
      ['Bc3', 'Ac3'],
    ];
    for (const o of ['white', 'black'] as const) {
      for (const [a, b] of moves) {
        const from = floorOf(a, o);
        const to = floorOf(b, o);
        const path = tracePath(from, to, { lift: 0.02, inset, insetFront: [0, 1] });
        const end = path[path.length - 1];
        expect(Math.hypot(end[0] - to[0], end[2] - to[2])).toBeCloseTo(inset);
        expect(end[2] - to[2]).toBeGreaterThan(-1e-9);
        // The straight line stays clear of the piece all the way: outside its
        // base (a king's reaches 0.21 at scale 0.8), and, coming straight
        // down, outside its narrower body higher up
        const vertical = Math.hypot(from[0] - to[0], from[2] - to[2]) < 1e-6;
        for (let t = 0; t <= 1; t += 0.02) {
          const px = from[0] + (end[0] - from[0]) * t;
          const pz = from[2] + (end[2] - from[2]) * t;
          const up = from[1] + (end[1] - from[1]) * t - to[1];
          const r = Math.hypot(px - to[0], pz - to[2]);
          if (up > -0.01 && up < 0.12) expect(r).toBeGreaterThan(0.23);
          else if (up > -0.01 && up < 0.56) expect(r).toBeGreaterThan(vertical ? 0.15 : 0.23);
          // (a head or a cross, at most 0.08 across)
          else if (up > -0.01 && up < 0.7) expect(r).toBeGreaterThan(vertical ? 0.09 : 0.23);
        }
      }
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
