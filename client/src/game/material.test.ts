import { describe, expect, it } from 'vitest';
import { Board } from '../engine';
import { PieceType } from '../engine/pieces';
import { fromZXY } from '../engine/coords';
import { materialBalance } from './material';

const play = (...moves: string[]) =>
  moves.reduce((board, m) => {
    const [from, to, promotion] = m.split(/[-=]/);
    return board.applyMove({
      from: fromZXY(from),
      to: fromZXY(to),
      promotion: promotion as PieceType | undefined,
    });
  }, Board.setupStartingPosition());

describe('materialBalance', () => {
  it('is empty and even at the start', () => {
    expect(materialBalance(Board.setupStartingPosition())).toEqual({
      lost: { white: [], black: [] },
      advantage: 0,
    });
  });

  it('lists what each side has lost, most valuable first, and the balance', () => {
    // The showcase game's opening: unicorns take pawns, a bishop takes a pawn
    // with check, the queen takes the bishop, the rook takes the unicorn.
    const board = play('Bb1-Ee4', 'Dd5-Aa2', 'Bc1-Dc3', 'Dc4-Cc4', 'Bd1-Ed4', 'Dc5-Ed4', 'Aa1-Aa2');
    const { lost, advantage } = materialBalance(board);
    expect(lost.white).toEqual([PieceType.Bishop, PieceType.Pawn]);
    expect(lost.black).toEqual([PieceType.Unicorn, PieceType.Pawn, PieceType.Pawn]);
    expect(advantage).toBe(3 + 1 + 1 - 3 - 1);
  });

  it('counts a promoted pawn as gone but not captured', () => {
    const board = new Board();
    board.setPiece(fromZXY('Aa1'), { type: PieceType.King, color: 'white' });
    board.setPiece(fromZXY('Ee5'), { type: PieceType.King, color: 'black' });
    // Two white queens: one is a promoted pawn
    board.setPiece(fromZXY('Cc3'), { type: PieceType.Queen, color: 'white' });
    board.setPiece(fromZXY('Cc4'), { type: PieceType.Queen, color: 'white' });
    const { lost } = materialBalance(board);
    expect(lost.white.filter((t) => t === PieceType.Pawn)).toHaveLength(9);
    expect(lost.white).not.toContain(PieceType.Queen);
    expect(lost.white).toContain(PieceType.Rook);
  });
});
