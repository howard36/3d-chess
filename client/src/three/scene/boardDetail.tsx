import { useMemo } from 'react';
import type { BufferGeometry } from 'three';
import { PieceType } from '../../engine/pieces';
import { PROFILES } from '../pieces';
import { noRaycast } from '../noRaycast';
import type { GardenDetailProps } from './gardenDetail';
import { GROUND_Y } from './palette';
import { useDisposeOnUnmount } from './dispose';
import { ALWAYS_WHOLE, FALLEN_SLOT, GARDEN, gardenNeon, SCALE, squareCentre } from './stage';
import { innerOutlinesOf, knightEyeOf, moreRingsOf, sculptureOf } from './sculptures';
import { neonCurves, ringPoints } from './boardNeon';
import type { NeonCurve, V3 } from './boardNeon';
import { fallenCurves } from './boardFallen';
// ENV PREVIEW (temporary): the preview's settings
import { useEnvSetting } from '../../envPreview';
import { fallenPieces, sculptureDetail } from '../../envPreview/features/board';

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

export const BoardDetail = (props: GardenDetailProps) => {
  void props;
  const level = useEnvSetting(sculptureDetail);
  const fallen = useEnvSetting(fallenPieces) === 'on';
  const parts = useMemo(() => {
    const curves = [
      ...detailCurves(level),
      ...(fallen ? fallenCurves(SCALE, GROUND_Y, FALLEN_SLOT) : []),
    ];
    return curves.length ? { geometry: neonCurves(curves), ...gardenNeon() } : null;
  }, [level, fallen]);
  if (!parts) return null;
  return <Tubes parts={parts} />;
};

type TubeParts = { geometry: BufferGeometry } & ReturnType<typeof gardenNeon>;

const Tubes = ({ parts }: { parts: TubeParts }) => {
  useDisposeOnUnmount(parts);
  return (
    <group name="garden-detail">
      <mesh
        geometry={parts.geometry}
        material={parts.reflection}
        renderOrder={-879}
        frustumCulled={false}
        raycast={noRaycast}
      />
      <mesh
        geometry={parts.geometry}
        material={parts.tubes}
        renderOrder={-869}
        frustumCulled={false}
        raycast={noRaycast}
      />
    </group>
  );
};
