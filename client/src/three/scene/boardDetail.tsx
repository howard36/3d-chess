import { useMemo } from 'react';
import type { BufferGeometry } from 'three';
import { PieceType } from '../../engine/pieces';
import { PROFILES } from '../pieces';
import type { GardenDetailProps } from './gardenDetail';
import { GROUND_Y } from './palette';
import { useDisposeOnUnmount } from './dispose';
import {
  ALWAYS_WHOLE,
  FALLEN_SLOT,
  GARDEN,
  gardenNeon,
  GardenTubes,
  SCALE,
  squareCentre,
  useKnightTubes,
} from './stage';
import { innerOutlinesOf, knightEyeOf, moreRingsOf, sculptureOf } from './sculptures';
import { neonCurves, ringPoints } from './boardNeon';
import type { NeonCurve, V3 } from './boardNeon';
import { neonStrokes } from './neonStrokes';
import type { NeonStroke } from './neonStrokes';
import { knightEyes } from './knightSilhouette';
import { facingOf, RING_LIGHT, toWorld } from './sculptureStrokes';
import { fallenCurves, fallenKnightLines, fallenStrokes } from './boardFallen';
// ENV PREVIEW (temporary): the preview's settings
import { useEnvSetting } from '../../envPreview';
import { fallenPieces, sculptureDetail, sculptureLines } from '../../envPreview/features/board';

// Area B, the colossal board and its sculptures: detail added to the twelve
// neon pieces and round them, all drawn with the sculptures' own tubes (one
// ribbon mesh and its reflection, the same program), so it is lit, dimmed,
// turned for Black and taken by the tower's shade exactly as they are
// (gardenWhole: a sculpture's detail goes with it). The ground's share (the
// board's frame, its squares, the pools of light) is in boardGround.ts.
//
//   inner  a second, quieter tube just inside each outline, and more rings
//          where the turning has them (the foot's top, the crown's rim...)
//   full   also each sculpture's footprint on its square, the rings left
//          by the pawns gone from ranks 2 and 7 (the e-pawns' squares bare:
//          they went where the tower stands), the knights' eyes (one of the
//          twins winks), and a pawn no taller than a hand at the white
//          king's foot
//   fallen captured giants lying past the board's edge (boardFallen.ts)
//
// Drawn clean (sculptureLines), every tube is whole: no inner tube (it could
// only run in pieces, stopping where a piece narrows or a detail begins),
// the footprint one closed square (its corner brackets read as a dashed
// line), the knights' eyes fixed on the sides of their heads (seen from
// that side only; the a5 knight winks on one side), and the fallen pieces'
// tubes unbroken (boardFallen.ts).

/** The inner tube's light, as a share of the outline's. */
const INNER = 0.38;
/** The added rings' light (rings are a little quieter again in the shader). */
const RINGS = 0.6;
/** A footprint's light. */
const FOOTPRINT = 0.3;
/** The pawns' rings left behind. */
const PAWN_RINGS = 0.3;
/** The squares the pawns left (but for the e-pawns, which went to e4 and e5). */
const PAWN_SQUARES = ['a', 'c', 'd', 'f', 'h'].flatMap((f) => [`${f}2`, `${f}7`]);

const detailCurves = (level: 'off' | 'inner' | 'full'): NeonCurve[] => {
  if (level === 'off') return [];
  const curves: NeonCurve[] = [];
  GARDEN.forEach(({ type, at, toward }, sculpt) => {
    for (const run of innerOutlinesOf(type)) {
      curves.push({
        at,
        toward,
        points: run.map(([x, y]): V3 => [x * SCALE, y * SCALE, 0]),
        closed: false,
        sculpt,
        light: INNER,
      });
    }
    for (const ring of moreRingsOf(type)) {
      curves.push({
        at,
        toward,
        points: ringPoints(ring.radius * SCALE, ring.y * SCALE),
        closed: true,
        mode: 1,
        sculpt,
        light: RINGS,
      });
    }
    if (level !== 'full') return;
    // Its footprint: a square round its foot, and brackets at the corners
    // of a larger one
    const h = PROFILES.radius[type] * SCALE + 1.0;
    const y = 0.02;
    const square: V3[] = [
      [-h, y, -h],
      [h, y, -h],
      [h, y, h],
      [-h, y, h],
    ];
    curves.push({ at, points: square, closed: true, mode: 1, sculpt, light: FOOTPRINT });
    const g = h + 0.5;
    const arm = 0.75;
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      curves.push({
        at,
        points: [
          [sx * (g - arm), y, sz * g],
          [sx * g, y, sz * g],
          [sx * g, y, sz * (g - arm)],
        ],
        closed: false,
        mode: 1,
        sculpt,
        light: FOOTPRINT * 0.75,
      });
    }
    // The knights' eyes: the one on a5 winks at its twin
    if (type === PieceType.Knight) {
      const eye = knightEyeOf(GARDEN[sculpt].square === 'a5');
      curves.push({
        at,
        toward,
        points: eye.points.map(([x, y]): V3 => [x * SCALE, y * SCALE, 0]),
        closed: eye.closed,
        sculpt,
        light: 0.8,
      });
    }
  });
  if (level !== 'full') return curves;
  // The pawns' rings, left on their squares
  for (const square of PAWN_SQUARES) {
    const [x, z] = squareCentre(square);
    curves.push({
      at: [x, GROUND_Y, z],
      points: ringPoints(PROFILES.radius[PieceType.Pawn] * SCALE, 0.002 * SCALE),
      closed: true,
      mode: 1,
      sculpt: ALWAYS_WHOLE,
      light: PAWN_RINGS,
    });
  }
  // A pawn no taller than a hand at the white king's foot
  const king = GARDEN.findIndex((g) => g.square === 'e1');
  const [kx, , kz] = GARDEN[king].at;
  const tiny = 0.8;
  const pawnAt: V3 = [kx + 2.9, GROUND_Y, kz - 1.4];
  const pawn = sculptureOf(PieceType.Pawn);
  for (const o of pawn.outlines) {
    curves.push({
      at: pawnAt,
      points: o.points.map(([x, y]): V3 => [x * tiny, y * tiny, 0]),
      closed: o.closed,
      sculpt: king,
      light: 0.75,
    });
  }
  curves.push({
    at: pawnAt,
    points: ringPoints(pawn.rings[0].radius * tiny, pawn.rings[0].y * tiny, 16),
    closed: true,
    mode: 1,
    sculpt: king,
    light: 0.75,
  });
  return curves;
};

/** The same detail drawn clean: every stroke whole (see the top of this file). */
export const detailStrokes = (level: 'off' | 'inner' | 'full'): NeonStroke[] => {
  if (level === 'off') return [];
  const strokes: NeonStroke[] = [];
  GARDEN.forEach((place, sculpt) => {
    const { type, at } = place;
    for (const ring of moreRingsOf(type, true)) {
      strokes.push({
        at,
        points: ringPoints(ring.radius * SCALE, ring.y * SCALE, 36),
        closed: true,
        mode: 1,
        sculpt,
        light: RINGS * RING_LIGHT,
      });
    }
    if (level !== 'full') return;
    // Its footprint: a square round its foot
    const h = PROFILES.radius[type] * SCALE + 1.0;
    const y = 0.02;
    strokes.push({
      at,
      points: [
        [-h, y, -h],
        [h, y, -h],
        [h, y, h],
        [-h, y, h],
      ],
      closed: true,
      mode: 1,
      sculpt,
      light: FOOTPRINT,
    });
    // The knights' eyes: the one on a5 winks at its twin
    if (type === PieceType.Knight) {
      const facing = facingOf(place);
      for (const eye of knightEyes(place.square === 'a5')) {
        strokes.push({
          at,
          points: eye.points.map((p) => toWorld(facing, p, SCALE)),
          normals: eye.normals.map((n) => toWorld(facing, n)),
          closed: eye.closed,
          mode: 1,
          sculpt,
          light: 0.8,
        });
      }
    }
  });
  if (level !== 'full') return strokes;
  // The pawns' rings, left on their squares
  for (const square of PAWN_SQUARES) {
    const [x, z] = squareCentre(square);
    strokes.push({
      at: [x, GROUND_Y, z],
      points: ringPoints(PROFILES.radius[PieceType.Pawn] * SCALE, 0.002 * SCALE, 36),
      closed: true,
      mode: 1,
      sculpt: ALWAYS_WHOLE,
      light: PAWN_RINGS * RING_LIGHT,
    });
  }
  // A pawn no taller than a hand at the white king's foot
  const king = GARDEN.findIndex((g) => g.square === 'e1');
  const [kx, , kz] = GARDEN[king].at;
  const tiny = 0.8;
  const pawnAt: V3 = [kx + 2.9, GROUND_Y, kz - 1.4];
  const pawn = sculptureOf(PieceType.Pawn);
  for (const o of pawn.outlines) {
    strokes.push({
      at: pawnAt,
      points: o.points.map(([x, y]): V3 => [x * tiny, y * tiny, 0]),
      closed: o.closed,
      sculpt: king,
      light: 0.75,
    });
  }
  strokes.push({
    at: pawnAt,
    points: ringPoints(pawn.rings[0].radius * tiny, pawn.rings[0].y * tiny, 24),
    closed: true,
    mode: 1,
    sculpt: king,
    light: 0.75 * RING_LIGHT,
  });
  return strokes;
};

export const BoardDetail = ({ turn }: GardenDetailProps) => {
  const level = useEnvSetting(sculptureDetail);
  const fallen = useEnvSetting(fallenPieces) === 'on';
  // ENV PREVIEW (temporary): clean strokes, or today's ribbons
  const clean = useEnvSetting(sculptureLines) === 'clean';
  const parts = useMemo(() => {
    if (clean) {
      const strokes = [
        ...detailStrokes(level),
        ...(fallen ? fallenStrokes(SCALE, GROUND_Y, FALLEN_SLOT) : []),
      ];
      return strokes.length ? { geometry: neonStrokes(strokes), ...gardenNeon(true) } : null;
    }
    const curves = [
      ...detailCurves(level),
      ...(fallen ? fallenCurves(SCALE, GROUND_Y, FALLEN_SLOT) : []),
    ];
    return curves.length ? { geometry: neonCurves(curves), ...gardenNeon() } : null;
  }, [level, fallen, clean]);
  const knight = useMemo(
    () => (clean && fallen ? fallenKnightLines(SCALE, GROUND_Y, FALLEN_SLOT) : null),
    [clean, fallen],
  );
  const knightGeometry = useKnightTubes(knight, turn);
  if (!parts) return null;
  return <Tubes parts={parts} knight={knightGeometry} />;
};

type TubeParts = { geometry: BufferGeometry } & ReturnType<typeof gardenNeon>;

const Tubes = ({ parts, knight }: { parts: TubeParts; knight: BufferGeometry | null }) => {
  useDisposeOnUnmount(parts);
  const { geometry, tubes, reflection } = parts;
  return (
    <group name="garden-detail">
      <GardenTubes geometry={geometry} materials={{ tubes, reflection }} order={1} />
      {knight && <GardenTubes geometry={knight} materials={{ tubes, reflection }} order={1} />}
    </group>
  );
};
