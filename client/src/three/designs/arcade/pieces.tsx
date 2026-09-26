import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BackSide, Color, CylinderGeometry, MeshBasicMaterial } from 'three';
import type { Group } from 'three';
import { PieceType } from '../../../engine/pieces';
import { noRaycast } from '../kit/noRaycast';
import type { PieceBodyProps, PieceColor } from '../types';
import { bodyGeometry, heightOf, outlineGeometry } from './voxels';

// A voxel piece: its coloured model inside a dark shell, the pixel-art
// outline that keeps it readable against the lattice and the stars.

export type Glow = 'none' | 'hover' | 'selected' | 'check';
// Unlit: the voxels carry their own shading. A glow tints them, and can
// push them brighter than their paint (the colour is not clamped at 1).
const GLOW: Record<Glow, [number, number, number]> = {
  none: [1, 1, 1],
  hover: [1.2, 1.2, 1.2],
  selected: [1.45, 1.4, 1.05],
  check: [2.2, 0.4, 0.45],
};

const materials = new Map<Glow, MeshBasicMaterial>();
/** Voxel paint; the colours and shading live in the geometry. */
export const voxelMaterial = (glow: Glow) => {
  let m = materials.get(glow);
  if (!m) {
    m = new MeshBasicMaterial({
      vertexColors: true,
      color: new Color(...GLOW[glow]),
      toneMapped: false,
    });
    materials.set(glow, m);
  }
  return m;
};

const CHECK_DIM: [number, number, number] = [1.5, 0.6, 0.65];
/** Tints the check paint, for a flashing king. */
export const setCheckFlash = (on: boolean) => {
  const [r, g, b] = on ? GLOW.check : CHECK_DIM;
  voxelMaterial('check').color.setRGB(r, g, b);
};

export const outlineMaterial = new MeshBasicMaterial({ color: '#0a0314', side: BackSide });

// What a click on a piece hits: an unseen post a little slimmer than the
// voxels. The wide square bases and crenellations would otherwise stand in
// front of the pieces behind them in the lattice and swallow their clicks.
const pickMaterial = new MeshBasicMaterial();
const pickGeometries = new Map<PieceType, CylinderGeometry>();
const pickGeometry = (type: PieceType) => {
  let g = pickGeometries.get(type);
  if (!g) {
    const h = heightOf(type);
    g = new CylinderGeometry(0.19, 0.25, h, 10).translate(0, h / 2, 0);
    pickGeometries.set(type, g);
  }
  return g;
};

export const VoxelPiece = ({
  type,
  color,
  glow = 'none',
}: {
  type: PieceType;
  color: PieceColor;
  glow?: Glow;
}) => {
  // Sprites face each other, as in a side-view game: Black's horses look left.
  const turned = color === 'black' && (type === PieceType.Knight || type === PieceType.Unicorn);
  return (
    <group rotation={[0, turned ? Math.PI : 0, 0]}>
      <mesh
        geometry={bodyGeometry(type, color)}
        material={voxelMaterial(glow)}
        raycast={noRaycast}
      />
      <mesh geometry={outlineGeometry(type)} material={outlineMaterial} raycast={noRaycast} />
    </group>
  );
};

/**
 * The board's piece. Picked up, it hops on the spot in two-frame steps, the
 * idle animation of an 8-bit sprite; under the pointer it rises one step.
 */
export const PieceBody = ({ type, color, selected, hovered, inCheck }: PieceBodyProps) => {
  const group = useRef<Group>(null);
  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const beat = Math.floor(state.clock.elapsedTime * 5) % 2;
    g.position.y = selected ? 0.1 + beat * 0.07 : hovered ? 0.05 : 0;
  });
  const glow: Glow = inCheck ? 'check' : selected ? 'selected' : hovered ? 'hover' : 'none';
  return (
    <group ref={group}>
      <VoxelPiece type={type} color={color} glow={glow} />
      <mesh geometry={pickGeometry(type)} material={pickMaterial} visible={false} />
    </group>
  );
};
