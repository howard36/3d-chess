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
  it('knight vectors are non-empty and length 24', () => {
    expect(KNIGHT_VECTORS.length).toBe(24);
  });
});
