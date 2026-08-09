import React from 'react';
import type { JSX } from 'react';
import { PieceType } from '../engine';
import { SphereGeometry, CylinderGeometry } from 'three';
import { theme } from './theme';

export type PieceMeshProps = JSX.IntrinsicElements['mesh'] & {
  type: PieceType;
  color: 'white' | 'black';
  emissive?: string | number;
  position?: [number, number, number];
  onPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
};

// One material recipe for every part of every piece, so highlights (check,
// selection) behave the same regardless of piece type. Black pieces are
// slightly glossier so specular highlights define their silhouette against
// dark cells.
const materialProps = (color: 'white' | 'black', emissive?: string | number) => ({
  color: color === 'white' ? theme.whitePiece : theme.blackPiece,
  emissive: emissive ?? '#000000',
  roughness: color === 'white' ? 0.45 : 0.25,
  metalness: color === 'white' ? 0.15 : 0.35,
});

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
  const material = <meshStandardMaterial {...materialProps(color, emissive)} />;

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
            {material}
          </mesh>
          {/* Shaft */}
          <mesh position={[0, 0, 0]} geometry={pawnShaftGeometry}>
            {material}
          </mesh>
          {/* Head */}
          <mesh position={[0, 0.15, 0]} geometry={pawnHeadGeometry}>
            {material}
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
            {material}
          </mesh>
          {/* Top band */}
          <mesh position={[0, 0.38, 0]}>
            <cylinderGeometry args={[0.28, 0.3, 0.08, 12]} />
            {material}
          </mesh>
          {/* Four battlements */}
          {[0, 1, 2, 3].map((i) => {
            const angle = (i * Math.PI) / 2;
            const r = 0.26;
            return (
              <mesh key={i} position={[Math.cos(angle) * r, 0.46, Math.sin(angle) * r]}>
                <boxGeometry args={[0.09, 0.12, 0.09]} />
                {material}
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
          {material}
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
          {material}
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
          {material}
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
          {material}
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
            {material}
          </mesh>
          {/* Cross vertical bar */}
          <mesh position={[0, 0.55, 0]}>
            <boxGeometry args={[0.2, 0.4, 0.2]} />
            {material}
          </mesh>
          {/* Cross horizontal bar */}
          <mesh position={[0, 0.6, 0]}>
            <boxGeometry args={[0.4, 0.08, 0.2]} />
            {material}
          </mesh>
        </group>
      );
    default:
      return null;
  }
};
