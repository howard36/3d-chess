import { PieceType } from '../../engine/pieces';
import { cleanSculptureOf } from './sculptures';
import { knightOutline } from './knightSilhouette';
import { ringPoints } from './boardNeon';
import type { V3 } from './boardNeon';
import type { NeonStroke } from './neonStrokes';

// The garden's sculptures as clean strokes (sculptureLines: clean; the tubes
// themselves in neonStrokes.ts): each turned piece's outline one stroke
// facing the viewer, the same from every side; its rings fitted to it; the
// details that are not the same from every side (the bishop's cut, the
// unicorn's spiral) fixed on the body in 3D, facing its own way in the
// world; and the knights, which look one way, outlined by their silhouette
// from wherever the camera stands (knightSilhouette.ts), redrawn as it
// moves. Pure (no WebGL).

export interface Place {
  type: PieceType;
  at: V3;
  /** The point (x, z) it faces: its twin for a knight, else the board's centre. */
  toward?: readonly [number, number];
}

/** Rings are a little quieter than the outlines they stand the pieces on. */
export const RING_LIGHT = 0.7;

/**
 * Which way a sculpture faces in the world (unit x, z), for what is not the
 * same from every side: a knight its twin; a bishop's cut and a unicorn's
 * spiral across the line to the board's centre, so the opening views see
 * the cut slanted, as the piece is drawn.
 */
export const facingOf = ({ type, at, toward = [0, 0] }: Place): [number, number] => {
  const dx = toward[0] - at[0];
  const dz = toward[1] - at[2];
  const l = Math.hypot(dx, dz) || 1;
  const [fx, fz] = [dx / l, dz / l];
  return type === PieceType.Knight ? [fx, fz] : [-fz, fx];
};

/** A point of a sculpture (x along its facing, y up, z across) about its foot, in the world. */
export const toWorld = ([fx, fz]: readonly [number, number], [x, y, z]: V3, scale = 1): V3 => [
  (x * fx - z * fz) * scale,
  y * scale,
  (x * fz + z * fx) * scale,
];

/** Every sculpture's strokes but the knights' outlines (KnightLines draws those). */
export const sculptureStrokes = (places: readonly Place[], scale: number): NeonStroke[] =>
  places.flatMap((place, sculpt) => {
    const d = cleanSculptureOf(place.type);
    const facing = facingOf(place);
    const { at } = place;
    return [
      ...d.outlines.map(
        (o): NeonStroke => ({
          at,
          points: o.points.map(([x, y]): V3 => [x * scale, y * scale, 0]),
          closed: o.closed,
          sculpt,
        }),
      ),
      ...d.fixed.map(
        (f): NeonStroke => ({
          at,
          points: f.points.map((p) => toWorld(facing, p, scale)),
          normals: f.normals.map((n) => toWorld(facing, n)),
          closed: f.closed,
          mode: 1,
          sculpt,
        }),
      ),
      ...d.rings.map(
        (ring): NeonStroke => ({
          at,
          points: ringPoints(ring.radius * scale, ring.y * scale, 36),
          closed: true,
          mode: 1,
          sculpt,
          light: RING_LIGHT,
        }),
      ),
    ];
  });

/** Room for one knight's outline (segments). */
export const KNIGHT_SEGMENTS = 640;

/**
 * The view's screen-right across a drawing standing at `anchor` and facing
 * the camera (as STROKE_VERTEX turns mode 0), as its share along `facing`
 * and across it: what a knight's silhouette depends on.
 */
export const viewAcross = (
  camera: V3,
  anchor: V3,
  [fx, fz]: readonly [number, number],
): [number, number] => {
  let hx = camera[0] - anchor[0] + 1e-5;
  let hz = camera[2] - anchor[2];
  const l = Math.hypot(hx, hz) || 1;
  hx /= l;
  hz /= l;
  // right = (hz, 0, -hx); across = (-fz, 0, fx)
  return [hz * fx - hx * fz, -hz * fz - hx * fx];
};

/**
 * The knights' outlines, each its silhouette from the camera, kept until
 * the camera moves round it (`update` says whether any changed).
 */
export class KnightLines {
  private readonly knights: { at: V3; facing: [number, number]; sculpt: number }[];
  private readonly views: [number, number][];
  strokes: NeonStroke[] = [];

  constructor(
    places: readonly Place[],
    private readonly scale: number,
    /** Lying knights (mode 2): their axis, and their facing and across as world vectors. */
    private readonly lying?: { axis: V3; along: V3; across: V3 }[],
    /** The first gardenWhole slot they take (by their index in `places`). */
    firstSlot = 0,
  ) {
    this.knights = places.flatMap((p, sculpt) =>
      p.type === PieceType.Knight
        ? [{ at: p.at, facing: facingOf(p), sculpt: firstSlot + sculpt }]
        : [],
    );
    this.views = this.knights.map(() => [NaN, NaN]);
  }

  get count() {
    return this.knights.length;
  }

  /** Redraws the knights the camera has moved round; true if any changed. */
  update(camera: V3, turn: number): boolean {
    let changed = false;
    this.knights.forEach((k, i) => {
      const at: V3 = [k.at[0] * turn, k.at[1], k.at[2] * turn];
      const facing: [number, number] = [k.facing[0] * turn, k.facing[1] * turn];
      const lie = this.lying?.[i];
      const [c, s] = lie ? lyingAcross(camera, at, lie, turn) : viewAcross(camera, at, facing);
      const [c0, s0] = this.views[i];
      if (Math.abs(c - c0) < 1e-6 && Math.abs(s - s0) < 1e-6) return;
      this.views[i] = [c, s];
      changed = true;
      const outline = knightOutline(c, s);
      this.strokes[i] = {
        at: k.at,
        points: outline.map(([x, y]): V3 => [x * this.scale, y * this.scale, 0]),
        closed: false,
        mode: lie ? 2 : 0,
        axis: lie?.axis,
        sculpt: k.sculpt,
      };
    });
    return changed;
  }
}

/** For a knight lying on its side (mode 2): the screen-across's share along its facing and across. */
const lyingAcross = (
  camera: V3,
  at: V3,
  lie: { axis: V3; along: V3; across: V3 },
  turn: number,
): [number, number] => {
  const t = (v: V3): V3 => [v[0] * turn, v[1], v[2] * turn];
  const [ax, ay, az] = t(lie.axis);
  const tc = [camera[0] - at[0], camera[1] - at[1], camera[2] - at[2]];
  // across = axis × toCam, as STROKE_VERTEX turns a lying drawing
  let x = ay * tc[2] - az * tc[1];
  let y = az * tc[0] - ax * tc[2];
  let z = ax * tc[1] - ay * tc[0];
  const l = Math.hypot(x, y, z);
  if (l < 1e-5) [x, y, z] = [0, 1, 0];
  else [x, y, z] = [x / l, y / l, z / l];
  const f = t(lie.along);
  const w = t(lie.across);
  return [x * f[0] + y * f[1] + z * f[2], x * w[0] + y * w[1] + z * w[2]];
};
