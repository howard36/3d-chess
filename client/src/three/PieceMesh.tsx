import React from 'react';
import type { JSX } from 'react';
import { Color } from 'three';
import { PieceType } from '../engine';
import { theme } from './theme';
import {
  bishopBodyGeometry,
  bishopFinialGeometry,
  bishopSlotGeometry,
  kingBodyGeometry,
  kingCrossHorizontalGeometry,
  kingCrossVerticalGeometry,
  knightBaseGeometry,
  knightHeadGeometry,
  pawnBodyGeometry,
  pawnHeadGeometry,
  queenBodyGeometry,
  queenCoronetGeometry,
  queenFinialGeometry,
  rookBodyGeometry,
  rookCrenellationGeometry,
  unicornBodyGeometry,
  unicornHornGeometry,
  unicornSpiralGeometry,
} from './pieceGeometry';

export type PieceMeshProps = JSX.IntrinsicElements['group'] & {
  type: PieceType;
  color: 'white' | 'black';
  emissive?: string | number;
  position?: [number, number, number];
  onPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
};

type PieceColor = 'white' | 'black';

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

const pieceBody = (type: PieceType, color: PieceColor, emissive?: string | number) => {
  const material = <PieceMaterial color={color} emissive={emissive} />;
  switch (type) {
    case PieceType.Pawn:
      return (
        <>
          <mesh geometry={pawnBodyGeometry}>{material}</mesh>
          <mesh position={[0, 0.43, 0]} geometry={pawnHeadGeometry}>
            {material}
          </mesh>
        </>
      );
    case PieceType.Rook:
      return (
        <>
          <mesh geometry={rookBodyGeometry}>{material}</mesh>
          {CRENELLATION_ANGLES.map((angle) => (
            <mesh
              key={angle}
              position={[Math.cos(angle) * 0.17, 0.585, Math.sin(angle) * 0.17]}
              rotation={[0, -angle, 0]}
              geometry={rookCrenellationGeometry}
            >
              {material}
            </mesh>
          ))}
        </>
      );
    case PieceType.Bishop:
      return (
        <>
          <mesh geometry={bishopBodyGeometry}>{material}</mesh>
          {/* Diagonal mitre groove, faked with a dark inset band instead of CSG */}
          <mesh position={[0, 0.575, 0]} rotation={[0, 0, -0.6]} geometry={bishopSlotGeometry}>
            <meshStandardMaterial color={darken(color)} roughness={0.6} metalness={0.08} />
          </mesh>
          <mesh position={[0, 0.725, 0]} geometry={bishopFinialGeometry}>
            {material}
          </mesh>
        </>
      );
    case PieceType.Knight:
      return (
        <>
          <mesh geometry={knightBaseGeometry}>{material}</mesh>
          <mesh geometry={knightHeadGeometry}>{material}</mesh>
        </>
      );
    case PieceType.Unicorn:
      return (
        <>
          <mesh geometry={unicornBodyGeometry}>{material}</mesh>
          <mesh position={[0, 0.67, 0]} geometry={unicornHornGeometry}>
            {material}
          </mesh>
          <mesh geometry={unicornSpiralGeometry}>{material}</mesh>
        </>
      );
    case PieceType.Queen:
      return (
        <>
          <mesh geometry={queenBodyGeometry}>{material}</mesh>
          {CORONET_ANGLES.map((angle) => (
            <mesh
              key={angle}
              position={[Math.cos(angle) * 0.15, 0.715, Math.sin(angle) * 0.15]}
              geometry={queenCoronetGeometry}
            >
              {material}
            </mesh>
          ))}
          <mesh position={[0, 0.79, 0]} geometry={queenFinialGeometry}>
            {material}
          </mesh>
        </>
      );
    case PieceType.King:
      return (
        <>
          <mesh geometry={kingBodyGeometry}>{material}</mesh>
          <mesh position={[0, 0.8, 0]} geometry={kingCrossVerticalGeometry}>
            {material}
          </mesh>
          <mesh position={[0, 0.815, 0]} geometry={kingCrossHorizontalGeometry}>
            {material}
          </mesh>
        </>
      );
    default:
      return null;
  }
};

export const PieceMesh: React.FC<PieceMeshProps> = ({
  type,
  color,
  emissive,
  position,
  onPointerDown,
  ...rest
}) => {
  const body = pieceBody(type, color, emissive);
  if (body === null) return null;

  // Armies are separated along scene y (ranks point up the screen), so the
  // knight's profile should face the default camera; a slight opposing turn
  // per color keeps the two armies from looking like mirror stamps. Rotation
  // lives on the inner group so the outer group only carries the
  // position/userData/handler contract.
  const rotation: [number, number, number] =
    type === PieceType.Knight ? [0, color === 'white' ? -0.35 : 0.35, 0] : [0, 0, 0];

  return (
    <group
      position={position}
      onPointerDown={onPointerDown}
      userData={{ piece: { type, color }, emissive }}
      {...rest}
    >
      {/* Pieces are modeled base-at-y=0; seat them on the cell floor */}
      <group position={[0, -0.5, 0]} rotation={rotation}>
        {body}
      </group>
    </group>
  );
};
