import { FILES, LEVELS, RANKS } from '../../engine/coords';
import type { FrameRing } from '../cameraFit';
import { GRID_SIZE, towerFrame } from '../layout';
import type { Orientation, TowerFrame } from '../layout';
import type { BoardLayout, Vec3 } from '../types';

// Where a tower's coordinate labels go, as a pure function of the camera:
// files and ranks along the two edges of a platform nearest the camera, just
// outside it (the bottom platform, or the top one from high above), and the
// five level letters up one corner post (letterCorner), each just outside its
// own platform's corner. From low and middling heights the post is a side of
// the tower's outline that carries no labels, the far end of the row facing
// the camera: the letters make one column up it, A at the bottom, outside the
// tower. From high up it is the corner across from where the files and ranks
// meet: a short line along its diagonal, each letter beside its own ring.
// Never in line with the files or the ranks. The edges, the row facing the
// camera and the height, and with them the letters' post, change only past a
// hysteresis band, so an orbit or a climb that wavers around a boundary
// never makes the labels flicker; the letters change post all together. A
// camera below LOW_ELEVATION (the orbit dips under the horizon) may see the
// platform carrying the files and ranks edge-on, or from below: they fade out
// near its plane, and take its far edges once under it (axisView).

/** Which platform edges carry the axis labels: the sign of the edge's z (files) and x (ranks). */
interface EdgeChoice {
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
const cameraAzimuth = (camera: Vec3, target: Vec3): number =>
  Math.atan2(camera[0] - target[0], camera[2] - target[2]);

/**
 * How far (radians) the camera turns past the tie between two edges before
 * the labels change edge (the files, the ranks and with them the level
 * letters' post), and before the letters take the other row's far end from
 * low down (facingRow): enough that no wobble ever makes them flicker, and no
 * more. Held further, from high up the letters' far post comes round to the
 * tower's side while the row held on the other side runs straight away from
 * the camera, and the two stand as a pair of columns either side of the
 * tower, each letter level with a label of the row, as if they labelled its
 * squares; from low down the side post comes round toward the front.
 */
export const EDGE_HYSTERESIS = (5 * Math.PI) / 180;

/**
 * The edges nearest the camera: files run along the z-edge on the camera's
 * side, ranks along the x-edge on its side. An edge is only given up once the
 * camera is EDGE_HYSTERESIS past the point where the two tie.
 */
export const chooseEdges = (azimuth: number, prev: EdgeChoice | null): EdgeChoice => {
  const band = Math.sin(EDGE_HYSTERESIS);
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
const cameraRight = (camera: Vec3, target: Vec3): Vec3 => {
  const f = sub(target, camera);
  // forward × up, with up = +y
  return norm([-f[2], 0, f[0]]);
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

const AXIS_MARGIN = 0.01;
const AXIS_MIN_ELEVATION = (40 * Math.PI) / 180;

/**
 * Which platform carries a row of axis labels (the files, or the ranks). The
 * bottom one (A) is their home, below everything from the usual low camera;
 * but from high above, perspective makes the nearer platforms wider on
 * screen, so the bottom one's labels would land on top of them. Then they
 * move to the top platform (E), whose edges are outermost from up there.
 * `placements(z)` gives where the labels would sit on level `z`. A move
 * needs the other platform clearly better (by AXIS_MARGIN, in units of the
 * tangent of the view angle), so the labels never flicker between the two;
 * below AXIS_MIN_ELEVATION they stay home whatever happens, as they always
 * have.
 */
const chooseAxisLevel = (
  camera: Vec3,
  target: Vec3,
  half: number,
  levelY: number[],
  placements: (z: number) => Vec3[],
  prev: number | null,
): number => {
  const margin = AXIS_MARGIN;
  const forward = norm(sub(target, camera));
  if (-forward[1] < Math.sin(AXIS_MIN_ELEVATION)) return 0;
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
const LOW_ELEVATION = 6 * DEG;
/** Between these grazing angles (above and below the platform's plane) the labels fade in. */
const FADE_FROM = 15 * DEG;
const FADE_TO = 6 * DEG;

interface AxisView {
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
 * FADE_FROM and FADE_TO; under the plane, its far edges are the lowest part of it on
 * screen, clear of every piece and platform, so the labels move there (the
 * mirror of the near edges from above). Only below LOW_ELEVATION.
 */
export const axisView = (camera: Vec3, target: Vec3, y: number): AxisView => {
  const v = sub(camera, target);
  const elevation = Math.asin(v[1] / (Math.hypot(v[0], v[1], v[2]) || 1));
  // 0 at LOW_ELEVATION and above (as always), 1 from 2° under it
  const low = Math.min(Math.max((LOW_ELEVATION - elevation) / (2 * DEG), 0), 1);
  // (a hair's tolerance, so a camera held at exactly 6° is above it)
  if (low < 1e-6) return { opacity: 1, below: false };
  const grazing = Math.atan2(camera[1] - y, Math.hypot(v[0], v[2]));
  const k = Math.min(Math.max((Math.abs(grazing) - FADE_TO) / (FADE_FROM - FADE_TO), 0), 1);
  const shown = k * k * (3 - 2 * k);
  return { opacity: 1 - low * (1 - shown), below: grazing < 0 };
};

/**
 * Camera elevations (radians, about the orbit target) where the level
 * letters change post: climbing past LETTERS_HIGH they leave the side post
 * for the far one, and dipping under LETTERS_LOW they come back, so a camera
 * wavering in between never makes them flicker.
 */
export const LETTERS_HIGH = 55 * DEG;
export const LETTERS_LOW = 45 * DEG;

/** Whether the letters stand at the far post (seen from high up): past LETTERS_HIGH, until back under LETTERS_LOW. */
export const lettersHigh = (elevation: number, prev: boolean | null): boolean => {
  if (prev === null) return elevation >= (LETTERS_HIGH + LETTERS_LOW) / 2;
  return prev ? elevation > LETTERS_LOW : elevation >= LETTERS_HIGH;
};

/**
 * Which row of labels faces the camera more squarely: the files (on a
 * z-edge) or the ranks (on an x-edge). They tie on the diagonals; the row
 * facing is only given up once the camera is EDGE_HYSTERESIS past one.
 */
export const facingRow = (azimuth: number, prev: 'files' | 'ranks' | null): 'files' | 'ranks' => {
  const files = Math.abs(Math.cos(azimuth));
  if (prev === null) return files >= Math.SQRT1_2 ? 'files' : 'ranks';
  if (prev === 'files') return files < Math.cos(Math.PI / 4 + EDGE_HYSTERESIS) ? 'ranks' : 'files';
  return files > Math.cos(Math.PI / 4 - EDGE_HYSTERESIS) ? 'files' : 'ranks';
};

/**
 * The corner post the level letters stand at (an index into CORNERS). From
 * low and middling heights, a post on the side of the tower's outline that
 * carries no labels: at the far end of the row that faces the camera (the
 * files, from the seat's own side; the ranks, looking along the files), so
 * the letters stand in a column outside the tower, square to that row and
 * across the tower from the other, which runs away from the camera. From
 * high up (`high`), the post touching neither the files' edge nor the ranks',
 * diagonally across from where they meet: a short line along its diagonal,
 * clear of both rows. All five letters share it, so they stand in one line
 * and change post together: when the edges or the facing row change (past
 * their hysteresis) or the camera climbs or dips past LETTERS_HIGH or
 * LETTERS_LOW.
 */
export const letterCorner = (
  edges: EdgeChoice,
  high: boolean,
  facing: 'files' | 'ranks' = 'files',
): number => {
  const [x, z] = high
    ? [-edges.ranks, -edges.files]
    : facing === 'files'
      ? [-edges.ranks, edges.files]
      : [edges.ranks, -edges.files];
  return CORNERS.findIndex(([cx, cz]) => cx === x && cz === z);
};

/**
 * How far a level letter stands out from its platform's corner, along the
 * corner's diagonal: from low down, clear of the platform's border and rim
 * (which reach about 0.13 along it) by half a letter and more, and two
 * letters' height from the end of the files or ranks beside it at every
 * pose; standing at a side of the outline, the letters widen what the view
 * frames (towerFrameRings), so no further. From high up, behind the tower,
 * where they widen nothing, a little further (LETTER_OFFSET_HIGH), so seen
 * from overhead on a phone they stand clear of one another.
 */
export const LETTER_OFFSET = 0.35;
export const LETTER_OFFSET_HIGH = 0.45;

/**
 * How far a level letter stands above its platform: enough that where the
 * row at its post runs away from the camera, from level with the bottom
 * platform, A stands clear above the row's last label rather than beside it.
 */
export const LETTER_LIFT = 0.16;

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
  /** The platforms carrying the file and the rank labels (see chooseAxisLevel). */
  axisLevels: { files: number; ranks: number };
  /** The corner post the level letters stand at (letterCorner), an index into CORNERS. */
  corner: number;
  /** The letters stand at the far post, seen from high up (lettersHigh). */
  high: boolean;
  /** The row facing the camera more squarely (facingRow), whose far end the letters take from low down. */
  facing: 'files' | 'ranks';
}

/** Distance of the file and rank labels outside the platform's edge. */
const AXIS_OFFSET = 0.42;

/** Where level `z`'s letter stands at corner post `corner`, from high up or low down. */
const letterAt = (frame: TowerFrame, z: number, corner: number, high: boolean): Vec3 => {
  const [sx, sz] = CORNERS[corner];
  const out = frame.half + (high ? LETTER_OFFSET_HIGH : LETTER_OFFSET) / Math.SQRT2;
  return [sx * out, frame.levelY[z] + LETTER_LIFT, sz * out];
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
): { state: AnchorState; labels: LabelAnchor[] } => {
  const frame = towerFrame(layout);
  const edges = chooseEdges(cameraAzimuth(camera, target), prev?.edges ?? null);
  const fileX = FILES.map((_, x) => layout.toWorld({ x, y: 0, z: 0 }, orientation)[0]);
  const rankZ = RANKS.map((_, r) => layout.toWorld({ x: 0, y: r, z: 0 }, orientation)[2]);
  // The files and the ranks each take the platform that keeps them clear of
  // the tower on screen (usually the bottom one)
  const fileAt = (z: number): Vec3[] =>
    fileX.map((px) => [px, frame.levelY[z], edges.files * (frame.half + AXIS_OFFSET)]);
  const rankAt = (z: number): Vec3[] =>
    rankZ.map((pz) => [edges.ranks * (frame.half + AXIS_OFFSET), frame.levelY[z], pz]);
  const pick = (at: (z: number) => Vec3[], was: number | undefined) =>
    chooseAxisLevel(camera, target, frame.half, frame.levelY, at, was ?? null);
  const axisLevels = {
    files: pick(fileAt, prev?.axisLevels.files),
    ranks: pick(rankAt, prev?.axisLevels.ranks),
  };
  const labels: LabelAnchor[] = [];
  const { files, ranks } = axisLevels;
  // Seen from low down: faded near the platform's plane, on its far edges under it
  const fileView = axisView(camera, target, frame.levelY[files]);
  const rankView = axisView(camera, target, frame.levelY[ranks]);
  const fileEdge = fileView.below ? -edges.files : edges.files;
  const rankEdge = rankView.below ? -edges.ranks : edges.ranks;
  const shown = (view: AxisView) => (view.opacity < 1 ? { opacity: view.opacity } : {});
  // (ids end in 0, whichever platform carries them)
  FILES.forEach((text, x) =>
    labels.push({
      id: `file-${text}-0`,
      text,
      key: `z${fileEdge}l${files}`,
      position: [fileX[x], frame.levelY[files], fileEdge * (frame.half + AXIS_OFFSET)],
      ...shown(fileView),
    }),
  );
  RANKS.forEach((text, r) =>
    labels.push({
      id: `rank-${text}-0`,
      text,
      key: `x${rankEdge}l${ranks}`,
      position: [rankEdge * (frame.half + AXIS_OFFSET), frame.levelY[ranks], rankZ[r]],
      ...shown(rankView),
    }),
  );
  const v = sub(camera, target);
  const elevation = Math.asin(v[1] / (Math.hypot(v[0], v[1], v[2]) || 1));
  const high = lettersHigh(elevation, prev?.high ?? null);
  const facing = facingRow(cameraAzimuth(camera, target), prev?.facing ?? null);
  const corner = letterCorner(edges, high, facing);
  LEVELS.forEach((text, z) =>
    labels.push({
      id: `level-${text}`,
      text,
      key: `c${corner}`,
      position: letterAt(frame, z, corner, high),
      level: z,
    }),
  );
  return { state: { edges, axisLevels, corner, high, facing }, labels };
};

/** World height of a file, rank or level letter's sprite. */
export const LABEL_SIZE = 0.32;
/**
 * How far a platform's glass and border reach past its outer squares (0.08:
 * the glass's margin and a border of the default width; the widest adds a
 * hundredth, well inside the fit's margin).
 */
const PLATE_REACH = 0.08;
/** How far a platform's rim hangs below it (0.03: the default rim's depth, and then some). */
const RIM_DEPTH = 0.03;

/** How far a label's glyph (with its outline) reaches from its anchor, as a share of its sprite's height. */
export const GLYPH_REACH = 0.3;

/**
 * What the camera keeps in frame for a tower (BoardLayout.frameRings): rings
 * about its axis round everything it shows, wherever it stands as the view
 * turns, so they look the same from every side (FitCameraToBoard):
 *
 * - its platforms, border and rim included;
 * - the tallest pieces the top platform can hold, up to the top of the
 *   layout's box, over its outer squares;
 * - the files and ranks, round the bottom and the top platform (either may
 *   carry them), wherever along either edge;
 * - the level letters, on the arcs their post keeps to: from low down never
 *   nearer the front of the tower than 45° less the hysteresis (a side of
 *   the outline), from high up never more than 45° and the hysteresis off
 *   straight behind it (letterCorner).
 *
 * Every label's ring reaches its glyph's size further out, up and down.
 */
export const towerFrameRings = (layout: BoardLayout): FrameRing[] => {
  const { half, pitch, levelY } = towerFrame(layout);
  const [bottom, top] = [levelY[0], levelY[levelY.length - 1]];
  const glyph = GLYPH_REACH * LABEL_SIZE;
  // The outer pieces stand half a square in from the edge, about a third of
  // a square wide either side of their centre
  const pieces = Math.SQRT2 * (half - pitch / 2 + 0.3 * pitch);
  const plates = Math.SQRT2 * (half + PLATE_REACH);
  // A row's end label stands off the platform's edge beside its last square
  const row = Math.hypot(half + AXIS_OFFSET, ((GRID_SIZE - 1) / 2) * pitch) + glyph;
  const corner = Math.SQRT2 * half + LETTER_OFFSET + glyph;
  const far = Math.SQRT2 * half + LETTER_OFFSET_HIGH + glyph;
  // The letters' post is never within 45° (less the edges' hysteresis) of
  // straight in front of the axis: at a side of the outline from low down;
  // from high up, further out, never more than 45° (and the hysteresis) off
  // straight behind it
  const sides = (3 * Math.PI) / 4 + EDGE_HYSTERESIS;
  const behind = Math.PI / 4 + EDGE_HYSTERESIS;
  // (one ring each round the bottom and the top platform with its files and
  // ranks, which nearly coincide: two would only add to the fit's easing)
  const edge = Math.max(plates, row);
  return [
    { y: bottom - Math.max(RIM_DEPTH, glyph), radius: edge },
    { y: top + glyph, radius: edge },
    { y: layout.halfExtents[1], radius: pieces },
    { y: bottom + LETTER_LIFT - glyph, radius: corner, behind: sides },
    { y: top + LETTER_LIFT + glyph, radius: corner, behind: sides },
    { y: bottom + LETTER_LIFT - glyph, radius: far, behind },
    { y: top + LETTER_LIFT + glyph, radius: far, behind },
  ];
};
