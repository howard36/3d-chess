import {
  PieceType,
  ROOK_VECTORS,
  BISHOP_VECTORS,
  UNICORN_VECTORS,
  QUEEN_VECTORS,
  KING_VECTORS,
  KNIGHT_VECTORS,
} from './pieces';

describe('PieceType enum', () => {
  it('should include all 7 types', () => {
    expect(Object.values(PieceType).sort()).toEqual(
      ['Bishop', 'King', 'Knight', 'Pawn', 'Queen', 'Rook', 'Unicorn'].sort(),
    );
  });
});

describe('Movement vectors', () => {
  it('rook vectors are exactly the six unit axis vectors', () => {
    const expected = new Set(['1,0,0', '-1,0,0', '0,1,0', '0,-1,0', '0,0,1', '0,0,-1']);
    expect(new Set(ROOK_VECTORS.map((v) => v.join()))).toEqual(expected);
    expect(ROOK_VECTORS).toHaveLength(6); // no duplicates
  });
  it('has the number of directions each slider and the king moves in', () => {
    expect(BISHOP_VECTORS).toHaveLength(12);
    expect(UNICORN_VECTORS).toHaveLength(8);
    expect(QUEEN_VECTORS).toHaveLength(26);
    expect(KING_VECTORS).toHaveLength(26);
  });
  it('knight vectors are exactly the 24 signed permutations of (2, 1, 0)', () => {
    // 3! orderings of the magnitudes x 2 signs for each of the two non-zero
    // components = 6 x 4 = 24 distinct vectors.
    const expected = new Set<string>();
    for (const [a, b, c] of [
      [2, 1, 0],
      [2, 0, 1],
      [1, 2, 0],
      [1, 0, 2],
      [0, 2, 1],
      [0, 1, 2],
    ]) {
      for (const sa of [-1, 1]) {
        for (const sb of [-1, 1]) {
          for (const sc of [-1, 1]) {
            // Negating a zero component is a no-op, so the Set collapses those.
            expected.add([a * sa, b * sb, c * sc].join());
          }
        }
      }
    }
    expect(expected.size).toBe(24);

    const actual = KNIGHT_VECTORS.map((v) => v.join());
    expect(new Set(actual).size).toBe(24); // no duplicates
    expect(new Set(actual)).toEqual(expected);
    for (const v of KNIGHT_VECTORS) {
      expect(v.map(Math.abs).sort()).toEqual([0, 1, 2]);
    }
  });
});
