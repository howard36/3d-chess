import { describe, expect, it } from 'vitest';
import { Board, PieceType } from '../engine';
import type { Move } from '../engine';
import { fromZXY } from '../engine/coords';
import { notateCandidate, notateMove, notationSquares, notationWords } from './notation';

/** A board with the kings out of the way (White's on Aa1, Black's on Ee5) and these pieces. */
const boardWith = (
  pieces: Record<string, readonly [PieceType, 'white' | 'black']>,
  kings = true,
) => {
  const board = new Board();
  if (kings) {
    board.setPiece(fromZXY('Aa1'), { type: PieceType.King, color: 'white' });
    board.setPiece(fromZXY('Ee5'), { type: PieceType.King, color: 'black' });
  }
  for (const [at, [type, color]] of Object.entries(pieces)) {
    board.setPiece(fromZXY(at), { type, color });
  }
  return board;
};
const move = (from: string, to: string, promotion?: PieceType): Move => ({
  from: fromZXY(from),
  to: fromZXY(to),
  promotion,
});
const notate = (board: Board, m: Move) => notateMove(board, m, board.applyMove(m));
const W = 'white' as const;
const B = 'black' as const;

describe('the notation of a move', () => {
  it('writes the piece and its destination alone where no other piece of its kind could go there', () => {
    const board = boardWith({ Ab1: [PieceType.Knight, W] });
    const n = notate(board, move('Ab1', 'Ac3'));
    expect(n).toEqual({
      piece: PieceType.Knight,
      from: null,
      capture: false,
      to: 'Ac3',
      promotion: null,
      check: '',
    });
    expect(notationSquares(n)).toBe('Ac3');
    expect(notationWords(n)).toBe('Knight to Ac3');
  });

  it('writes a pawn as any other piece: its icon, then its destination', () => {
    const board = boardWith({ Bc2: [PieceType.Pawn, W] });
    const n = notate(board, move('Bc2', 'Cc2'));
    expect(n.piece).toBe(PieceType.Pawn);
    expect(notationSquares(n)).toBe('Cc2');
  });

  it('writes "x" before a captured piece’s square', () => {
    const board = boardWith({ Bc2: [PieceType.Pawn, W], Cc3: [PieceType.Pawn, B] });
    const n = notate(board, move('Bc2', 'Cc3'));
    expect(notationSquares(n)).toBe('xCc3');
    expect(notationWords(n)).toBe('Pawn takes Cc3');
  });

  it('tells apart the five pawns that could take on Cc3 by their whole starting squares', () => {
    // A white pawn takes forwards and up, forwards to either side, or up to either side
    const board = boardWith({
      Bc2: [PieceType.Pawn, W],
      Cb2: [PieceType.Pawn, W],
      Cd2: [PieceType.Pawn, W],
      Bb3: [PieceType.Pawn, W],
      Bd3: [PieceType.Pawn, W],
      Cc3: [PieceType.Pawn, B],
    });
    for (const from of ['Bc2', 'Cb2', 'Cd2', 'Bb3', 'Bd3']) {
      const n = notate(board, move(from, 'Cc3'));
      expect(notationSquares(n)).toBe(`${from}xCc3`);
      expect(notationWords(n)).toBe(`Pawn ${from} takes Cc3`);
    }
  });

  it('joins the starting square to the destination with a dash for a move that takes nothing', () => {
    // A pawn goes forwards or up: from Cc2 and from Bc3 alike onto Cc3
    const board = boardWith({ Cc2: [PieceType.Pawn, W], Bc3: [PieceType.Pawn, W] });
    expect(notationSquares(notate(board, move('Cc2', 'Cc3')))).toBe('Cc2–Cc3');
    expect(notationSquares(notate(board, move('Bc3', 'Cc3')))).toBe('Bc3–Cc3');
    expect(notationWords(notate(board, move('Bc3', 'Cc3')))).toBe('Pawn Bc3 to Cc3');
  });

  it('does not count a piece that could not go there without leaving its king in check', () => {
    // Two knights reach Ac3; the one on Ab1 is pinned to the king by the rook
    const pieces = { Ab1: [PieceType.Knight, W], Aa2: [PieceType.Knight, W] } as const;
    const free = boardWith({ ...pieces });
    expect(notate(free, move('Aa2', 'Ac3')).from).toBe('Aa2');
    const pinned = boardWith({ ...pieces, Ae1: [PieceType.Rook, B] });
    expect(notate(pinned, move('Aa2', 'Ac3')).from).toBeNull();
  });

  it('does not count a piece of the other side or of another kind', () => {
    const board = boardWith({
      Ab1: [PieceType.Knight, W],
      Ad1: [PieceType.Knight, B],
      Aa2: [PieceType.Unicorn, W],
    });
    expect(notate(board, move('Ab1', 'Ac3')).from).toBeNull();
  });

  it('marks a check with "+"', () => {
    const board = boardWith({ Ea1: [PieceType.Rook, W] });
    const n = notate(board, move('Ea1', 'Ea5'));
    expect(n.check).toBe('+');
    expect(notationWords(n)).toBe('Rook to Ea5, check');
  });

  it('writes what a pawn becomes after its square', () => {
    const board = boardWith({ Ed4: [PieceType.Pawn, W] });
    const n = notate(board, move('Ed4', 'Ed5', PieceType.Unicorn));
    expect(n.piece).toBe(PieceType.Pawn);
    expect(n.promotion).toBe(PieceType.Unicorn);
    expect(notationWords(n)).toBe('Pawn to Ed5, promotes to unicorn');
  });

  it('marks the mate the caller names with "#"', () => {
    const board = boardWith({ Ea1: [PieceType.Rook, W] });
    const m = move('Ea1', 'Ea5');
    const n = notateMove(board, m, board.applyMove(m), true);
    expect(n.check).toBe('#');
    expect(notationWords(n)).toBe('Rook to Ea5, checkmate');
  });

  it('finds the check and the mate of a move not played', () => {
    // The corner mate (board.test.ts): the queen to De5, beside Black's king
    // on Ee5, defended by the rook on Ce5
    const board = boardWith({ Da5: [PieceType.Queen, W], Ce5: [PieceType.Rook, W] });
    expect(notateCandidate(board, move('Da5', 'De5')).check).toBe('#');
    // (Until the queen stands between them, the rook checks the king along
    // the levels: the check and the quiet move with the queen alone)
    const queen = boardWith({ Da5: [PieceType.Queen, W] });
    expect(notateCandidate(queen, move('Da5', 'Ea5')).check).toBe('+');
    expect(notateCandidate(queen, move('Da5', 'Da4')).check).toBe('');
  });

  it('asks for a piece on the starting square', () => {
    expect(() => notate(boardWith({}), move('Cc2', 'Cc3'))).toThrow(/No piece at Cc2/);
  });
});
