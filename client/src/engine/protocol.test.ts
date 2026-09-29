import { describe, it, expect } from 'vitest';
import { moveFromMessage, moveToMessage } from './protocol';
import { PieceType } from './pieces';

describe('moveFromMessage', () => {
  it('parses coordinates and no promotion', () => {
    expect(moveFromMessage({ by: 'white', from: 'Ba1', to: 'Ca1' })).toEqual({
      from: { x: 0, y: 0, z: 1 },
      to: { x: 0, y: 0, z: 2 },
      promotion: undefined,
    });
  });

  it('maps every promotion letter to the right piece type', () => {
    const cases: Array<['Q' | 'R' | 'B' | 'N' | 'U', PieceType]> = [
      ['Q', PieceType.Queen],
      ['R', PieceType.Rook],
      ['B', PieceType.Bishop],
      ['N', PieceType.Knight],
      ['U', PieceType.Unicorn],
    ];
    for (const [letter, pieceType] of cases) {
      const move = moveFromMessage({
        by: 'white',
        from: 'Da5',
        to: 'Ea5',
        promotion: letter,
      });
      expect(move.promotion).toBe(pieceType);
    }
  });
});

describe('moveToMessage', () => {
  it('serializes coordinates and omits promotion when absent', () => {
    expect(moveToMessage({ from: { x: 0, y: 0, z: 1 }, to: { x: 0, y: 0, z: 2 } })).toEqual({
      type: 'move',
      from: 'Ba1',
      to: 'Ca1',
      promotion: undefined,
    });
  });

  it('sends N for a knight promotion (not K)', () => {
    const msg = moveToMessage({
      from: { x: 0, y: 4, z: 3 },
      to: { x: 0, y: 4, z: 4 },
      promotion: PieceType.Knight,
    });
    expect(msg.promotion).toBe('N');
  });

  it('round-trips each promotion type through the wire format', () => {
    for (const pieceType of [
      PieceType.Queen,
      PieceType.Rook,
      PieceType.Bishop,
      PieceType.Knight,
      PieceType.Unicorn,
    ]) {
      const msg = moveToMessage({
        from: { x: 0, y: 4, z: 3 },
        to: { x: 0, y: 4, z: 4 },
        promotion: pieceType,
      });
      const back = moveFromMessage({
        by: 'white',
        from: msg.from,
        to: msg.to,
        promotion: msg.promotion,
      });
      expect(back.promotion).toBe(pieceType);
    }
  });

  it('throws for piece types that cannot be promotions', () => {
    expect(() =>
      moveToMessage({
        from: { x: 0, y: 4, z: 3 },
        to: { x: 0, y: 4, z: 4 },
        promotion: PieceType.King,
      }),
    ).toThrow();
    expect(() =>
      moveToMessage({
        from: { x: 0, y: 4, z: 3 },
        to: { x: 0, y: 4, z: 4 },
        promotion: PieceType.Pawn,
      }),
    ).toThrow();
  });
});
