import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { centringShift, viewBounds } from '../cameraFit';
import { FILES, LEVELS, RANKS } from '../../engine/coords';
import { towerLayout, towerFrame } from '../layout';
import {
  axisView,
  cameraAzimuth,
  cameraRight,
  chooseEdges,
  chooseLevelCorner,
  chooseLevelEdge,
  CORNERS,
  CROSS_OFF,
  CROSS_ON,
  EDGES,
  labelAnchors,
  towerFramePoints,
  LEVEL_SPREAD_FROM,
  LEVEL_SPREAD_TO,
  levelSpread,
  LOW_ELEVATION,
} from './labelAnchors';
import type { AnchorState } from './labelAnchors';
import type { Vec3 } from '../types';

const layout = towerLayout();
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

describe('axis labels seen from low down (an orbit that dips under 6°)', () => {
  // A tower whose camera may look up from 20° below the horizon
  const low = towerLayout({ minElevation: -20 });
  const levelA = towerFrame(low).levelY[0];
  const DIST = 14;
  const axis = (labels: ReturnType<typeof labelAnchors>['labels']) =>
    labels.filter((l) => l.level === undefined);
  const letters = (labels: ReturnType<typeof labelAnchors>['labels']) =>
    labels.filter((l) => l.level !== undefined);

  it('leaves every label as it was at 6° and above, whatever the platform', () => {
    for (const e of [6, 10, 18, 45, 89.9]) {
      for (const y of [levelA, 0, 3, 40]) {
        expect(axisView(cameraAt(16, e, DIST), TARGET, y)).toEqual({ opacity: 1, below: false });
      }
      const { labels } = labelAnchors(low, 'white', cameraAt(16, e, DIST), TARGET, null);
      expect(labels.every((l) => l.opacity === undefined)).toBe(true);
    }
    expect(LOW_ELEVATION).toBeCloseTo(6 * DEG);
  });

  it('fades the files and ranks out as their platform comes edge-on, keeping the level letters', () => {
    // The camera in the plane of level A
    const onPlane = (Math.asin(levelA / DIST) * 180) / Math.PI;
    for (const orientation of ['white', 'black'] as const) {
      const { labels } = labelAnchors(low, orientation, cameraAt(16, onPlane, DIST), TARGET, null);
      expect(axis(labels)).toHaveLength(10);
      for (const l of axis(labels)) expect(l.opacity).toBeCloseTo(0);
      expect(letters(labels).map((l) => l.text)).toEqual(LEVELS);
      for (const l of letters(labels)) expect(l.opacity).toBeUndefined();
    }
  });

  it('puts them on the far edges once the camera is under the platform, clear of it', () => {
    for (const azimuth of [16, 100, 200, -60]) {
      // Far under it (at -20° they are still part-faded)
      const partly = labelAnchors(low, 'white', cameraAt(azimuth, -20, 20), TARGET, null).labels;
      const cam = cameraAt(azimuth, -40, 20);
      const above = labelAnchors(low, 'white', cameraAt(azimuth, 18, 20), TARGET, null).labels;
      const under = labelAnchors(low, 'white', cam, TARGET, null).labels;
      const fileAbove = above.find((l) => l.id === 'file-c-0')!;
      const fileUnder = under.find((l) => l.id === 'file-c-0')!;
      const rankAbove = above.find((l) => l.id === 'rank-3-0')!;
      const rankUnder = under.find((l) => l.id === 'rank-3-0')!;
      // Well under the plane: fully shown again, on the opposite edges
      expect(fileUnder.opacity).toBeUndefined();
      expect(Math.sign(fileUnder.position[2])).toBe(-Math.sign(fileAbove.position[2]));
      expect(Math.sign(rankUnder.position[0])).toBe(-Math.sign(rankAbove.position[0]));
      expect(fileUnder.key).not.toBe(fileAbove.key);
      const fileLow = partly.find((l) => l.id === 'file-c-0')!;
      expect(fileLow.key).toBe(fileUnder.key);
      expect(fileLow.opacity).toBeGreaterThan(0);
      // ...the far ones from this camera, outside the platform
      const far = (p: Vec3) => Math.hypot(p[0] - cam[0], p[2] - cam[2]);
      expect(far(fileUnder.position)).toBeGreaterThan(far(fileAbove.position));
      expect(Math.abs(fileUnder.position[2])).toBeGreaterThan(frame.half);
    }
  });

  it('changes smoothly on the way down, moving edge only while unseen', () => {
    let prev: ReturnType<typeof labelAnchors> | null = null;
    let moves = 0;
    for (let e = 8; e >= -20; e -= 0.25) {
      const next = labelAnchors(low, 'white', cameraAt(16, e, DIST), TARGET, prev?.state ?? null);
      const file = next.labels.find((l) => l.id === 'file-a-0')!;
      if (prev) {
        const was = prev.labels.find((l) => l.id === 'file-a-0')!;
        expect(Math.abs((file.opacity ?? 1) - (was.opacity ?? 1))).toBeLessThan(0.12);
        if (file.key !== was.key) {
          moves++;
          expect(Math.max(file.opacity ?? 1, was.opacity ?? 1)).toBeLessThan(0.05);
        }
      }
      // The level letters never fade
      for (const l of letters(next.labels)) expect(l.opacity).toBeUndefined();
      prev = next;
    }
    expect(moves).toBe(1);
  });
});

describe('level letters seen from above', () => {
  /** Screen position (tangents of the view angle, y up) of a point. */
  const screen = (camera: Vec3, p: Vec3): [number, number] => {
    const f = [-camera[0], -camera[1], -camera[2]];
    const fl = Math.hypot(f[0], f[1], f[2]);
    const r = cameraRight(camera, TARGET);
    const up = [
      r[1] * f[2] - r[2] * f[1],
      r[2] * f[0] - r[0] * f[2],
      r[0] * f[1] - r[1] * f[0],
    ].map((c) => c / fl);
    const v = [p[0] - camera[0], p[1] - camera[1], p[2] - camera[2]];
    const depth = (v[0] * f[0] + v[1] * f[1] + v[2] * f[2]) / fl;
    return [
      (v[0] * r[0] + v[2] * r[2]) / depth,
      (v[0] * up[0] + v[1] * up[1] + v[2] * up[2]) / depth,
    ];
  };
  const letters = (camera: Vec3, prev: AnchorState | null = null) =>
    labelAnchors(layout, 'white', camera, TARGET, prev).labels.filter((l) => l.level !== undefined);

  it('spreads them only between LEVEL_SPREAD_FROM and LEVEL_SPREAD_TO, eased', () => {
    const at = (elevation: number) => levelSpread(cameraAt(16, elevation), TARGET);
    expect(at(18)).toBe(0);
    expect(at(LEVEL_SPREAD_FROM / DEG - 0.1)).toBe(0);
    expect(at((LEVEL_SPREAD_FROM + LEVEL_SPREAD_TO) / 2 / DEG)).toBeCloseTo(0.5);
    expect(at(LEVEL_SPREAD_TO / DEG + 0.1)).toBe(1);
    expect(at(89.9)).toBe(1);
  });

  it('leaves them at their corners below the spread, as in every other view', () => {
    for (const azimuth of AZIMUTHS) {
      for (const elevation of [8, 22, 45, 57]) {
        for (const label of letters(cameraAt(azimuth, elevation))) {
          expect(label.key).toMatch(/^c\d$/);
        }
      }
    }
  });

  for (const azimuth of [16, 100, 196, 290]) {
    it(`lines them up a pitch apart along the tower's screen-left edge, A to E up the screen, from ${azimuth}°`, () => {
      for (const elevation of [LEVEL_SPREAD_TO / DEG, 80, 89.9]) {
        const camera = cameraAt(azimuth, elevation, 25);
        const row = letters(camera);
        expect(row.map((l) => l.key)).toEqual(Array(5).fill(row[0].key));
        const points = row.map((l) => screen(camera, l.position));
        for (let z = 1; z < 5; z++) {
          // Up the screen from A to E, and well apart: a letter is 0.32 to
          // 0.47 across, about 0.02 of a tangent at this distance
          const [ax, ay] = points[z - 1];
          const [bx, by] = points[z];
          expect(by).toBeGreaterThan(ay);
          expect(Math.hypot(bx - ax, by - ay)).toBeGreaterThan(0.035);
        }
        // Every letter left of the middle of the tower, outside the top platform
        for (const [i, { position }] of row.entries()) {
          expect(points[i][0]).toBeLessThan(0);
          expect(Math.max(Math.abs(position[0]), Math.abs(position[2]))).toBeGreaterThan(
            frame.half + 0.2,
          );
        }
      }
    });
  }

  it('moves them there smoothly as the camera rises, never by a jump', () => {
    for (const azimuth of [16, 196, 60]) {
      let state: AnchorState | null = null;
      let last: { key: string; position: Vec3 }[] | null = null;
      for (let elevation = 40; elevation <= 89.9; elevation += 0.25) {
        const result = labelAnchors(
          layout,
          'white',
          cameraAt(azimuth, elevation, 25),
          TARGET,
          state,
        );
        state = result.state;
        const now = result.labels.filter((l) => l.level !== undefined);
        now.forEach(({ key, position: p }, i) => {
          if (!last) return;
          const q = last[i].position;
          const moved = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
          // A quarter of a degree moves a letter a little way...
          expect(moved).toBeLessThan(0.2);
          // ...and a new key (corner to row) finds it where it stood, so
          // SmartLabels slides it on rather than crossfading
          if (key !== last[i].key) expect(moved).toBeLessThan(0.3);
        });
        last = now;
      }
    }
  });

  it('keeps an edge while the camera wavers around the tie', () => {
    // At 45° round, the -x and +z edges face left equally
    const tie = cameraAt(45, 85);
    const a = chooseLevelEdge(cameraAt(35, 85), TARGET, null);
    expect(EDGES[a]).toEqual([-1, 0]);
    expect(chooseLevelEdge(tie, TARGET, a)).toBe(a);
    expect(chooseLevelEdge(cameraAt(52, 85), TARGET, a)).toBe(a);
    expect(EDGES[chooseLevelEdge(cameraAt(60, 85), TARGET, a)]).toEqual([0, 1]);
  });

  /** Where every label stands after the camera has come along `path` ([azimuth, elevation] steps). */
  const after = (path: [number, number][], orientation: 'white' | 'black' = 'white') => {
    let state: AnchorState | null = null;
    let labels: ReturnType<typeof labelAnchors>['labels'] = [];
    for (const [a, e] of path) {
      ({ state, labels } = labelAnchors(layout, orientation, cameraAt(a, e), TARGET, state));
    }
    return { state: state!, labels };
  };
  /** An orbit from `from` to `to`, a degree of azimuth or elevation at a time. */
  const orbit = (from: [number, number], to: [number, number]): [number, number][] => {
    const n = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]), 1);
    return Array.from({ length: n + 1 }, (_, i): [number, number] => [
      from[0] + ((to[0] - from[0]) * i) / n,
      from[1] + ((to[1] - from[1]) * i) / n,
    ]);
  };

  it('keeps every file and rank off the letters’ row from high above, whichever way the camera came', () => {
    const bad: string[] = [];
    for (const orientation of ['white', 'black'] as const) {
      for (let azimuth = 0; azimuth < 360; azimuth += 10) {
        for (const elevation of [LEVEL_SPREAD_TO / DEG, 80, 89.9]) {
          const camera = cameraAt(azimuth, elevation);
          for (const [label, path] of [
            ['fresh', [[azimuth, elevation]]],
            ['climbing', orbit([azimuth, 30], [azimuth, elevation])],
            [
              'from the left',
              orbit([azimuth - 40, 50], [azimuth - 40, elevation]).concat(
                orbit([azimuth - 40, elevation], [azimuth, elevation]),
              ),
            ],
            [
              'from the right',
              orbit([azimuth + 40, 50], [azimuth + 40, elevation]).concat(
                orbit([azimuth + 40, elevation], [azimuth, elevation]),
              ),
            ],
          ] as [string, [number, number][]][]) {
            const { labels } = after(path, orientation);
            const row = labels.filter((l) => l.level !== undefined);
            for (const l of labels.filter((l) => l.level === undefined)) {
              const p = screen(camera, l.position);
              for (const letter of row) {
                const q = screen(camera, letter.position);
                // A pitch between neighbours is about 0.1 here; a letter is
                // about a third of that across
                if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.05) {
                  bad.push(
                    `${l.id} on ${letter.text} from ${azimuth}°/${elevation}° ${label} (${orientation})`,
                  );
                }
              }
            }
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('draws one layout at a square top-down view, whichever side the camera came from', () => {
    // The ranks' edge ties exactly here (sin 0°): the camera from the left
    // holds them on -x, the letters' edge; from the right, on +x
    const top: [number, number] = [0, 89.9];
    const views = [
      after([[-40, 50], top]),
      after([[40, 50], top]),
      after(orbit([-40, 50], [-40, 89.9]).concat(orbit([-40, 89.9], top))),
      after(orbit([40, 50], [40, 89.9]).concat(orbit([40, 89.9], top))),
      after([top]),
    ];
    const [first] = views;
    expect(first.state.axisLevels).toEqual({ files: 4, ranks: 4 });
    expect(EDGES[first.state.levelEdge!]).toEqual([-1, 0]);
    const row = first.labels.filter((l) => l.level !== undefined);
    expect(new Set(row.map((l) => l.key)).size).toBe(1);
    for (const l of first.labels.filter((l) => l.id.startsWith('rank'))) {
      expect(l.position[0]).toBeGreaterThan(frame.half);
    }
    for (const { labels } of views) {
      labels.forEach((l, i) => {
        expect(l.id).toBe(first.labels[i].id);
        l.position.forEach((c, k) => expect(c).toBeCloseTo(first.labels[i].position[k], 9));
      });
    }
  });

  it('crosses the files or ranks back only well under where they crossed', () => {
    // From 60° round the letters take +z, the files' edge, from above
    const climbing = orbit([60, 50], [60, 89.9]).map(([a, e]) => [a, e] as [number, number]);
    let state: AnchorState | null = null;
    const changes: number[] = [];
    for (const path of [climbing, [...climbing].reverse()]) {
      for (const [a, e] of path) {
        const next: AnchorState = labelAnchors(
          layout,
          'white',
          cameraAt(a, e),
          TARGET,
          state,
        ).state;
        if (state && !!next.crossed !== !!state.crossed) changes.push(e);
        state = next;
      }
    }
    expect(changes).toHaveLength(2);
    expect(levelSpread(cameraAt(60, changes[0]), TARGET)).toBeGreaterThanOrEqual(CROSS_ON);
    expect(levelSpread(cameraAt(60, changes[1]), TARGET)).toBeLessThan(CROSS_OFF);
  });
});

describe('towerFramePoints', () => {
  const frameOf = towerFramePoints(layout, { size: 0.32, levelScale: 1 });
  /** A camera at `eye` looking at the centre, and the frame's bounds in its view. */
  const view = (eye: Vec3) => {
    const camera = new PerspectiveCamera(36, 1, 0.1, 100);
    camera.position.set(...eye);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const bounds = viewBounds(
      frameOf(eye).map((p) => new Vector3(...p)),
      camera,
    );
    return { camera, bounds };
  };

  it('holds the platforms and every label, wherever the hysteresis has left it', () => {
    for (const azimuth of [...AZIMUTHS, 45, 90, 135]) {
      for (const elevation of [-14, 3, 18, 45, 62, 70, 85]) {
        const eye = cameraAt(azimuth, elevation, 20);
        const { camera, bounds } = view(eye);
        // The labels as drawn after approaching from either side, and from below or above
        const drawn: Vec3[] = [];
        for (const [da, de] of [
          [-20, 0],
          [20, 0],
          [0, -20],
          [0, 20],
          [0, 0],
        ]) {
          let state: AnchorState | null = null;
          for (let k = 1; k >= 0; k -= 0.125) {
            const at = cameraAt(azimuth + da * k, Math.min(elevation + de * k, 89.9), 20);
            ({ state } = labelAnchors(layout, 'white', at, TARGET, state));
          }
          drawn.push(
            ...labelAnchors(layout, 'white', eye, TARGET, state).labels.map((l) => l.position),
          );
        }
        const platforms = frame.levelY.flatMap((y) =>
          CORNERS.map(([x, z]): Vec3 => [x * frame.half, y, z * frame.half]),
        );
        const inside = viewBounds(
          [...drawn, ...platforms].map((p) => new Vector3(...p)),
          camera,
        );
        const where = `azimuth ${azimuth}, elevation ${elevation}`;
        expect(inside.left, where).toBeGreaterThanOrEqual(bounds.left - 1e-9);
        expect(inside.right, where).toBeLessThanOrEqual(bounds.right + 1e-9);
        expect(inside.bottom, where).toBeGreaterThanOrEqual(bounds.bottom - 1e-9);
        expect(inside.top, where).toBeLessThanOrEqual(bounds.top + 1e-9);
      }
    }
  });

  it('frames a glyph round each label, the level letters larger by their scale', () => {
    const eye = cameraAt(16, 18, 20);
    const small = towerFramePoints(layout, { size: 0.3, levelScale: 1 })(eye);
    const large = towerFramePoints(layout, { size: 0.3, levelScale: 2 })(eye);
    const across = (pts: Vec3[], i: number) =>
      Math.hypot(pts[i][0] - pts[i + 2][0], pts[i][1] - pts[i + 2][1], pts[i][2] - pts[i + 2][2]);
    // The platforms and top pieces (24), then the files and ranks, then the letters (last)
    expect(across(small, 24)).toBeCloseTo(0.4 * 0.3 * 2 * Math.SQRT2);
    expect(across(large, 24)).toBeCloseTo(across(small, 24));
    const letter = small.length - 4;
    expect(across(large, letter)).toBeCloseTo(2 * across(small, letter));
  });

  it('keeps the centred view steady through an orbit: no jump as labels change place', () => {
    const shiftAt = (azimuth: number, elevation: number) => {
      const eye = cameraAt(azimuth, elevation, 22);
      const camera = new PerspectiveCamera(36, 390 / 844, 0.1, 100);
      camera.position.set(...eye);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      const points = frameOf(eye).map((p) => new Vector3(...p));
      return centringShift(viewBounds(points, camera), { width: 390, height: 844, fov: 36 });
    };
    // Fine steps, so a slide shows as a small step and only a jump as a big one
    let worst = 0;
    for (const azimuth of [16, 196, 60, 130]) {
      let last = shiftAt(azimuth, -14);
      for (let elevation = -13.9; elevation <= 89.9; elevation += 0.1) {
        const now = shiftAt(azimuth, elevation);
        worst = Math.max(worst, Math.hypot(now[0] - last[0], now[1] - last[1]));
        last = now;
      }
    }
    for (const elevation of [10, 45, 80]) {
      let last = shiftAt(0, elevation);
      for (let azimuth = 0.1; azimuth <= 360; azimuth += 0.1) {
        const now = shiftAt(azimuth, elevation);
        worst = Math.max(worst, Math.hypot(now[0] - last[0], now[1] - last[1]));
        last = now;
      }
    }
    // A tenth of a degree moves the view's centre by under 2 px on an 844 px
    // phone (a row of labels jumping to another platform or edge would move
    // it ten times as far)
    expect(worst * (844 / (2 * Math.tan((18 * Math.PI) / 180)))).toBeLessThan(2);
  });
});
