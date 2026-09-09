import {
  PieceType,
  ROOK_VECTORS,
  BISHOP_VECTORS,
  UNICORN_VECTORS,
  QUEEN_VECTORS,
  KING_VECTORS,
  KNIGHT_VECTORS,
  PIECE_TO_PROMOTION,
  PROMOTION_TO_PIECE,
} from './pieces';
import type { Promotion } from '../types/messages';

describe('PieceType enum', () => {
  it('should include all 7 types', () => {
    expect(Object.values(PieceType).sort()).toEqual(
      ['Bishop', 'King', 'Knight', 'Pawn', 'Queen', 'Rook', 'Unicorn'].sort(),
    );
  });
});

describe('Movement vectors', () => {
  it('rook vectors are non-empty and length 6', () => {
    expect(ROOK_VECTORS.length).toBe(6);
  });
  it('bishop vectors are non-empty and length 12', () => {
    expect(BISHOP_VECTORS.length).toBe(12);
  });
  it('unicorn vectors are non-empty and length 8', () => {
    expect(UNICORN_VECTORS.length).toBe(8);
  });
  it('queen vectors are non-empty and length 26', () => {
    expect(QUEEN_VECTORS.length).toBe(26);
  });
  it('king vectors are non-empty and length 26', () => {
    expect(KING_VECTORS.length).toBe(26);
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

describe('Promotion wire-format mapping', () => {
  it('maps each promotable piece to its schema letter (Knight is N, not K)', () => {
    expect(PIECE_TO_PROMOTION[PieceType.Queen]).toBe('Q');
    expect(PIECE_TO_PROMOTION[PieceType.Rook]).toBe('R');
    expect(PIECE_TO_PROMOTION[PieceType.Bishop]).toBe('B');
    expect(PIECE_TO_PROMOTION[PieceType.Knight]).toBe('N');
    expect(PIECE_TO_PROMOTION[PieceType.Unicorn]).toBe('U');
    expect(PIECE_TO_PROMOTION[PieceType.King]).toBeUndefined();
    expect(PIECE_TO_PROMOTION[PieceType.Pawn]).toBeUndefined();
  });

  it('round-trips every promotion letter', () => {
    const letters: Promotion[] = ['Q', 'R', 'B', 'N', 'U'];
    for (const letter of letters) {
      expect(PIECE_TO_PROMOTION[PROMOTION_TO_PIECE[letter]]).toBe(letter);
    }
  });
});
