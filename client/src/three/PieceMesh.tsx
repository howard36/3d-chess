import React from 'react';
import type { JSX } from 'react';
import { PieceType } from '../engine';
import { SphereGeometry, CylinderGeometry } from 'three';

export type PieceMeshProps = JSX.IntrinsicElements['mesh'] & {
  type: PieceType;
  color: 'white' | 'black';
  emissive?: string | number;
};

const pieceColor = (color: 'white' | 'black') => (color === 'white' ? 0xffffff : 0x222222);

// Pre-compute geometries to avoid re-creation on re-render
const pawnBaseGeometry = new CylinderGeometry(0.25, 0.25, 0.1, 16);
const pawnShaftGeometry = new CylinderGeometry(0.15, 0.15, 0.3, 16);
const pawnHeadGeometry = new SphereGeometry(0.2, 16, 16);

export const PieceMesh: React.FC<PieceMeshProps> = ({ type, color, emissive, ...props }) => {
  // Each piece gets a different primitive mesh
  switch (type) {
    case PieceType.Pawn:
      return (
        // Use a group to combine multiple shapes for the pawn
        <group {...props} userData={{ piece: { type, color }, emissive }}>
          {/* Base */}
          <mesh position={[0, 0.05, 0]} geometry={pawnBaseGeometry}>
            <meshStandardMaterial color={pieceColor(color)} emissive={emissive} />
          </mesh>
          {/* Shaft */}
          <mesh position={[0, 0.25, 0]} geometry={pawnShaftGeometry}>
            <meshStandardMaterial color={pieceColor(color)} emissive={emissive} />
          </mesh>
          {/* Head */}
          <mesh position={[0, 0.4, 0]} geometry={pawnHeadGeometry}>
            <meshStandardMaterial color={pieceColor(color)} emissive={emissive} />
          </mesh>
        </group>
      );
    case PieceType.Rook:
      return (
        <mesh {...props} userData={{ piece: { type, color }, emissive }}>
          <cylinderGeometry args={[0.3, 0.3, 0.7, 8]} />
          <meshStandardMaterial color={pieceColor(color)} />
        </mesh>
      );
    case PieceType.Bishop:
      return (
        <mesh {...props} userData={{ piece: { type, color }, emissive }}>
          <coneGeometry args={[0.28, 0.8, 12]} />
          <meshStandardMaterial color={pieceColor(color)} />
        </mesh>
      );
    case PieceType.Knight:
      return (
        <mesh {...props} userData={{ piece: { type, color }, emissive }}>
          <cylinderGeometry args={[0.2, 0.2, 0.5, 6]} />
          <meshStandardMaterial color={pieceColor(color)} />
        </mesh>
      );
    case PieceType.Unicorn:
      return (
        <mesh {...props} userData={{ piece: { type, color }, emissive }}>
          <coneGeometry args={[0.18, 0.7, 6]} />
          <meshStandardMaterial color={pieceColor(color)} />
        </mesh>
      );
    case PieceType.Queen:
      return (
        <mesh {...props} userData={{ piece: { type, color }, emissive }}>
          <cylinderGeometry args={[0.22, 0.32, 0.9, 16]} />
          <meshStandardMaterial color={pieceColor(color)} />
        </mesh>
      );
    case PieceType.King:
      return (
        <mesh {...props} userData={{ piece: { type, color }, emissive }}>
          <cylinderGeometry args={[0.25, 0.35, 1.0, 16]} />
          <meshStandardMaterial color={pieceColor(color)} emissive={emissive} />
        </mesh>
      );
    default:
      return null;
  }
};
