import { describe, expect, it } from 'vitest';
import { FILES, LEVELS, RANKS } from '../../../engine/coords';
import { clarityTower, towerFrame } from './layouts';
import {
  cameraAzimuth,
  cameraRight,
  chooseEdges,
  chooseLevelCorner,
  CORNERS,
  labelAnchors,
} from './labelAnchors';
import type { AnchorState } from './labelAnchors';
import type { Vec3 } from '../types';

const layout = clarityTower();
const frame = towerFrame(layout);
const TARGET: Vec3 = [0, 0, 0];
const DEG = Math.PI / 180;

/** A camera `distance` from the centre at this azimuth and elevation (degrees). */
const cameraAt = (azimuth: number, elevation = 22, distance = 13): Vec3 => [
  Math.sin(azimuth * DEG) * Math.cos(elevation * DEG) * distance,
  Math.sin(elevation * DEG) * distance,
  Math.cos(azimuth * DEG) * Math.cos(elevation * DEG) * distance,
];

/** Horizontal screen coordinate (tangent of the view angle) of a point. */
const screenX = (camera: Vec3, p: Vec3) => {
  const f = [TARGET[0] - camera[0], TARGET[1] - camera[1], TARGET[2] - camera[2]];
  const fl = Math.hypot(f[0], f[1], f[2]);
  const r = cameraRight(camera, TARGET);
  const v = [p[0] - camera[0], p[1] - camera[1], p[2] - camera[2]];
  const depth = (v[0] * f[0] + v[1] * f[1] + v[2] * f[2]) / fl;
  return (v[0] * r[0] + v[2] * r[2]) / depth;
};

const AZIMUTHS = [0, 16, 45, 80, 100, 135, 180, 225, 270, 315, -16];

describe('label anchors', () => {
  for (const orientation of ['white', 'black'] as const) {
    describe(`as ${orientation}`, () => {
      it.each(AZIMUTHS)('keeps every label outside the tower from azimuth %i°', (azimuth) => {
        const camera = cameraAt(azimuth);
        const { labels } = labelAnchors(layout, orientation, camera, TARGET, null);
        expect(labels).toHaveLength(15);
        for (const { position } of labels) {
          // Outside the platforms' footprint on at least one axis
          expect(Math.max(Math.abs(position[0]), Math.abs(position[2]))).toBeGreaterThan(
            frame.half + 0.2,
          );
        }
      });

      it.each(AZIMUTHS)('puts each level letter left of its whole platform from %i°', (azimuth) => {
        for (const elevation of [8, 22, 45]) {
          const camera = cameraAt(azimuth, elevation);
          const { labels } = labelAnchors(layout, orientation, camera, TARGET, null);
          for (const label of labels.filter((l) => l.level !== undefined)) {
            const y = frame.levelY[label.level!];
            const corners = CORNERS.map(
              ([sx, sz]) => [sx * frame.half, y, sz * frame.half] as Vec3,
            );
            const leftmost = Math.min(...corners.map((c) => screenX(camera, c)));
            expect(screenX(camera, label.position)).toBeLessThan(leftmost);
            expect(label.text).toBe(LEVELS[label.level!]);
            // Beside its own platform, not another one
            expect(label.position[1]).toBeGreaterThan(y);
            expect(label.position[1]).toBeLessThan(y + frame.gap / 2);
          }
        }
      });

      it.each(AZIMUTHS)(
        'runs files and ranks along the bottom edges nearest the camera from %i°',
        (azimuth) => {
          const camera = cameraAt(azimuth);
          const { labels } = labelAnchors(layout, orientation, camera, TARGET, null);
          const files = labels.filter((l) => l.id.startsWith('file-'));
          const ranks = labels.filter((l) => l.id.startsWith('rank-'));
          expect(files.map((l) => l.text)).toEqual(FILES);
          expect(ranks.map((l) => l.text)).toEqual(RANKS);
          const cos = Math.cos(azimuth * DEG);
          const sin = Math.sin(azimuth * DEG);
          for (const f of files) {
            expect(f.position[1]).toBeCloseTo(frame.levelY[0]);
            if (Math.abs(cos) > 0.2) expect(Math.sign(f.position[2])).toBe(Math.sign(cos));
          }
          for (const r of ranks) {
            if (Math.abs(sin) > 0.2) expect(Math.sign(r.position[0])).toBe(Math.sign(sin));
          }
          // Each file label lines up with its file's squares, each rank with its rank's
          files.forEach((f, x) => {
            expect(f.position[0]).toBeCloseTo(layout.toWorld({ x, y: 0, z: 0 }, orientation)[0]);
          });
          ranks.forEach((r, y) => {
            expect(r.position[2]).toBeCloseTo(layout.toWorld({ x: 0, y, z: 0 }, orientation)[2]);
          });
        },
      );
    });
  }

  it("mirrors the files for Black: White's a is Black's e", () => {
    const camera = cameraAt(16);
    const white = labelAnchors(layout, 'white', camera, TARGET, null).labels;
    const black = labelAnchors(layout, 'black', camera, TARGET, null).labels;
    const x = (labels: typeof white, id: string) => labels.find((l) => l.id === id)!.position[0];
    expect(x(white, 'file-a-0')).toBeCloseTo(-2);
    expect(x(black, 'file-a-0')).toBeCloseTo(2);
    expect(x(black, 'file-e-0')).toBeCloseTo(-2);
  });

  it('opens with the level letters at the near-left corner and ranks on the right', () => {
    const { state } = labelAnchors(layout, 'white', cameraAt(16), TARGET, null);
    expect(CORNERS[state.corners[0]]).toEqual([-1, 1]);
    expect(state.edges).toEqual({ files: 1, ranks: 1 });
  });

  it('labels every platform on request', () => {
    const { labels } = labelAnchors(layout, 'white', cameraAt(30), TARGET, null, {
      everyLevel: true,
    });
    expect(labels).toHaveLength(5 * 10 + 5);
    expect(new Set(labels.map((l) => l.id)).size).toBe(labels.length);
  });

  it('carries each level letter round all four corners in a full orbit', () => {
    let state: AnchorState | null = null;
    const keys = new Set<string>();
    for (let a = 0; a <= 360; a += 5) {
      const next = labelAnchors(layout, 'white', cameraAt(a), TARGET, state);
      state = next.state;
      keys.add(next.labels.find((l) => l.id === 'level-C')!.key);
    }
    expect(keys.size).toBe(4);
  });
});

describe('hysteresis', () => {
  it('holds an edge while the camera wavers around the tie, and gives it up past the band', () => {
    let edges = chooseEdges(80 * DEG, null);
    expect(edges.files).toBe(1);
    // Around 90° the two z-edges tie; within the band nothing changes
    for (const a of [88, 92, 96, 91, 97, 89]) {
      edges = chooseEdges(a * DEG, edges);
      expect(edges.files).toBe(1);
    }
    edges = chooseEdges(104 * DEG, edges);
    expect(edges.files).toBe(-1);
    // And coming back, it holds the new edge until past the band on the other side
    edges = chooseEdges(84 * DEG, edges);
    expect(edges.files).toBe(-1);
    edges = chooseEdges(76 * DEG, edges);
    expect(edges.files).toBe(1);
  });

  it('keeps a level corner unless another is clearly further left', () => {
    const y = frame.levelY[2];
    // Sweep to find where the leftmost corner changes
    let prev = chooseLevelCorner(cameraAt(0), TARGET, frame.half, y, null, 0);
    let flip = -1;
    for (let a = 0; a < 180; a += 0.5) {
      const c = chooseLevelCorner(cameraAt(a), TARGET, frame.half, y, null, 0);
      if (c !== prev) {
        flip = a;
        break;
      }
      prev = c;
    }
    expect(flip).toBeGreaterThan(0);
    const before = chooseLevelCorner(cameraAt(flip - 1), TARGET, frame.half, y, null);
    // Just past the change, the held corner stays; well past, it moves
    expect(chooseLevelCorner(cameraAt(flip + 0.5), TARGET, frame.half, y, before)).toBe(before);
    expect(chooseLevelCorner(cameraAt(flip + 15), TARGET, frame.half, y, before)).not.toBe(before);
  });

  it('measures the azimuth from +z toward +x', () => {
    expect(cameraAzimuth([0, 3, 10], TARGET)).toBeCloseTo(0);
    expect(cameraAzimuth([10, 3, 0], TARGET)).toBeCloseTo(Math.PI / 2);
    expect(cameraRight([0, 3, 10], TARGET)).toEqual([1, 0, 0]);
  });
});

describe('axis labels seen from above', () => {
  const axisLabels = (camera: Vec3, orientation: 'white' | 'black' = 'white') =>
    labelAnchors(layout, orientation, camera, TARGET, null).labels.filter(
      (l) => l.level === undefined,
    );
  /** Screen position (tangents of the view angles) of `p`, as the camera sees it. */
  const screen = (camera: Vec3, p: Vec3): [number, number] => {
    const f = [TARGET[0] - camera[0], TARGET[1] - camera[1], TARGET[2] - camera[2]];
    const fl = Math.hypot(f[0], f[1], f[2]);
    const fw = [f[0] / fl, f[1] / fl, f[2] / fl];
    const r = cameraRight(camera, TARGET);
    const up = [
      r[1] * fw[2] - r[2] * fw[1],
      r[2] * fw[0] - r[0] * fw[2],
      r[0] * fw[1] - r[1] * fw[0],
    ];
    const v = [p[0] - camera[0], p[1] - camera[1], p[2] - camera[2]];
    const depth = v[0] * fw[0] + v[1] * fw[1] + v[2] * fw[2];
    return [
      (v[0] * r[0] + v[1] * r[1] + v[2] * r[2]) / depth,
      (v[0] * up[0] + v[1] * up[1] + v[2] * up[2]) / depth,
    ];
  };

  it('keeps them on the bottom platform from low, and puts them on the top one from overhead', () => {
    for (const orientation of ['white', 'black'] as const) {
      for (const azimuth of [0, 16, 135, 200]) {
        for (const elevation of [8, 18, 30]) {
          for (const l of axisLabels(cameraAt(azimuth, elevation), orientation)) {
            expect(l.position[1]).toBeCloseTo(frame.levelY[0]);
          }
        }
        for (const l of axisLabels(cameraAt(azimuth, 89.9), orientation)) {
          expect(l.position[1]).toBeCloseTo(frame.levelY[4]);
        }
      }
    }
  });

  it('keeps every file and rank label off every platform on screen, from 45° to overhead', () => {
    // Inside the convex quad `q` (screen points, in order round it)
    const inside = (p: [number, number], q: [number, number][]) => {
      let sign = 0;
      for (let i = 0; i < q.length; i++) {
        const [ax, ay] = q[i];
        const [bx, by] = q[(i + 1) % q.length];
        const c = Math.sign((bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax));
        if (c !== 0 && sign !== 0 && c !== sign) return false;
        if (c !== 0) sign = c;
      }
      return true;
    };
    const bad: string[] = [];
    for (const azimuth of [0, 16, 60, 135, 250]) {
      for (const elevation of [45, 50, 55, 60, 65, 70, 75, 80, 85, 89.9]) {
        const camera = cameraAt(azimuth, elevation);
        const plates = frame.levelY.map((y) =>
          CORNERS.map(([sx, sz]) => screen(camera, [sx * frame.half, y, sz * frame.half])),
        );
        for (const label of axisLabels(camera)) {
          const p = screen(camera, label.position);
          plates.forEach((q, z) => {
            if (inside(p, q)) bad.push(`${label.id} on ${z} from ${azimuth}°/${elevation}°`);
          });
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('changes platform once each way through an orbit, and later going up than coming down', () => {
    for (const azimuth of [16, 60, 135]) {
      const sweep = (elevations: number[]) => {
        let state: AnchorState | null = null;
        const changes: number[] = [];
        for (const e of elevations) {
          const next: AnchorState = labelAnchors(
            layout,
            'white',
            cameraAt(azimuth, e),
            TARGET,
            state,
          ).state;
          if (state && next.axisLevels!.files !== state.axisLevels!.files) changes.push(e);
          state = next;
        }
        return changes;
      };
      const up = Array.from({ length: 140 }, (_, i) => 20 + i * 0.5);
      const climbing = sweep(up);
      const descending = sweep([...up].reverse());
      expect(climbing).toHaveLength(1);
      expect(descending).toHaveLength(1);
      expect(climbing[0]).toBeGreaterThan(50);
      expect(climbing[0]).toBeGreaterThan(descending[0]);
    }
  });

  it('crossfades a label when it moves to the other platform', () => {
    const low = labelAnchors(layout, 'white', cameraAt(16, 18), TARGET, null);
    const high = labelAnchors(layout, 'white', cameraAt(16, 89.9), TARGET, low.state);
    expect(high.state.axisLevels).toEqual({ files: 4, ranks: 4 });
    const a = low.labels.find((l) => l.id === 'file-a-0')!;
    const b = high.labels.find((l) => l.id === 'file-a-0')!;
    expect(a.key).not.toBe(b.key);
  });
});
