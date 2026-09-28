import { FILES, LEVELS, RANKS } from '../../../engine/coords';
import type { Orientation } from '../../layout';
import { towerFrame } from './layouts';
import type { BoardLayout, Vec3 } from '../types';

// Where a tower's coordinate labels go, as a pure function of the camera:
// files and ranks along the two edges of a platform nearest the camera, just
// outside it (the bottom platform, or the top one from high above), and each
// level letter beside its platform's screen-left corner, outside the tower's
// silhouette. Choices only change past a hysteresis band,
// so an orbit that wavers around a boundary never makes the labels flicker.
// A camera below LOW_ELEVATION (a design whose orbit goes that low) may see
// the platform carrying the files and ranks edge-on, or from below: they
// fade out near its plane, and take its far edges once under it (axisView).

/** Which platform edges carry the axis labels: the sign of the edge's z (files) and x (ranks). */
export interface EdgeChoice {
  files: 1 | -1;
  ranks: 1 | -1;
}

/** Platform corners by index, as (x sign, z sign). */
export const CORNERS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

/** The camera's azimuth about the vertical through `target`: 0 on +z, PI/2 on +x. */
export const cameraAzimuth = (camera: Vec3, target: Vec3): number =>
  Math.atan2(camera[0] - target[0], camera[2] - target[2]);

/**
 * The edges nearest the camera: files run along the z-edge on the camera's
 * side, ranks along the x-edge on its side. An edge is only given up once the
 * camera is `hysteresis` radians past the point where the two tie.
 */
export const chooseEdges = (
  azimuth: number,
  prev: EdgeChoice | null,
  hysteresis = (10 * Math.PI) / 180,
): EdgeChoice => {
  const band = Math.sin(hysteresis);
  const pick = (value: number, was: 1 | -1 | undefined): 1 | -1 => {
    if (was === undefined) return value >= 0 ? 1 : -1;
    return value * was < -band ? (-was as 1 | -1) : was;
  };
  return {
    files: pick(Math.cos(azimuth), prev?.files),
    ranks: pick(Math.sin(azimuth), prev?.ranks),
  };
};

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** The camera's horizontal right-hand direction, looking from `camera` at `target`. */
export const cameraRight = (camera: Vec3, target: Vec3): Vec3 => {
  const f = sub(target, camera);
  // forward × up, with up = +y
  return norm([-f[2], 0, f[0]]);
};

/**
 * The corner of a platform (half side `half`, height `y`) furthest left on
 * screen, as seen from `camera` looking at `target`, perspective included.
 * The previous corner is kept unless another is further left by more than
 * `hysteresis` (in units of the tangent of the view angle, ~0.03 ≈ 1.7°).
 */
export const chooseLevelCorner = (
  camera: Vec3,
  target: Vec3,
  half: number,
  y: number,
  prev: number | null,
  hysteresis = 0.03,
): number => {
  const forward = norm(sub(target, camera));
  const right = cameraRight(camera, target);
  const screenX = CORNERS.map(([sx, sz]) => {
    const v = sub([sx * half, y, sz * half], camera);
    const depth = Math.max(dot(v, forward), 1e-3);
    return dot(v, right) / depth;
  });
  let best = 0;
  for (let i = 1; i < 4; i++) if (screenX[i] < screenX[best]) best = i;
  if (prev !== null && screenX[prev] <= screenX[best] + hysteresis) return prev;
  return best;
};

/**
 * How far `p` lies inside the convex quad `q` (screen points, in order round
 * it): the distance to its nearest side, negative outside.
 */
const depthInside = (p: [number, number], q: [number, number][]): number => {
  let area = 0;
  for (let i = 0; i < q.length; i++) {
    const [ax, ay] = q[i];
    const [bx, by] = q[(i + 1) % q.length];
    area += ax * by - bx * ay;
  }
  const turn = area >= 0 ? 1 : -1;
  let depth = Infinity;
  for (let i = 0; i < q.length; i++) {
    const [ax, ay] = q[i];
    const [bx, by] = q[(i + 1) % q.length];
    const l = Math.hypot(bx - ax, by - ay) || 1;
    depth = Math.min(depth, (turn * ((bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax))) / l);
  }
  return depth;
};

/**
 * Which platform carries a row of axis labels (the files, or the ranks). The
 * bottom one (A) is their home, below everything from the usual low camera;
 * but from high above, perspective makes the nearer platforms wider on
 * screen, so the bottom one's labels would land on top of them. Then they
 * move to the top platform (E), whose edges are outermost from up there.
 * `placements(z)` gives where the labels would sit on level `z`. A move
 * needs the other platform clearly better (by `margin`, in units of the
 * tangent of the view angle), so the labels never flicker between the two;
 * below `minElevation` (radians) they stay home whatever happens, as they
 * always have.
 */
export const chooseAxisLevel = (
  camera: Vec3,
  target: Vec3,
  half: number,
  levelY: number[],
  placements: (z: number) => Vec3[],
  prev: number | null,
  margin = 0.01,
  minElevation = (40 * Math.PI) / 180,
): number => {
  const forward = norm(sub(target, camera));
  if (-forward[1] < Math.sin(minElevation)) return 0;
  const right = cameraRight(camera, target);
  const up: Vec3 = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  const screen = (p: Vec3): [number, number] => {
    const v = sub(p, camera);
    const depth = Math.max(dot(v, forward), 1e-3);
    return [dot(v, right) / depth, dot(v, up) / depth];
  };
  const plates = levelY.map((y) => CORNERS.map(([sx, sz]) => screen([sx * half, y, sz * half])));
  // How far the deepest label on level z lies inside any platform (negative:
  // every label is clear of every platform by at least that much)
  const worst = (z: number) => {
    let w = -Infinity;
    for (const p of placements(z)) {
      const s = screen(p);
      for (const q of plates) w = Math.max(w, depthInside(s, q));
    }
    return w;
  };
  const top = levelY.length - 1;
  const bottom = worst(0);
  if (prev === top) {
    // Back home as soon as the bottom platform's labels are clearly clear
    return bottom < -margin || worst(top) > margin ? 0 : top;
  }
  if (prev === 0) return bottom > margin && worst(top) < -margin ? top : 0;
  return bottom <= 0 || worst(top) > 0 ? 0 : top;
};

const DEG = Math.PI / 180;

/**
 * Camera elevation (about the orbit target) under which the file and rank
 * labels watch for their platform seen edge-on or from below. The kit's
 * towers stop the camera at 6°, and above it the labels are exactly as they
 * always were; the rules below take over across the 2° beneath it.
 */
export const LOW_ELEVATION = 6 * DEG;

export interface AxisView {
  /** How much the platform's files and ranks show, 0–1. */
  opacity: number;
  /** The camera is under the platform: the labels take its far edges. */
  below: boolean;
}

/**
 * How the file and rank labels of the platform at height `y` read from
 * `camera`. The camera's grazing angle over the platform (its height above
 * the plane, seen from the tower's axis) decides: near the plane the
 * platform is seen edge-on, the ranks (a pitch apart in depth) crowd into
 * one blot and the files sit among its pieces, so they fade out between
 * `fadeFrom` and `fadeTo`; under the plane, its far edges are the lowest part of it on
 * screen, clear of every piece and platform, so the labels move there (the
 * mirror of the near edges from above). Only below LOW_ELEVATION.
 */
export const axisView = (
  camera: Vec3,
  target: Vec3,
  y: number,
  fadeFrom = 15 * DEG,
  fadeTo = 6 * DEG,
): AxisView => {
  const v = sub(camera, target);
  const elevation = Math.asin(v[1] / (Math.hypot(v[0], v[1], v[2]) || 1));
  // 0 at LOW_ELEVATION and above (as always), 1 from 2° under it
  const low = Math.min(Math.max((LOW_ELEVATION - elevation) / (2 * DEG), 0), 1);
  // (a hair's tolerance, so a camera held at exactly 6° is above it)
  if (low < 1e-6) return { opacity: 1, below: false };
  const grazing = Math.atan2(camera[1] - y, Math.hypot(v[0], v[2]));
  const k = Math.min(Math.max((Math.abs(grazing) - fadeTo) / (fadeFrom - fadeTo), 0), 1);
  const shown = k * k * (3 - 2 * k);
  return { opacity: 1 - low * (1 - shown), below: grazing < 0 };
};

export interface LabelAnchor {
  /** Stable identity of the label (one sprite pair per id). */
  id: string;
  text: string;
  /** Changes when the label moves to a different edge or corner (a crossfade). */
  key: string;
  position: Vec3;
  /** A level letter (A–E), index into the levels. */
  level?: number;
  /**
   * A file or rank label's visibility, 0–1, where its platform is seen
   * edge-on (axisView); unset: fully shown.
   */
  opacity?: number;
}

export interface AnchorState {
  edges: EdgeChoice;
  corners: number[];
  /** The platforms carrying the file and the rank labels (see chooseAxisLevel). */
  axisLevels?: { files: number; ranks: number };
}

export interface AnchorOptions {
  /** Distance of the file and rank labels outside the platform's edge. */
  offset?: number;
  /** Distance of the level letters outside their platform's corner. */
  levelOffset?: number;
  /** Axis labels on every platform, not only the bottom one. */
  everyLevel?: boolean;
  /** Radians past the tie before the axis labels change edge. */
  edgeHysteresis?: number;
  /** See chooseLevelCorner. */
  cornerHysteresis?: number;
  /** Height of the level letters above their platform. */
  levelLift?: number;
}

/**
 * Every label's anchor for a camera at `camera` looking at `target`, given
 * the previous choice (null on the first frame). Returns the new choice to
 * pass back next time.
 */
export const labelAnchors = (
  layout: BoardLayout,
  orientation: Orientation,
  camera: Vec3,
  target: Vec3,
  prev: AnchorState | null,
  o: AnchorOptions = {},
): { state: AnchorState; labels: LabelAnchor[] } => {
  const frame = towerFrame(layout);
  const offset = o.offset ?? 0.42;
  const levelOffset = o.levelOffset ?? 0.55;
  const edges = chooseEdges(cameraAzimuth(camera, target), prev?.edges ?? null, o.edgeHysteresis);
  const corners = frame.levelY.map((y, z) =>
    chooseLevelCorner(camera, target, frame.half, y, prev?.corners[z] ?? null, o.cornerHysteresis),
  );
  const fileZ = edges.files * (frame.half + offset);
  const rankX = edges.ranks * (frame.half + offset);
  const fileX = FILES.map((_, x) => layout.toWorld({ x, y: 0, z: 0 }, orientation)[0]);
  const rankZ = RANKS.map((_, r) => layout.toWorld({ x: 0, y: r, z: 0 }, orientation)[2]);
  // The files and the ranks each take the platform that keeps them clear of
  // the tower on screen (usually the bottom one)
  const fileAt = (z: number): Vec3[] => fileX.map((px) => [px, frame.levelY[z], fileZ]);
  const rankAt = (z: number): Vec3[] => rankZ.map((pz) => [rankX, frame.levelY[z], pz]);
  const pick = (at: (z: number) => Vec3[], was: number | undefined) =>
    o.everyLevel ? 0 : chooseAxisLevel(camera, target, frame.half, frame.levelY, at, was ?? null);
  const axisLevels = {
    files: pick(fileAt, prev?.axisLevels?.files),
    ranks: pick(rankAt, prev?.axisLevels?.ranks),
  };
  const labels: LabelAnchor[] = [];
  // One set of axis labels (ids from level A, whichever platform carries
  // them), or one per platform
  const levels = o.everyLevel ? [0, 1, 2, 3, 4] : [0];
  for (const z of levels) {
    const files = o.everyLevel ? z : axisLevels.files;
    const ranks = o.everyLevel ? z : axisLevels.ranks;
    // Seen from low down: faded near the platform's plane, on its far edges under it
    const fileView = axisView(camera, target, frame.levelY[files]);
    const rankView = axisView(camera, target, frame.levelY[ranks]);
    const fileEdge = fileView.below ? -edges.files : edges.files;
    const rankEdge = rankView.below ? -edges.ranks : edges.ranks;
    const shown = (view: AxisView) => (view.opacity < 1 ? { opacity: view.opacity } : {});
    FILES.forEach((text, x) =>
      labels.push({
        id: `file-${text}-${z}`,
        text,
        key: `z${fileEdge}l${files}`,
        position: [fileX[x], frame.levelY[files], fileEdge * (frame.half + offset)],
        ...shown(fileView),
      }),
    );
    RANKS.forEach((text, r) =>
      labels.push({
        id: `rank-${text}-${z}`,
        text,
        key: `x${rankEdge}l${ranks}`,
        position: [rankEdge * (frame.half + offset), frame.levelY[ranks], rankZ[r]],
        ...shown(rankView),
      }),
    );
  }
  const left = cameraRight(camera, target).map((v) => -v) as Vec3;
  frame.levelY.forEach((y, z) => {
    const [sx, sz] = CORNERS[corners[z]];
    labels.push({
      id: `level-${LEVELS[z]}`,
      text: LEVELS[z],
      key: `c${corners[z]}`,
      position: [
        sx * frame.half + left[0] * levelOffset,
        y + (o.levelLift ?? 0.12),
        sz * frame.half + left[2] * levelOffset,
      ],
      level: z,
    });
  });
  return { state: { edges, corners, axisLevels }, labels };
};
