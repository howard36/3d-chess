import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { BufferGeometry } from 'three';
import { PieceType } from '../../engine/pieces';
import { wholePiece } from '../scene/occlusion';
import { PIECE_PARTS } from './parts';
import { loadBakedKnight, pieceSet } from './set';
import type { PieceQuality } from './set';

// The set's geometry, byte for byte. Building it faster must not move a
// vertex: these are hashes of every attribute and index of every part, as
// built (and, for the medium set the game draws, as drawn, with its
// occlusion baked in). The same hashes are what client/bench/pieces.ts
// prints. A deliberate change to a piece's shape updates them. The medium
// set's knight comes from knight.medium.ts here and the low set's is
// sculpted, so both ways of getting a knight are pinned.

const hashInto = (h: ReturnType<typeof createHash>, key: string, g: BufferGeometry) => {
  for (const name of Object.keys(g.attributes).sort()) {
    const a = g.attributes[name].array as Float32Array;
    h.update(`${key}/${name}`);
    h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  }
  if (g.index) h.update(Buffer.from(Uint32Array.from(g.index.array).buffer));
};

const setHash = (quality: PieceQuality) => {
  const h = createHash('sha256');
  const set = pieceSet(quality);
  for (const type of Object.values(PieceType)) {
    for (const part of PIECE_PARTS) {
      const g = set[type][part];
      if (g) hashInto(h, `${type}/${part}`, g);
    }
  }
  return h.digest('hex').slice(0, 16);
};

describe('the piece set, byte for byte', () => {
  it('medium, as built (its knight from the precomputed meshes)', async () => {
    await loadBakedKnight();
    expect(setHash('medium')).toBe('77ffc3796d9dd007');
  });

  it('medium, as drawn (occlusion and parts baked in)', () => {
    const h = createHash('sha256');
    for (const type of Object.values(PieceType)) hashInto(h, type, wholePiece(type));
    expect(h.digest('hex').slice(0, 16)).toBe('196a80b3120abc54');
  });

  it('low, as built', () => {
    expect(setHash('low')).toBe('0d47e3184007076a');
  });
});
