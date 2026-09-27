import { FILES, LEVELS, RANKS } from '../../../engine/coords';
import { GRID_SIZE } from '../../layout';
import type { Orientation } from '../../layout';
import { towerFrame } from './layouts';
import type { BoardLayout, Vec3 } from '../types';

// Where a tower's coordinate labels go, as a pure function of the camera:
// files and ranks along the two edges of a platform nearest the camera, just
// outside it, and each level letter beside its platform's screen-left corner,
// outside the tower's silhouette. Choices only change past a hysteresis band,
// so an orbit that wavers around a boundary never makes the labels flicker.

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

export interface LabelAnchor {
  /** Stable identity of the label (one sprite pair per id). */
  id: string;
  text: string;
  /** Changes when the label moves to a different edge or corner (a crossfade). */
  key: string;
  position: Vec3;
  /** A level letter (A–E), index into the levels. */
  level?: number;
}

export interface AnchorState {
  edges: EdgeChoice;
  corners: number[];
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
  const labels: LabelAnchor[] = [];
  const levels = o.everyLevel ? [0, 1, 2, 3, 4] : [0];
  const fileZ = edges.files * (frame.half + offset);
  const rankX = edges.ranks * (frame.half + offset);
  for (const z of levels) {
    const y = frame.levelY[z];
    for (let x = 0; x < GRID_SIZE; x++) {
      const [px] = layout.toWorld({ x, y: 0, z }, orientation);
      labels.push({
        id: `file-${FILES[x]}-${z}`,
        text: FILES[x],
        key: `z${edges.files}`,
        position: [px, y, fileZ],
      });
    }
    for (let r = 0; r < GRID_SIZE; r++) {
      const [, , pz] = layout.toWorld({ x: 0, y: r, z }, orientation);
      labels.push({
        id: `rank-${RANKS[r]}-${z}`,
        text: RANKS[r],
        key: `x${edges.ranks}`,
        position: [rankX, y, pz],
      });
    }
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
  return { state: { edges, corners }, labels };
};
