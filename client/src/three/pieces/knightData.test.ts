import { describe, expect, it } from 'vitest';
import { BufferGeometry } from 'three';
import { buildKnight } from './knight';
import { KNIGHT_MEDIUM } from './knight.medium';
import { decodeKnight, encodeKnight } from './knightData';
import { DETAIL } from './set';

const bytesOf = (g: BufferGeometry) => ({
  attributes: Object.fromEntries(
    Object.entries(g.attributes).map(([name, a]) => [
      name,
      {
        itemSize: a.itemSize,
        bytes: Buffer.from((a.array as Float32Array).buffer).toString('hex'),
      },
    ]),
  ),
  index: g.index && {
    type: g.index.array.constructor.name,
    bytes: Buffer.from((g.index.array as Uint16Array).buffer).toString('hex'),
  },
});

describe('the precomputed medium knight', () => {
  const fresh = buildKnight(DETAIL.medium.step, DETAIL.medium.knight);

  it('is what the sculpt builds now (else run `npm run bake:pieces`)', () => {
    expect(KNIGHT_MEDIUM).toEqual(encodeKnight(fresh));
  });

  it('decodes to the built meshes byte for byte', () => {
    const decoded = decodeKnight(KNIGHT_MEDIUM);
    for (const mesh of ['head', 'mane', 'eyes'] as const) {
      expect(bytesOf(decoded[mesh])).toEqual(bytesOf(fresh[mesh]));
    }
  });
});
