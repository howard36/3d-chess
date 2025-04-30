import React from 'react';
import type { JSX } from 'react';
import { PieceType } from '../engine';

export type PieceMeshProps = JSX.IntrinsicElements['mesh'] & {
  type: PieceType;
  color: 'white' | 'black';
};

const pieceColor = (color: 'white' | 'black') => (color === 'white' ? 0xffffff : 0x222222);

export const PieceMesh: React.FC<PieceMeshProps> = ({ type, color, ...props }) => {
  // Each piece gets a different primitive mesh
  switch (type) {
    case PieceType.Pawn:
      return (
        <mesh {...props}>
          <cylinderGeometry args={[0.25, 0.25, 0.6, 16]} />
          <meshStandardMaterial color={pieceColor(color)} />
        </mesh>
      );
    case PieceType.Rook:
      return (
        <mesh {...props}>
          <cylinderGeometry args={[0.3, 0.3, 0.7, 8]} />
          <meshStandardMaterial color={pieceColor(color)} />
        </mesh>
      );
    case PieceType.Bishop:
      return (
        <mesh {...props}>
          <coneGeometry args={[0.28, 0.8, 12]} />
          <meshStandardMaterial color={pieceColor(color)} />
        </mesh>
      );
    case PieceType.Knight:
      return (
        <mesh {...props}>
          <cylinderGeometry args={[0.2, 0.2, 0.5, 6]} />
          <meshStandardMaterial color={pieceColor(color)} />
        </mesh>
      );
    case PieceType.Unicorn:
      return (
        <mesh {...props}>
          <coneGeometry args={[0.18, 0.7, 6]} />
          <meshStandardMaterial color={pieceColor(color)} />
        </mesh>
      );
    case PieceType.Queen:
      return (
        <mesh {...props}>
          <cylinderGeometry args={[0.22, 0.32, 0.9, 16]} />
          <meshStandardMaterial color={pieceColor(color)} />
        </mesh>
      );
    case PieceType.King:
      return (
        <mesh {...props}>
          <cylinderGeometry args={[0.25, 0.35, 1.0, 16]} />
          <meshStandardMaterial color={pieceColor(color)} />
        </mesh>
      );
    default:
      return null;
  }
};
