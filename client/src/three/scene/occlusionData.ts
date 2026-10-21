import { PieceType } from '../../engine/pieces';
import { fromStoredText, toStoredText } from '../pieces/bytes';

// The medium set's baked occlusion (every vertex's uv.x, scene/occlusion.ts)
// as bytes, so the game can ship it precomputed (occlusion.medium.ts,
// written by `npm run bake:pieces`) rather than voxelize every piece and cast
// eighty rays from every vertex in the browser. The values are stored bit
// for bit: decoding gives back exactly what the bake works out.

/** Per piece type, each present part's vertex count (PIECE_PARTS order); then the bytes. */
export interface OcclusionData {
  counts: Partial<Record<PieceType, number[]>>;
  base64: string;
}

const TYPES = Object.values(PieceType);

/** The types' occlusion as one OcclusionData (every type's, unless `types` names some). */
export const encodeOcclusion = (
  occlusion: Partial<Record<PieceType, Float32Array[]>>,
  types: PieceType[] = TYPES,
): OcclusionData => {
  const counts: OcclusionData['counts'] = {};
  const all = types.flatMap((type) => occlusion[type]!);
  const bytes = new Uint8Array(all.reduce((n, ao) => n + ao.byteLength, 0));
  let at = 0;
  for (const type of types) counts[type] = occlusion[type]!.map((ao) => ao.length);
  for (const ao of all) {
    bytes.set(new Uint8Array(ao.buffer, ao.byteOffset, ao.byteLength), at);
    at += ao.byteLength;
  }
  return { counts, base64: toStoredText(bytes) };
};

/** Each stored type's parts' occlusion, decoded (each part's values in a buffer of its own). */
export const decodeOcclusion = ({
  counts,
  base64,
}: OcclusionData): Partial<Record<PieceType, Float32Array[]>> => {
  const bytes = fromStoredText(base64);
  const out: Partial<Record<PieceType, Float32Array[]>> = {};
  let at = 0;
  for (const type of TYPES) {
    if (!counts[type]) continue;
    out[type] = counts[type].map((n) => {
      const ao = new Float32Array(bytes.buffer.slice(at, at + n * 4));
      at += n * 4;
      return ao;
    });
  }
  return out;
};
