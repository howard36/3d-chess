import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { ringBounds } from '../cameraFit';
import { FILES, LEVELS, RANKS } from '../../engine/coords';
import { towerLayout, towerFrame } from '../layout';
import {
  axisView,
  cameraAzimuth,
  cameraRight,
  chooseEdges,
  CORNERS,
  EDGE_HYSTERESIS,
  labelAnchors,
  LETTER_OFFSET,
  letterCorner,
  LOW_ELEVATION,
  towerFrameRings,
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

      it.each(AZIMUTHS)(
        'stands every level letter at the far corner, outside it, at its own level, from %i°',
        (azimuth) => {
          for (const elevation of [-10, 8, 22, 45, 70, 89.9]) {
            const camera = cameraAt(azimuth, elevation);
            const { labels, state } = labelAnchors(layout, orientation, camera, TARGET, null);
            const [sx, sz] = CORNERS[state.corner];
            // The corner across from the one where the files and ranks meet
            expect([sx, sz]).toEqual([-state.edges.ranks, -state.edges.files]);
            // ...which is the corner furthest from the camera
            const far = (c: number) =>
              Math.hypot(
                CORNERS[c][0] * frame.half - camera[0],
                CORNERS[c][1] * frame.half - camera[2],
              );
            expect(far(state.corner)).toBeCloseTo(Math.max(...CORNERS.map((_, c) => far(c))), 6);
            const out = frame.half + LETTER_OFFSET / Math.SQRT2;
            for (const label of labels.filter((l) => l.level !== undefined)) {
              const y = frame.levelY[label.level!];
              expect(label.text).toBe(LEVELS[label.level!]);
              expect(label.position[0]).toBeCloseTo(sx * out);
              expect(label.position[2]).toBeCloseTo(sz * out);
              // Beside its own platform, not another one
              expect(label.position[1]).toBeGreaterThan(y);
              expect(label.position[1]).toBeLessThan(y + frame.gap / 4);
              expect(label.key).toBe(`c${state.corner}`);
            }
          }
        },
      );

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

  it('opens with the level letters at the far-left corner and the ranks on the right', () => {
    const { state } = labelAnchors(layout, 'white', cameraAt(16), TARGET, null);
    expect(CORNERS[state.corner]).toEqual([-1, -1]);
    expect(state.edges).toEqual({ files: 1, ranks: 1 });
  });

  it('labels every platform on request', () => {
    const { labels } = labelAnchors(layout, 'white', cameraAt(30), TARGET, null, {
      everyLevel: true,
    });
    expect(labels).toHaveLength(5 * 10 + 5);
    expect(new Set(labels.map((l) => l.id)).size).toBe(labels.length);
  });

  it('carries the level letters round all four corners in a full orbit, all together', () => {
    let state: AnchorState | null = null;
    const keys = new Set<string>();
    for (let a = 0; a <= 360; a += 5) {
      const next = labelAnchors(layout, 'white', cameraAt(a), TARGET, state);
      state = next.state;
      const letters = next.labels.filter((l) => l.level !== undefined);
      expect(new Set(letters.map((l) => l.key)).size).toBe(1);
      keys.add(letters[0].key);
    }
    expect(keys.size).toBe(4);
  });
});

describe('hysteresis', () => {
  it('holds an edge while the camera wavers around the tie, and gives it up past the band', () => {
    const band = EDGE_HYSTERESIS / DEG;
    let edges = chooseEdges(80 * DEG, null);
    expect(edges.files).toBe(1);
    // Around 90° the two z-edges tie; within the band nothing changes
    for (const a of [88, 92, 90 + band - 1, 91, 90 + band - 0.5, 89]) {
      edges = chooseEdges(a * DEG, edges);
      expect(edges.files).toBe(1);
    }
    edges = chooseEdges((90 + band + 1) * DEG, edges);
    expect(edges.files).toBe(-1);
    // And coming back, it holds the new edge until past the band on the other side
    edges = chooseEdges((90 - band + 1) * DEG, edges);
    expect(edges.files).toBe(-1);
    edges = chooseEdges((90 - band - 1) * DEG, edges);
    expect(edges.files).toBe(1);
    // ...and the letters' corner follows the edges
    expect(letterCorner({ files: 1, ranks: 1 })).toBe(0);
    expect(letterCorner({ files: -1, ranks: 1 })).toBe(3);
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

  for (const azimuth of [0, 16, 45, 100, 196, 290]) {
    it(`stands them in a short line along the corner's diagonal, each beside its own ring, from ${azimuth}°`, () => {
      const camera = cameraAt(azimuth, 89.9, 25);
      const { labels, state } = labelAnchors(layout, 'white', camera, TARGET, null);
      const row = labels
        .filter((l) => l.level !== undefined)
        .map((l) => screen(camera, l.position));
      // The corner's diagonal on screen: from the tower's axis out to the corner
      const [cx, cz] = CORNERS[state.corner];
      const centre = screen(camera, [0, 0, 0]);
      const post = screen(camera, [cx * frame.half, 0, cz * frame.half]);
      const out = [post[0] - centre[0], post[1] - centre[1]];
      const outLength = Math.hypot(out[0], out[1]);
      row.forEach((p, z) => {
        // On the diagonal (a sliver of a letter off it at most)...
        const across = (out[0] * (p[1] - centre[1]) - out[1] * (p[0] - centre[0])) / outLength;
        expect(Math.abs(across)).toBeLessThan(0.002);
        // ...just outside its own ring's corner, and inside the next ring's
        const corner = (level: number) => {
          const c = screen(camera, [cx * frame.half, frame.levelY[level], cz * frame.half]);
          return Math.hypot(c[0] - centre[0], c[1] - centre[1]);
        };
        const reach = Math.hypot(p[0] - centre[0], p[1] - centre[1]);
        expect(reach).toBeGreaterThan(corner(z));
        if (z < 4) expect(reach).toBeLessThan(corner(z + 1) + 0.02);
        // A to E outward, as the rings nest (E, the nearest, outermost)
        if (z > 0) {
          const inner = Math.hypot(row[z - 1][0] - centre[0], row[z - 1][1] - centre[1]);
          expect(reach).toBeGreaterThan(inner);
        }
      });
      // Never along the files' or the ranks' line: the diagonal is 45° off both
      const files = labels
        .filter((l) => l.id.startsWith('file-'))
        .map((l) => screen(camera, l.position));
      const f = [files[4][0] - files[0][0], files[4][1] - files[0][1]];
      const cos = Math.abs(f[0] * out[0] + f[1] * out[1]) / (Math.hypot(f[0], f[1]) * outLength);
      expect(Math.acos(cos) / DEG).toBeCloseTo(45, 0);
    });
  }
});

describe('towerFrameRings', () => {
  const rings = towerFrameRings(layout, { size: 0.32, levelScale: 1 });

  it('hold the platforms and every label, wherever the hysteresis has left it', () => {
    const glyph = 0.3 * 0.32;
    for (const azimuth of [...AZIMUTHS, 45, 90, 135, 3, 93, -93]) {
      for (const elevation of [-14, 0, 3, 18, 45, 62, 70, 85, 89.9]) {
        const eye = cameraAt(azimuth, elevation, 20);
        const camera = new PerspectiveCamera(36, 1, 0.1, 100);
        camera.position.set(...eye);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
        const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
        // The labels as drawn after turning or climbing here from either side
        const drawn: Vector3[] = [];
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
          for (const l of labelAnchors(layout, 'white', eye, TARGET, state).labels) {
            const p = new Vector3(...l.position);
            for (const [a, b] of CORNERS) {
              drawn.push(
                p
                  .clone()
                  .addScaledVector(right, a * glyph)
                  .addScaledVector(up, b * glyph),
              );
            }
          }
        }
        const platforms = frame.levelY.flatMap((y) =>
          CORNERS.map(([x, z]) => new Vector3(x * frame.half, y, z * frame.half)),
        );
        const bounds = ringBounds(rings, elevation * DEG, 20);
        for (const p of [...drawn, ...platforms]) {
          const v = p.clone().applyMatrix4(camera.matrixWorldInverse);
          const [x, y] = [v.x / -v.z, v.y / -v.z];
          const where = `azimuth ${azimuth}, elevation ${elevation}`;
          expect(x, where).toBeGreaterThanOrEqual(bounds.left - 1e-9);
          expect(x, where).toBeLessThanOrEqual(bounds.right + 1e-9);
          expect(y, where).toBeGreaterThanOrEqual(bounds.bottom - 1e-9);
          expect(y, where).toBeLessThanOrEqual(bounds.top + 1e-9);
        }
      }
    }
  });

  it('reach the letters only behind the tower, and never past the platforms across', () => {
    const letters = rings.filter((r) => r.behind !== undefined);
    expect(letters).toHaveLength(2);
    for (const r of letters) {
      expect(r.behind).toBeCloseTo(Math.PI / 4 + EDGE_HYSTERESIS);
      expect(r.radius).toBeGreaterThan(Math.SQRT2 * frame.half + LETTER_OFFSET);
    }
    // From the side the widest thing is the platforms' diagonal (with the
    // files and ranks, just inside it), not a letter
    const { right } = ringBounds(rings, 0, 20);
    const edge = Math.max(...rings.filter((r) => r.behind === undefined).map((r) => r.radius));
    expect(right).toBeCloseTo(edge / Math.sqrt(20 * 20 - edge * edge), 9);
    expect(edge).toBeLessThan(Math.SQRT2 * frame.half + 0.2);
  });
});
