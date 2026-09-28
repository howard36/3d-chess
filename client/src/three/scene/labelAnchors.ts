import { FILES, LEVELS, RANKS } from '../../engine/coords';
import { GRID_SIZE } from '../layout';
import type { Orientation } from '../layout';
import { towerFrame } from '../layout';
import type { TowerFrame } from '../layout';
import type { BoardLayout, Vec3 } from '../types';

// Where a tower's coordinate labels go, as a pure function of the camera:
// files and ranks along the two edges of a platform nearest the camera, just
// outside it (the bottom platform, or the top one from high above), and each
// level letter beside its platform's screen-left corner, outside the tower's
// silhouette. From high above, where those corners all but meet on screen,
// the letters leave them for a row along the tower's screen-left edge
// (levelSpread). Choices only change past a hysteresis band,
// so an orbit that wavers around a boundary never makes the labels flicker.
// A camera below LOW_ELEVATION (the orbit dips under the horizon) may see
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

const DEG = Math.PI / 180;

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

/**
 * Camera elevation (about the orbit target) under which the file and rank
 * labels watch for their platform seen edge-on or from below. Above it the
 * labels keep to the nearest edges; the rules below take over across the 2°
 * beneath it.
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

/**
 * Camera elevations (radians, about the orbit target) across which the level
 * letters leave their corners for a row along one edge of the tower. Seen from
 * above, the levels' screen-left corners converge (the gap between levels
 * shrinks with the cosine of the elevation), and past about 75° the five
 * letters touch; from 74° up they stand a pitch apart, A nearest the player's
 * side and E furthest, as they stack from below in the side view.
 */
export const LEVEL_SPREAD_FROM = 58 * DEG;
export const LEVEL_SPREAD_TO = 74 * DEG;

/** Platform edges by index, as the (x, z) of their outward normal. */
export const EDGES: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/** How far the level letters have gone from their corners to their row, 0–1 (eased). */
export const levelSpread = (camera: Vec3, target: Vec3): number => {
  const v = sub(camera, target);
  const elevation = Math.asin(v[1] / (Math.hypot(v[0], v[1], v[2]) || 1));
  const k = Math.min(
    Math.max((elevation - LEVEL_SPREAD_FROM) / (LEVEL_SPREAD_TO - LEVEL_SPREAD_FROM), 0),
    1,
  );
  return k * k * (3 - 2 * k);
};

/**
 * The platform edge (index into EDGES) facing furthest left on screen. The
 * previous edge is kept unless another faces left by more than `hysteresis`
 * (the sine of the angle between them).
 */
export const chooseLevelEdge = (
  camera: Vec3,
  target: Vec3,
  prev: number | null,
  hysteresis = Math.sin(10 * DEG),
): number => {
  const right = cameraRight(camera, target);
  const facing = EDGES.map(([nx, nz]) => nx * right[0] + nz * right[2]);
  let best = 0;
  for (let i = 1; i < EDGES.length; i++) if (facing[i] < facing[best]) best = i;
  if (prev !== null && facing[prev] <= facing[best] + hysteresis) return prev;
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
  /** The edge the level letters line up along from above (see chooseLevelEdge), while they do. */
  levelEdge?: number;
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
 * Where level `z`'s letter stands, for a camera whose horizontal right-hand
 * direction is `right`: beside corner `corner` of its platform, drawn toward
 * its place in the row along edge `edge` (see levelSpread) by `spread`.
 */
const levelLetterAt = (
  frame: TowerFrame,
  z: number,
  corner: number,
  edge: number | null,
  spread: number,
  right: Vec3,
  o: AnchorOptions,
): Vec3 => {
  const levelOffset = o.levelOffset ?? 0.55;
  const lift = o.levelLift ?? 0.12;
  const [sx, sz] = CORNERS[corner];
  const beside: Vec3 = [
    sx * frame.half - right[0] * levelOffset,
    frame.levelY[z] + lift,
    sz * frame.half - right[2] * levelOffset,
  ];
  if (edge === null || spread <= 0) return beside;
  // The row: just outside the top platform's edge, as far out as the files
  // and ranks (which from up there stand round the same platform), running
  // up the screen from A to E a pitch apart. Up the screen along the edge is
  // the camera's horizontal heading, (right.z, -right.x).
  const top = frame.levelY.length - 1;
  const [nx, nz] = EDGES[edge];
  const [tx, tz] = [-nz, nx];
  const heading = tx * right[2] - tz * right[0];
  const along = (heading < 0 ? -1 : 1) * (z - top / 2) * frame.pitch;
  const out = frame.half + (o.offset ?? 0.42);
  const row: Vec3 = [nx * out + tx * along, frame.levelY[top] + lift, nz * out + tz * along];
  return beside.map((c, i) => c + (row[i] - c) * spread) as Vec3;
};

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
  const right = cameraRight(camera, target);
  // From high above, the letters line up along the tower's screen-left edge
  const spread = levelSpread(camera, target);
  const levelEdge = spread > 0 ? chooseLevelEdge(camera, target, prev?.levelEdge ?? null) : null;
  frame.levelY.forEach((_, z) => {
    const position = levelLetterAt(frame, z, corners[z], levelEdge, spread, right, o);
    const key =
      levelEdge === null
        ? `c${corners[z]}`
        : spread >= 1
          ? `e${levelEdge}`
          : `c${corners[z]}e${levelEdge}`;
    labels.push({ id: `level-${LEVELS[z]}`, text: LEVELS[z], key, position, level: z });
  });
  return {
    state: { edges, corners, axisLevels, ...(levelEdge !== null ? { levelEdge } : {}) },
    labels,
  };
};

export interface LabelFrameOptions extends AnchorOptions {
  /** World height of a file or rank label's sprite, as given to SmartLabels. */
  size?: number;
  /** How much larger the level letters are drawn, as given to SmartLabels. */
  levelScale?: number;
}

/** A smooth step from 0 at `from` to 1 at `to`. */
const ramp = (v: number, from: number, to: number) => {
  const k = Math.min(Math.max((v - from) / (to - from), 0), 1);
  return k * k * (3 - 2 * k);
};

/**
 * How close a choice is to its tie, for a choice whose hysteresis holds it
 * up to sin(10°) past the tie: 1 up to sin(12°) from the tie, easing to 0
 * by sin(20°). `past` is how far the winner leads (a sine).
 */
const nearTie = (past: number) => 1 - ramp(past, Math.sin(12 * DEG), Math.sin(20 * DEG));

const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/**
 * What the camera keeps in frame for a tower (BoardLayout.framePoints),
 * seen from `eye` looking at the board's centre: its platforms, the tallest
 * pieces the top one can hold (up to the top of the layout's box, over its
 * outer squares), and the glyphs of its SmartLabels where labelAnchors puts
 * them, framed so the view never lurches as the camera turns:
 *
 * - a choice the labels make with hysteresis (which edge the files or ranks
 *   run along, which one the letters line up along from above) may still be
 *   the other one near its tie, so there both are framed, the other easing
 *   in from the first as the tie nears;
 * - the files and ranks may move to the top platform from 40° up, so theirs
 *   are framed there too, easing up from the bottom one from 30°;
 * - each level letter is framed at every corner (only the leftmost reaches
 *   out: the others stand inside the tower).
 *
 * Pass the size, level scale and anchor options the grid gives SmartLabels.
 */
export const towerFramePoints = (
  layout: BoardLayout,
  { size = 0.36, levelScale = 1.45, ...o }: LabelFrameOptions = {},
): ((eye: Vec3) => Vec3[]) => {
  const frame = towerFrame(layout);
  const { half, pitch, levelY } = frame;
  const top = levelY.length - 1;
  // The outer pieces stand half a square in from the edge, about a third of
  // a square wide either side of their centre
  const pieces = half - pitch / 2 + 0.3 * pitch;
  const outline = [
    ...levelY.flatMap((y) => CORNERS.map(([x, z]): Vec3 => [x * half, y, z * half])),
    ...CORNERS.map(([x, z]): Vec3 => [x * pieces, layout.halfExtents[1], z * pieces]),
  ];
  // A row of files (along a z-edge) or ranks (along an x-edge) on the side
  // `s` of the platform at height `y`: its two ends reach furthest
  const out = half + (o.offset ?? 0.42);
  const end = ((GRID_SIZE - 1) / 2) * pitch;
  const fileRow = (y: number, s: number): Vec3[] => [
    [-end, y, s * out],
    [end, y, s * out],
  ];
  const rankRow = (y: number, s: number): Vec3[] => [
    [s * out, y, -end],
    [s * out, y, end],
  ];
  return (eye) => {
    const target: Vec3 = [0, 0, 0];
    const right = cameraRight(eye, target);
    const f = norm(sub(target, eye));
    const up: Vec3 = [
      right[1] * f[2] - right[2] * f[1],
      right[2] * f[0] - right[0] * f[2],
      right[0] * f[1] - right[1] * f[0],
    ];
    const azimuth = cameraAzimuth(eye, target);
    const elevation = Math.asin(eye[1] / (Math.hypot(eye[0], eye[1], eye[2]) || 1));
    const onTop = ramp(elevation, 30 * DEG, 40 * DEG);
    // Each axis: its rows on the bottom platform and (easing up) the top one,
    // on the camera's side, and near a tie or near the platform's plane (where
    // the labels fade and cross to the far side) on the other side too
    const axis = (row: (y: number, s: number) => Vec3[], lead: number): Vec3[] => {
      const side = lead >= 0 ? 1 : -1;
      const tie = nearTie(Math.abs(lead));
      const rowsOn = (z: number): [Vec3[], Vec3[], number] => {
        const view = axisView(eye, target, levelY[z]);
        const near = view.below ? -side : side;
        return [row(levelY[z], near), row(levelY[z], -near), Math.max(tie, 1 - view.opacity)];
      };
      const [bottom, bottomFar, bottomBoth] = rowsOn(0);
      const [upper, upperFar, upperBoth] = rowsOn(top);
      return [0, 1].flatMap((i) => {
        const b = bottom[i];
        const bf = lerp(b, bottomFar[i], bottomBoth);
        const u = lerp(b, upper[i], onTop);
        const uf = lerp(u, lerp(upper[i], upperFar[i], upperBoth), onTop);
        return [b, bf, u, uf];
      });
    };
    const labels = [...axis(fileRow, Math.cos(azimuth)), ...axis(rankRow, Math.sin(azimuth))];
    // The level letters: at every corner, and from above toward their row
    // along the edge facing left, or (near a tie) the next one
    const spread = levelSpread(eye, target);
    const lead = spread > 0 ? chooseLevelEdge(eye, target, null) : null;
    const facing = EDGES.map(([nx, nz]) => nx * right[0] + nz * right[2]);
    const letters = levelY.flatMap((_, z) =>
      CORNERS.flatMap((_, c) => {
        const at = levelLetterAt(frame, z, c, lead, spread, right, o);
        if (lead === null) return [at];
        return EDGES.map((_, e) =>
          lerp(
            at,
            levelLetterAt(frame, z, c, e, spread, right, o),
            nearTie(facing[e] - facing[lead]),
          ),
        );
      }),
    );
    // A glyph fills about four fifths of its sprite
    const glyphs = (points: Vec3[], h: number) =>
      points.flatMap((p) =>
        CORNERS.map(
          ([a, b]): Vec3 => [
            p[0] + (right[0] * a + up[0] * b) * h,
            p[1] + (right[1] * a + up[1] * b) * h,
            p[2] + (right[2] * a + up[2] * b) * h,
          ],
        ),
      );
    return [...outline, ...glyphs(labels, 0.4 * size), ...glyphs(letters, 0.4 * size * levelScale)];
  };
};
