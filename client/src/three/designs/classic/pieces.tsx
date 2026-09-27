import React from 'react';
import { Color } from 'three';
import { PieceType } from '../../../engine';
import { theme } from '../../theme';
import { STAUNTON } from '../../pieceGeometry';
import type { StauntonGeometries } from '../../pieceGeometry';
import { ChessPiece, Part, preloadPieceSet } from '../../pieces';
import type { PartMaterial } from '../../pieces';
import type { PieceBodyProps, PieceColor } from '../types';

// Part and PartMaterial moved to the shared piece set (three/pieces); they
// are re-exported here for the designs that import them from Classic.
export { Part };
export type { PartMaterial };

// Classic is the default design, bundled with the app: build the shared set
// while the browser is idle (on the start screen), before the first board.
preloadPieceSet();

// The scene has no env map; black is slightly glossier so it still catches
// the directional lights instead of reading as a silhouette. Near-dielectric
// metalness — higher values go muddy without environment reflections.
const PieceMaterial: React.FC<{ color: PieceColor; emissive?: string | number }> = ({
  color,
  emissive,
}) => (
  <meshStandardMaterial
    color={color === 'white' ? theme.whitePiece : theme.blackPiece}
    roughness={color === 'white' ? 0.45 : 0.35}
    metalness={0.08}
    emissive={emissive ?? 0x000000}
  />
);

const darken = (color: PieceColor) =>
  new Color(color === 'white' ? theme.whitePiece : theme.blackPiece).multiplyScalar(0.55);

const CRENELLATION_ANGLES = [0, 1, 2, 3, 4].map((i) => (i * 2 * Math.PI) / 5);
const CORONET_ANGLES = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (i * 2 * Math.PI) / 8);

/**
 * The round-1 Staunton set's meshes for one piece (pieceGeometry.ts), kept
 * as it was for the designs built on it (new designs draw the shared set's
 * ChessPiece, three/pieces): every part in `material` except the bishop's
 * mitre groove, which is drawn in `groove`. Designs that only restyle these
 * silhouettes pass their own materials.
 */
export const StauntonParts = ({
  type,
  material: m,
  groove,
  geometries: g = STAUNTON,
  castShadow,
}: {
  type: PieceType;
  material: PartMaterial;
  groove: PartMaterial;
  /** A differently turned set (see buildStauntonGeometries). */
  geometries?: StauntonGeometries;
  /** Cast real-time shadows (for designs whose canvas enables them). */
  castShadow?: boolean;
}) => {
  switch (type) {
    case PieceType.Pawn:
      return (
        <>
          <Part castShadow={castShadow} geometry={g.pawnBody} mat={m} />
          <Part castShadow={castShadow} position={[0, 0.43, 0]} geometry={g.pawnHead} mat={m} />
        </>
      );
    case PieceType.Rook:
      return (
        <>
          <Part castShadow={castShadow} geometry={g.rookBody} mat={m} />
          {CRENELLATION_ANGLES.map((angle) => (
            <Part
              castShadow={castShadow}
              key={angle}
              position={[Math.cos(angle) * 0.17, 0.585, Math.sin(angle) * 0.17]}
              rotation={[0, -angle, 0]}
              geometry={g.rookCrenellation}
              mat={m}
            />
          ))}
        </>
      );
    case PieceType.Bishop:
      return (
        <>
          <Part castShadow={castShadow} geometry={g.bishopBody} mat={m} />
          {/* Diagonal mitre groove, faked with a dark inset band instead of CSG */}
          <Part
            castShadow={castShadow}
            position={[0, 0.575, 0]}
            rotation={[0, 0, -0.6]}
            geometry={g.bishopSlot}
            mat={groove}
          />
          <Part
            castShadow={castShadow}
            position={[0, 0.725, 0]}
            geometry={g.bishopFinial}
            mat={m}
          />
        </>
      );
    case PieceType.Knight:
      return (
        <>
          <Part castShadow={castShadow} geometry={g.knightBase} mat={m} />
          <Part castShadow={castShadow} geometry={g.knightHead} mat={m} />
        </>
      );
    case PieceType.Unicorn:
      return (
        <>
          <Part castShadow={castShadow} geometry={g.unicornBody} mat={m} />
          <Part castShadow={castShadow} position={[0, 0.67, 0]} geometry={g.unicornHorn} mat={m} />
          <Part castShadow={castShadow} geometry={g.unicornSpiral} mat={m} />
        </>
      );
    case PieceType.Queen:
      return (
        <>
          <Part castShadow={castShadow} geometry={g.queenBody} mat={m} />
          {CORONET_ANGLES.map((angle) => (
            <Part
              castShadow={castShadow}
              key={angle}
              position={[Math.cos(angle) * 0.15, 0.715, Math.sin(angle) * 0.15]}
              geometry={g.queenCoronet}
              mat={m}
            />
          ))}
          <Part castShadow={castShadow} position={[0, 0.79, 0]} geometry={g.queenFinial} mat={m} />
        </>
      );
    case PieceType.King:
      return (
        <>
          <Part castShadow={castShadow} geometry={g.kingBody} mat={m} />
          <Part
            castShadow={castShadow}
            position={[0, 0.8, 0]}
            geometry={g.kingCrossVertical}
            mat={m}
          />
          <Part
            castShadow={castShadow}
            position={[0, 0.815, 0]}
            geometry={g.kingCrossHorizontal}
            mat={m}
          />
        </>
      );
    default:
      return null;
  }
};

/**
 * Classic's pieces: the shared Staunton set (three/pieces) in ivory and
 * graphite. The details that name a piece (the bishop's cut, the knight's
 * eyes, the lines in the unicorn's twist, the queen's pearls, the king's
 * cross, the rook's crenels and hollow) are in a deeper shade of the army's
 * colour; the foot band is left in the army's colour.
 */
export const ClassicPieceBody = ({ type, color, emissive }: PieceBodyProps) => (
  <ChessPiece
    type={type}
    parts={{
      body: <PieceMaterial color={color} emissive={emissive} />,
      accent: <meshStandardMaterial color={darken(color)} roughness={0.55} metalness={0.08} />,
    }}
  />
);
