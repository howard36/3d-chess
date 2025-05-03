import React from 'react';
import type { JSX } from 'react';
import { PieceType } from '../engine';
import { SphereGeometry, CylinderGeometry } from 'three';

export type PieceMeshProps = JSX.IntrinsicElements['mesh'] & {
  type: PieceType;
  color: 'white' | 'black';
  emissive?: string | number;
  position?: [number, number, number];
  onPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
};

const pieceColor = (color: 'white' | 'black') => (color === 'white' ? 0xffffff : 0x222222);

// Pre-compute geometries to avoid re-creation on re-render
const pawnBaseGeometry = new CylinderGeometry(0.25, 0.25, 0.1, 16);
const pawnShaftGeometry = new CylinderGeometry(0.15, 0.15, 0.3, 16);
const pawnHeadGeometry = new SphereGeometry(0.2, 16, 16);

export const PieceMesh: React.FC<PieceMeshProps> = ({
  type,
  color,
  emissive,
  position,
  onPointerDown,
  ...rest
}) => {
  // Each piece gets a different primitive mesh
  switch (type) {
    case PieceType.Pawn:
      return (
        <group
          position={position}
          onPointerDown={onPointerDown}
          userData={{ piece: { type, color }, emissive }}
        >
          {/* Base */}
          <mesh position={[0, -0.2, 0]} geometry={pawnBaseGeometry}>
            <meshStandardMaterial color={pieceColor(color)} emissive={emissive} />
          </mesh>
          {/* Shaft */}
          <mesh position={[0, 0, 0]} geometry={pawnShaftGeometry}>
            <meshStandardMaterial color={pieceColor(color)} emissive={emissive} />
          </mesh>
          {/* Head */}
          <mesh position={[0, 0.15, 0]} geometry={pawnHeadGeometry}>
            <meshStandardMaterial color={pieceColor(color)} emissive={emissive} />
          </mesh>
        </group>
      );
    case PieceType.Rook:
      // Castle-like rook: main body, top band, and 4 battlements
      return (
        <group
          position={position}
          onPointerDown={onPointerDown}
          userData={{ piece: { type, color }, emissive }}
        >
          {/* Main body */}
          <mesh position={[0, 0.0, 0]}>
            <cylinderGeometry args={[0.22, 0.28, 0.7, 12]} />
            <meshStandardMaterial color={pieceColor(color)} />
          </mesh>
          {/* Top band */}
          <mesh position={[0, 0.38, 0]}>
            <cylinderGeometry args={[0.28, 0.3, 0.08, 12]} />
            <meshStandardMaterial color={pieceColor(color)} />
          </mesh>
          {/* Four battlements */}
          {[0, 1, 2, 3].map((i) => {
            const angle = (i * Math.PI) / 2;
            const r = 0.26;
            return (
              <mesh key={i} position={[Math.cos(angle) * r, 0.46, Math.sin(angle) * r]}>
                <boxGeometry args={[0.09, 0.12, 0.09]} />
                <meshStandardMaterial color={pieceColor(color)} />
              </mesh>
            );
          })}
        </group>
      );
    case PieceType.Bishop:
      return (
        <mesh
          position={position}
          onPointerDown={onPointerDown}
          userData={{ piece: { type, color }, emissive }}
          {...rest}
        >
          <coneGeometry args={[0.38, 0.8, 12]} />
          <meshStandardMaterial color={pieceColor(color)} />
        </mesh>
      );
    case PieceType.Knight:
      return (
        <mesh
          position={position}
          onPointerDown={onPointerDown}
          userData={{ piece: { type, color }, emissive }}
          {...rest}
        >
          <cylinderGeometry args={[0.2, 0.2, 0.5, 6]} />
          <meshStandardMaterial color={pieceColor(color)} />
        </mesh>
      );
    case PieceType.Unicorn:
      return (
        <mesh
          position={position}
          onPointerDown={onPointerDown}
          userData={{ piece: { type, color }, emissive }}
          {...rest}
        >
          <coneGeometry args={[0.18, 1.2, 6]} />
          <meshStandardMaterial color={pieceColor(color)} />
        </mesh>
      );
    case PieceType.Queen:
      return (
        <mesh
          position={position}
          onPointerDown={onPointerDown}
          userData={{ piece: { type, color }, emissive }}
          {...rest}
        >
          <cylinderGeometry args={[0.22, 0.32, 0.9, 16]} />
          <meshStandardMaterial color={pieceColor(color)} />
        </mesh>
      );
    case PieceType.King:
      return (
        <group
          position={position}
          onPointerDown={onPointerDown}
          userData={{ piece: { type, color }, emissive }}
        >
          {/* Main body */}
          <mesh position={[0, 0, 0]} {...rest}>
            <cylinderGeometry args={[0.25, 0.35, 0.7, 16]} />
            <meshStandardMaterial color={pieceColor(color)} emissive={emissive} />
          </mesh>
          {/* Cross vertical bar */}
          <mesh position={[0, 0.55, 0]}>
            <boxGeometry args={[0.2, 0.4, 0.2]} />
            <meshStandardMaterial color={pieceColor(color)} emissive={emissive} />
          </mesh>
          {/* Cross horizontal bar */}
          <mesh position={[0, 0.6, 0]}>
            <boxGeometry args={[0.4, 0.08, 0.2]} />
            <meshStandardMaterial color={pieceColor(color)} emissive={emissive} />
          </mesh>
        </group>
      );
    default:
      return null;
  }
};
