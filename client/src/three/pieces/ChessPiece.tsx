import type React from 'react';
import type { Material } from 'three';
import type { ThreeElements } from '@react-three/fiber';
import type { PieceType } from '../../engine/pieces';
import { PIECE_PARTS, partsGeometry } from './parts';
import { pieceSet } from './set';
import type { PiecePart, PieceSet } from './set';

/** A material to paint a part with: a JSX material (one instance per mesh) or a shared object. */
export type PartMaterial = React.ReactElement | Material;

type PartProps = Omit<ThreeElements['mesh'], 'material' | 'children'> & { mat: PartMaterial };

const isMaterial = (m: PartMaterial): m is Material => (m as Material).isMaterial === true;

/** One mesh of a piece, painted with either kind of material. */
export const Part = ({ mat, ...props }: PartProps) =>
  isMaterial(mat) ? <mesh {...props} material={mat} /> : <mesh {...props}>{mat}</mesh>;

/**
 * Materials per part. Only `body` is required; a part without its own
 * material is painted like the body (and drawn in the same mesh).
 */
export type PartMaterials = { body: PartMaterial } & Partial<Record<PiecePart, PartMaterial>>;

export interface ChessPieceProps {
  type: PieceType;
  parts: PartMaterials;
  /** The geometry to draw: defaults to the shared medium-quality set (see pieceSet). */
  set?: PieceSet;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

/**
 * One piece of the shared Staunton set, base at y = 0, facing +x, with each
 * part in its material:
 *
 *   <ChessPiece type={type} parts={{ body: ivory, accent: walnut, foot: levelColour }} />
 *
 * Parts that share a material are drawn as one mesh (merged once per set),
 * so a piece is one to four draw calls. Materials may be shared objects (one
 * per army and state is the cheap way) or JSX elements; anything that fades
 * or recolours one piece must clone its materials first.
 */
export const ChessPiece = ({
  type,
  parts,
  set = pieceSet(),
  castShadow,
  receiveShadow,
}: ChessPieceProps) => {
  const groups: [PartMaterial, PiecePart[]][] = [];
  for (const part of PIECE_PARTS) {
    if (!set[type][part]) continue;
    const mat = parts[part] ?? parts.body;
    const group = groups.find(([m]) => m === mat);
    if (group) group[1].push(part);
    else groups.push([mat, [part]]);
  }
  return (
    <>
      {groups.map(([mat, names]) => (
        <Part
          key={names.join('+')}
          geometry={partsGeometry(set, type, names)!}
          mat={mat}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
        />
      ))}
    </>
  );
};
