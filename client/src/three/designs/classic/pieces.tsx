import React from 'react';
import { Color } from 'three';
import type { Material } from 'three';
import type { ThreeElements } from '@react-three/fiber';
import { PieceType } from '../../../engine';
import { theme } from '../../theme';
import { STAUNTON } from '../../pieceGeometry';
import type { StauntonGeometries } from '../../pieceGeometry';
import type { PieceBodyProps, PieceColor } from '../types';

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

/** A material to paint a part with: a JSX material (one instance per mesh) or a shared object. */
export type PartMaterial = React.ReactElement | Material;

type PartProps = Omit<ThreeElements['mesh'], 'material' | 'children'> & { mat: PartMaterial };

const isMaterial = (m: PartMaterial): m is Material => (m as Material).isMaterial === true;

/** One mesh of a piece, painted with either kind of material. */
export const Part = ({ mat, ...props }: PartProps) =>
  isMaterial(mat) ? <mesh {...props} material={mat} /> : <mesh {...props}>{mat}</mesh>;

/**
 * The Staunton set's meshes for one piece, every part in `material` except
 * the bishop's mitre groove, which is drawn in `groove`. Designs that only
 * restyle the classic silhouettes pass their own materials.
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

export const ClassicPieceBody = ({ type, color, emissive }: PieceBodyProps) => (
  <StauntonParts
    type={type}
    material={<PieceMaterial color={color} emissive={emissive} />}
    groove={<meshStandardMaterial color={darken(color)} roughness={0.6} metalness={0.08} />}
  />
);
