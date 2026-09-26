import React from 'react';
import type { JSX } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { PieceType } from '../engine';
import { useDesign } from './designs/context';
import { Lift, Topple } from './designs/kit/motion';

export type PieceMeshProps = JSX.IntrinsicElements['group'] & {
  type: PieceType;
  color: 'white' | 'black';
  emissive?: string | number;
  position?: [number, number, number];
  onClick?: (event: ThreeEvent<MouseEvent>) => void;
  selected?: boolean;
  hovered?: boolean;
  inCheck?: boolean;
  /** This king has been checkmated. */
  mated?: boolean;
  /** Yaw for a knight's head, when the board decides which way it faces. */
  facing?: number;
};

const PIECE_TYPES = new Set<string>(Object.values(PieceType));

// Memoized: a piece is up to 13 meshes, and the board re-renders on every
// selection change and incoming message. Board passes referentially stable
// position arrays and handlers so the shallow comparison actually skips.
export const PieceMesh: React.FC<PieceMeshProps> = React.memo(function PieceMesh({
  type,
  color,
  emissive,
  position,
  onClick,
  selected = false,
  hovered = false,
  inCheck = false,
  mated = false,
  facing,
  ...rest
}) {
  const design = useDesign();
  if (!PIECE_TYPES.has(type)) return null;
  const Body = design.PieceBody;

  // Armies are separated along scene y (ranks point up the screen), so the
  // knight's profile should face the default camera; a slight opposing turn
  // per color keeps the two armies from looking like mirror stamps. Rotation
  // lives on the inner group so the outer group only carries the
  // position/userData/handler contract.
  const yaw = design.knightYaw ?? 0.35;
  const rotation: [number, number, number] =
    type === PieceType.Knight ? [0, facing ?? (color === 'white' ? -yaw : yaw), 0] : [0, 0, 0];

  let body = (
    <Body
      type={type}
      color={color}
      emissive={emissive ?? 0x000000}
      selected={selected}
      hovered={hovered}
      inCheck={inCheck}
    />
  );
  // Picked up, a piece floats off its floor; under the pointer, it stirs.
  if (design.hoverLift) body = <Lift height={selected ? 0.2 : hovered ? 0.08 : 0}>{body}</Lift>;
  if (design.toppleMatedKing) body = <Topple active={mated}>{body}</Topple>;

  return (
    <group
      position={position}
      onClick={onClick}
      userData={{ piece: { type, color }, emissive }}
      {...rest}
    >
      {/* Pieces are modeled base-at-y=0; seat them on the cell floor */}
      <group position={[0, design.layout.floorY, 0]} rotation={rotation}>
        {body}
      </group>
    </group>
  );
});
