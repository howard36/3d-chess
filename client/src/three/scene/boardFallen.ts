import { PieceType } from '../../engine/pieces';
import { cleanSculptureOf, knightBaseRight, sculptureOf } from './sculptures';
import { knightSlices } from './knightSilhouette';
import { KnightLines } from './sculptureStrokes';
import type { NeonStroke, V3 } from './neonStrokes';

// Fallen giants: captured pieces lying on their sides on the plain past the
// colossal board's edge, as though taken off it long ago, their tubes whole
// and a little dimmer than a standing sculpture's for their age. Each rests
// as a turned piece would, on its base's rim and the widest point toward its
// head, so its axis dips a little toward the head; its outline turns about
// that axis to face the viewer (neonStrokes' mode 2) and its rings stand
// round it. What is not the same from every side lies fixed with the piece:
// the bishop's cut on its mitre, and the knight on its side, its cheek to the
// ground and its muzzle along it, outlined by its silhouette from wherever
// the camera stands (knightSilhouette.ts) as the standing knights are. They
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
}

/** Their light, as a share of a standing sculpture's: old, and dimmer. */
const FALLEN_LIGHT = 0.4;

export const FALLEN: readonly Fallen[] = [
  // Beyond the a-file near rank 3, its head toward White's side
  { type: PieceType.Pawn, at: [-39, 13], heading: 72 },
  // Beyond the h-file near rank 6, its head toward Black's
  { type: PieceType.Bishop, at: [39.5, -15], heading: -104 },
  // Past the h8 corner, across the diagonal
  { type: PieceType.Knight, at: [40.5, -39], heading: 200 },
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

/**
 * About where a fallen piece lies, as its outline turned about its axis
 * (its bounds: fallenBodies): its base's centre (3D), its axis, its length
 * and its base's radius.
 */
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

/** Where a fallen piece lies as it is drawn: as fallenPose, the knight resting on its side. */
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
 * Every fallen piece's strokes but the knight's outline
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
          light: FALLEN_LIGHT,
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
          light: FALLEN_LIGHT,
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
          light: FALLEN_LIGHT * 0.7,
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
