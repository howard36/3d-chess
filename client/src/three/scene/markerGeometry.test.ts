import { describe, expect, it } from 'vitest';
import { pathDistances, tracePath, tubeData } from './markerGeometry';
import { fromZXY } from '../../engine/coords';
import type { Orientation } from '../layout';
import { towerLayout } from '../layout';
import type { Vec3 } from '../types';

const layout = towerLayout();
// MarkerProps.floor, as Board computes it: the cell's centre dropped to its floor
const floorOf = (zxy: string, o: Orientation): Vec3 => {
  const [x, y, z] = layout.toWorld(fromZXY(zxy), o);
  return [x, y + layout.floorY, z];
};

describe('the last-move line’s ends', () => {
  // Moves that come down onto their destination: diagonally (along a rank, a
  // file, and through the cube), straight down, and a knight's
  const MOVES: [string, string][] = [
    ['Eb4', 'Cb2'],
    ['Eb4', 'Da4'],
    ['Ed4', 'Ba1'],
    ['Dc4', 'Cc4'],
    ['Cc4', 'Bc3'],
    ['Eb5', 'Db3'],
    ['Eb5', 'Ec3'],
  ];
  const RADIAL = 8;
  const ringCentre = (tube: ReturnType<typeof tubeData>, s: number): Vec3 => {
    const c: Vec3 = [0, 0, 0];
    let n = 0;
    tube.along.forEach((a, v) => {
      // Each ring once round (its last vertex repeats its first, for the seam)
      if (Math.abs(a - s) > 1e-6 || v % (RADIAL + 1) === RADIAL) return;
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
      for (const [a, b] of MOVES) {
        const from = floorOf(a, o);
        const to = floorOf(b, o);
        const lift = 0.0225;
        const path = tracePath(from, to, { lift });
        expect(path[0]).toEqual([from[0], from[1] + lift, from[2]]);
        expect(path[path.length - 1]).toEqual([to[0], to[1] + lift, to[2]]);
        // And the tube built round it ends there too, not above the square
        const tube = tubeData(path, { radius: 0.01, radialSegments: RADIAL });
        const start = ringCentre(tube, 0);
        const end = ringCentre(tube, tube.length);
        for (let i = 0; i < 3; i++) {
          expect(start[i]).toBeCloseTo(path[0][i], 5);
          expect(end[i]).toBeCloseTo(path[path.length - 1][i], 5);
        }
      }
    }
  });
});

const vec = (a: Float32Array, i: number): Vec3 => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]];

// The point `s` world units along a straight path
const pointAt = ([a, b]: Vec3[], s: number): Vec3 => {
  const k = s / Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
};

describe('tubeData', () => {
  const straight = tracePath([0, 0, 0], [2, 0, -1], { lift: 0.03 });
  const rising = tracePath([0, 0, 0], [1, 1.35, -2]);
  const vertical = tracePath([1, 0, 1], [1, 2.7, 1]);

  it('is a round tube of the given radius round the path, with rounded ends', () => {
    for (const points of [straight, rising, vertical]) {
      const tube = tubeData(points, { radius: 0.02, radialSegments: 8, capSegments: 3 });
      const n = tube.along.length;
      const distances = pathDistances(points);
      const length = distances[distances.length - 1];
      expect(tube.length).toBeCloseTo(length);
      for (let v = 0; v < n; v++) {
        const p = vec(tube.position, v);
        const s = tube.along[v];
        // Every vertex lies a radius from the path (the caps from its ends)
        const point = pointAt(points, Math.min(Math.max(s, 0), length));
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

  it('has one ring of vertices at each end, the seam repeating its first vertex', () => {
    const tube = tubeData(straight, { radius: 0.04, radialSegments: 4, capSegments: 0 });
    // Two rings of five vertices
    expect(tube.along.length).toBe(10);
    expect(Array.from(tube.along.slice(0, 5))).toEqual(Array(5).fill(0));
    expect(vec(tube.position, 4)).toEqual(vec(tube.position, 0));
    for (const ring of [0, 1]) {
      const p = vec(tube.position, ring * 5);
      const c = straight[ring];
      expect(Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])).toBeCloseTo(0.04);
    }
  });
});
