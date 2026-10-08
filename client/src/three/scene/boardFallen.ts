import { PieceType } from '../../engine/pieces';
import { cleanSculptureOf, knightBaseRight, sculptureOf } from './sculptures';
import { knightSlices } from './knightSilhouette';
import { KnightLines } from './sculptureStrokes';
import type { NeonCurve, V3 } from './boardNeon';
import type { NeonStroke } from './neonStrokes';

// Fallen giants: captured pieces lying on their sides on the plain past the
// colossal board's edge, as though taken off it long ago. Each rests as a
// turned piece would, on its base's rim and the widest point toward its
// head, so its axis dips a little toward the head; its outline turns about
// that axis to face the viewer (boardNeon's mode 2) and its rings stand
// round it. Stretches of their tubes have gone dark, as old neon does. They
// lie where the opening view never looks (out beyond the a- and h-files and
// the h8 corner), for a turn of the view or a zoom out to find. Pure
// geometry (no WebGL), in the garden's coordinates (turned for Black by the
// shader, as everything on the board is).

interface Fallen {
  type: PieceType;
  /** Where its base's centre lies over the ground (x, z). */
  at: readonly [number, number];
  /** The way its head points, degrees from +x toward +z. */
  heading: number;
  /** Stretches of its outlines gone dark: [outline, from, to] as shares of its length. */
  dead: readonly (readonly [number, number, number])[];
  /** Its rings' light (a ring can be dead too). */
  rings: readonly number[];
}

/** Their light, as a share of a standing sculpture's: half lit, and old. */
export const FALLEN_LIGHT = 0.5;
/** The light a dead stretch keeps: the glass catching a little of the night. */
const DEAD = 0.05;

export const FALLEN: readonly Fallen[] = [
  // Beyond the a-file near rank 3, its head toward White's side
  {
    type: PieceType.Pawn,
    at: [-39, 13],
    heading: 72,
    dead: [[0, 0.56, 0.69]],
    rings: [1, 0.25],
  },
  // Beyond the h-file near rank 6, its head toward Black's
  {
    type: PieceType.Bishop,
    at: [39.5, -15],
    heading: -104,
    dead: [
      [0, 0.17, 0.26],
      [0, 0.7, 0.75],
      [1, 0, 1],
    ],
    rings: [1, 1],
  },
  // Past the h8 corner, across the diagonal
  {
    type: PieceType.Knight,
    at: [40.5, -39],
    heading: 200,
    dead: [[0, 0.36, 0.47]],
    rings: [0.4, 1],
  },
];

/** How a piece rests on its side: its axis's dip toward the head (radians). */
const restingDip = (type: PieceType) => {
  const outline = sculptureOf(type).outlines[0].points;
  const r0 = Math.max(...outline.filter(([, y]) => y < 0.03).map(([x]) => Math.abs(x)));
  let dip = Math.PI / 2;
  for (const [x, y] of outline) {
    if (y < 0.05) continue;
    dip = Math.min(dip, Math.atan2(r0 - Math.abs(x), y));
  }
  return { dip: Math.max(0, dip), r0 };
};

const cumulative = (pts: readonly (readonly number[])[]) => {
  const out = [0];
  for (let k = 1; k < pts.length; k++) {
    out.push(out[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  }
  return out;
};

/** Where a fallen piece lies: its base's centre (3D), its axis, and its length. */
export const fallenPose = (f: Fallen, scale: number, groundY: number) => {
  const { dip, r0 } = restingDip(f.type);
  const h = (f.heading * Math.PI) / 180;
  const axis: V3 = [Math.cos(h) * Math.cos(dip), -Math.sin(dip), Math.sin(h) * Math.cos(dip)];
  // High enough that, however its drawing turns about the axis, its lowest
  // point (the base's rim, or a knight's wider head) just meets the ground
  let lift = 0;
  for (const o of sculptureOf(f.type).outlines) {
    for (const [x, y] of o.points) {
      lift = Math.max(lift, (Math.abs(x) * Math.cos(dip) + y * Math.sin(dip)) * scale);
    }
  }
  const at: V3 = [f.at[0], groundY + lift, f.at[1]];
  return { at, axis, length: sculptureOf(f.type).top * scale, radius: r0 * scale };
};

/**
 * Every fallen piece's tubes. `slot` is the first gardenWhole slot they
 * take, one each, so the tower's shade can take each whole.
 */
export const fallenCurves = (scale: number, groundY: number, slot: number): NeonCurve[] =>
  FALLEN.flatMap((f, i) => {
    const { at, axis } = fallenPose(f, scale, groundY);
    const drawing = sculptureOf(f.type);
    const sculpt = slot + i;
    const outlines = drawing.outlines.map((o, j): NeonCurve => {
      const s = cumulative(o.points);
      const total = s[s.length - 1] || 1;
      const light = s.map((d) => {
        const t = d / total;
        const dead = f.dead.some(([k, a, b]) => k === j && t >= a && t <= b);
        return (dead ? DEAD : 1) * FALLEN_LIGHT;
      });
      return {
        at,
        points: o.points.map(([x, y]): V3 => [x * scale, y * scale, 0]),
        closed: o.closed,
        mode: 2,
        axis,
        sculpt,
        light,
      };
    });
    // Its rings stand round its axis, in the plane across it
    const ux = -axis[2];
    const uz = axis[0];
    const ul = Math.hypot(ux, uz) || 1;
    const u: V3 = [ux / ul, 0, uz / ul];
    const v: V3 = [
      u[1] * axis[2] - u[2] * axis[1],
      u[2] * axis[0] - u[0] * axis[2],
      u[0] * axis[1] - u[1] * axis[0],
    ];
    const rings = drawing.rings.map((ring, j): NeonCurve => {
      const c = [axis[0] * ring.y * scale, axis[1] * ring.y * scale, axis[2] * ring.y * scale];
      const r = ring.radius * scale;
      const points = Array.from({ length: 24 }, (_, k): V3 => {
        const a = (k / 24) * Math.PI * 2;
        return [
          c[0] + (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * r,
          c[1] + (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * r,
          c[2] + (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * r,
        ];
      });
      return {
        at,
        points,
        closed: true,
        mode: 1,
        sculpt,
        light: (f.rings[j] ?? 1) * FALLEN_LIGHT * 0.7,
      };
    });
    return [...outlines, ...rings];
  });

/**
 * Points round each fallen piece (garden coordinates), for how much of it
 * the tower's shade covers on screen.
 */
export const fallenBodies = (scale: number, groundY: number): V3[][] =>
  FALLEN.map((f) => {
    const { at, axis, length, radius } = fallenPose(f, scale, groundY);
    const tip: V3 = [at[0] + axis[0] * length, at[1] + axis[1] * length, at[2] + axis[2] * length];
    return [at, tip].flatMap(([x, y, z]): V3[] => [
      [x - radius, y - radius, z],
      [x + radius, y + radius, z],
      [x, y - radius, z - radius],
      [x, y + radius, z + radius],
    ]);
  });

// --- Clean lines (sculptureLines: clean) ------------------------------------------
//
// Drawn clean, the fallen pieces keep their tubes whole (no stretch gone
// dark: an unbroken tube, the whole piece a little dimmer for its age), and
// what is not the same from every side lies fixed with the piece: the
// bishop's cut on its mitre, and the knight on its side, its cheek to the
// ground and its muzzle along it, outlined by its silhouette from wherever
// the camera stands (knightSilhouette.ts) as the standing knights are.

/** A fallen piece's light, drawn clean: whole, and a little dimmer than the dead-lit old ones' bright parts. */
export const FALLEN_CLEAN_LIGHT = FALLEN_LIGHT * 0.8;

/**
 * How far out from its axis a piece reaches at each height (piece units),
 * as it lies: a turned piece its outline; the knight, on its side, its
 * base's outline and its head's half-thickness (its ears included).
 */
const restingExtent = (type: PieceType): [number, number][] => {
  if (type !== PieceType.Knight) {
    return sculptureOf(type).outlines[0].points.map(([x, y]): [number, number] => [Math.abs(x), y]);
  }
  const head = knightSlices().map(({ y, parts, ears }): [number, number] => {
    let z = 0;
    for (const p of parts) for (const v of p.z) z = Math.max(z, v);
    if (ears) z = Math.max(z, ears.z + ears.r);
    return [z, y];
  });
  return [...knightBaseRight(), ...head];
};

/** Where a fallen piece lies, drawn clean: as fallenPose, the knight resting on its side. */
export const fallenPoseClean = (f: Fallen, scale: number, groundY: number) => {
  const extent = restingExtent(f.type);
  const r0 = Math.max(...extent.filter(([, y]) => y < 0.03).map(([x]) => x));
  let dip = Math.PI / 2;
  for (const [x, y] of extent) {
    if (y < 0.05) continue;
    dip = Math.min(dip, Math.atan2(r0 - x, y));
  }
  dip = Math.max(0, dip);
  const h = (f.heading * Math.PI) / 180;
  const axis: V3 = [Math.cos(h) * Math.cos(dip), -Math.sin(dip), Math.sin(h) * Math.cos(dip)];
  let lift = 0;
  for (const [x, y] of extent)
    lift = Math.max(lift, (x * Math.cos(dip) + y * Math.sin(dip)) * scale);
  const at: V3 = [f.at[0], groundY + lift, f.at[1]];
  // Its own frame: along the ground across its axis (the knight's muzzle),
  // and up from the ground (the knight's upper cheek)
  const ul = Math.hypot(axis[0], axis[2]) || 1;
  const along: V3 = [-axis[2] / ul, 0, axis[0] / ul];
  const across: V3 = [
    along[1] * axis[2] - along[2] * axis[1],
    along[2] * axis[0] - along[0] * axis[2],
    along[0] * axis[1] - along[1] * axis[0],
  ];
  return { at, axis, along, across, length: sculptureOf(f.type).top * scale, radius: r0 * scale };
};

/** A point of a lying piece (x along, y up its axis, z across) about its base's centre, in the world. */
const lying = (
  pose: { axis: V3; along: V3; across: V3 },
  [x, y, z]: readonly number[],
  scale = 1,
): V3 => [
  (pose.along[0] * x + pose.axis[0] * y + pose.across[0] * z) * scale,
  (pose.along[1] * x + pose.axis[1] * y + pose.across[1] * z) * scale,
  (pose.along[2] * x + pose.axis[2] * y + pose.across[2] * z) * scale,
];

/**
 * Every fallen piece's strokes, drawn clean, but the knight's outline
 * (fallenKnightLines). `slot` is the first gardenWhole slot they take.
 */
export const fallenStrokes = (scale: number, groundY: number, slot: number): NeonStroke[] =>
  FALLEN.flatMap((f, i) => {
    const pose = fallenPoseClean(f, scale, groundY);
    const d = cleanSculptureOf(f.type);
    const sculpt = slot + i;
    const { at, axis } = pose;
    return [
      ...d.outlines.map(
        (o): NeonStroke => ({
          at,
          points: o.points.map(([x, y]): V3 => [x * scale, y * scale, 0]),
          closed: o.closed,
          mode: 2,
          axis,
          sculpt,
          light: FALLEN_CLEAN_LIGHT,
        }),
      ),
      ...d.fixed.map(
        (s): NeonStroke => ({
          at,
          points: s.points.map((p) => lying(pose, p, scale)),
          normals: s.normals.map((n) => lying(pose, n)),
          closed: s.closed,
          mode: 1,
          axis,
          sculpt,
          light: FALLEN_CLEAN_LIGHT,
        }),
      ),
      ...d.rings.map(
        (ring): NeonStroke => ({
          at,
          points: Array.from({ length: 48 }, (_, k) => {
            const a = (k / 48) * Math.PI * 2;
            return lying(
              pose,
              [Math.cos(a) * ring.radius, ring.y, Math.sin(a) * ring.radius],
              scale,
            );
          }),
          closed: true,
          mode: 1,
          sculpt,
          light: FALLEN_CLEAN_LIGHT * 0.7,
        }),
      ),
    ];
  });

/** The fallen knight's outline, its silhouette from the camera as it lies (KnightLines). */
export const fallenKnightLines = (scale: number, groundY: number, slot: number) => {
  const i = FALLEN.findIndex((f) => f.type === PieceType.Knight);
  const pose = fallenPoseClean(FALLEN[i], scale, groundY);
  return new KnightLines(
    [{ type: PieceType.Knight, at: pose.at }],
    scale,
    [{ axis: pose.axis, along: pose.along, across: pose.across }],
    slot + i,
  );
};
