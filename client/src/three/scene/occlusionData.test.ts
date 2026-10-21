/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { PieceType } from '../../engine/pieces';
import { pieceSet } from '../pieces';
import { occlusionOfPiece } from './occlusion';
import { OCCLUSION_KING } from './occlusion.king';
import { OCCLUSION_MEDIUM } from './occlusion.medium';
import { decodeOcclusion, encodeOcclusion } from './occlusionData';

describe('the precomputed medium occlusion', () => {
  const set = pieceSet();
  const fresh = {} as Record<PieceType, Float32Array[]>;
  for (const type of Object.values(PieceType)) fresh[type] = occlusionOfPiece(set[type]);

  const others = Object.values(PieceType).filter((t) => t !== PieceType.King);

  it('is what the bake works out now (else run `npm run bake:pieces`)', () => {
    expect(OCCLUSION_KING).toEqual(encodeOcclusion(fresh, [PieceType.King]));
    expect(OCCLUSION_MEDIUM).toEqual(encodeOcclusion(fresh, others));
  });

  it('holds the king apart from the rest', () => {
    expect(Object.keys(OCCLUSION_KING.counts)).toEqual([PieceType.King]);
    expect(Object.keys(OCCLUSION_MEDIUM.counts)).toEqual(others);
  });

  it('decodes to the baked values byte for byte', () => {
    const decoded = { ...decodeOcclusion(OCCLUSION_KING), ...decodeOcclusion(OCCLUSION_MEDIUM) };
    for (const type of Object.values(PieceType)) {
      expect(decoded[type]!.map((a) => Buffer.from(a.buffer).toString('hex'))).toEqual(
        fresh[type].map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('hex')),
      );
    }
  });
});
