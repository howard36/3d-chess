import { PieceType } from '../../engine/pieces';
import { fromStoredText, toStoredText } from '../pieces/bytes';

// The medium set's baked occlusion (every vertex's uv.x, scene/occlusion.ts)
// as bytes, so the game can ship it precomputed (occlusion.medium.ts,
// written by `npm run bake:pieces`) rather than voxelize every piece and cast
// eighty rays from every vertex in the browser. The values are stored bit
// for bit: decoding gives back exactly what the bake works out.

/** Per piece type, each present part's vertex count (PIECE_PARTS order); then the bytes. */
export interface OcclusionData {
  counts: Record<PieceType, number[]>;
  base64: string;
}

const TYPES = Object.values(PieceType);

export const encodeOcclusion = (occlusion: Record<PieceType, Float32Array[]>): OcclusionData => {
  const counts = {} as Record<PieceType, number[]>;
  const all = TYPES.flatMap((type) => occlusion[type]);
  const bytes = new Uint8Array(all.reduce((n, ao) => n + ao.byteLength, 0));
  let at = 0;
  for (const type of TYPES) counts[type] = occlusion[type].map((ao) => ao.length);
  for (const ao of all) {
    bytes.set(new Uint8Array(ao.buffer, ao.byteOffset, ao.byteLength), at);
    at += ao.byteLength;
  }
  return { counts, base64: toStoredText(bytes) };
};

/** Each type's parts' occlusion, decoded (each part's values in a buffer of its own). */
export const decodeOcclusion = ({
  counts,
  base64,
}: OcclusionData): Record<PieceType, Float32Array[]> => {
  const bytes = fromStoredText(base64);
  const out = {} as Record<PieceType, Float32Array[]>;
  let at = 0;
  for (const type of TYPES) {
    out[type] = counts[type].map((n) => {
      const ao = new Float32Array(bytes.buffer.slice(at, at + n * 4));
      at += n * 4;
      return ao;
    });
  }
  return out;
};
