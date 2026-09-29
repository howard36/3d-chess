import { describe, expect, it } from 'vitest';
import { Board, PieceType } from '../engine';
import { parseTypedMove } from './typedMove';

const start = () => Board.setupStartingPosition();

// White pawn one step from promoting on Ec5 (level E, file c, rank 5)
const promotionBoard = () => {
  const board = new Board();
  board.setPiece({ x: 2, y: 4, z: 3 }, { type: PieceType.Pawn, color: 'white' });
  board.setPiece({ x: 0, y: 0, z: 0 }, { type: PieceType.King, color: 'white' });
  board.setPiece({ x: 4, y: 0, z: 0 }, { type: PieceType.King, color: 'black' });
  return board;
};

describe('parseTypedMove', () => {
  it.each(['Ba2-Ca2', 'Ba2 Ca2', 'Ba2Ca2', 'ba2–CA2', '  Ba2 - Ca2  '])(
    'reads %s as a legal move',
    (text) => {
      expect(parseTypedMove(text, start(), 'white')).toEqual({
        move: { from: { x: 0, y: 1, z: 1 }, to: { x: 0, y: 1, z: 2 }, promotion: undefined },
      });
    },
  );

  it('explains text that is not two cells', () => {
    expect(parseTypedMove('e4', start(), 'white')).toEqual({
      error: 'Type a move as two cells, like Bb1-Cb1.',
    });
    expect(parseTypedMove('Fa1-Fa2', start(), 'white')).toHaveProperty('error');
  });

  it("refuses an empty cell or the opponent's piece", () => {
    expect(parseTypedMove('Cc3-Dc3', start(), 'white')).toEqual({
      error: 'You have no piece on Cc3.',
    });
    expect(parseTypedMove('Ba2-Ca2', start(), 'black')).toEqual({
      error: 'You have no piece on Ba2.',
    });
  });

  it('refuses a destination the piece cannot reach', () => {
    expect(parseTypedMove('Ba2-Ea2', start(), 'white')).toEqual({
      error: 'The piece on Ba2 cannot move to Ea2.',
    });
  });

  it('refuses a promotion piece on an ordinary move', () => {
    expect(parseTypedMove('Ba2-Ca2=Q', start(), 'white')).toEqual({
      error: 'Ba2-Ca2 is not a promotion.',
    });
  });

  it('asks which piece a promoting pawn becomes, and takes any of the five', () => {
    expect(parseTypedMove('Dc5-Ec5', promotionBoard(), 'white')).toEqual({
      error: 'Say which piece to promote to: add =Q, =R, =B, =N or =U.',
    });
    expect(parseTypedMove('Dc5-Ec5=u', promotionBoard(), 'white')).toEqual({
      move: { from: { x: 2, y: 4, z: 3 }, to: { x: 2, y: 4, z: 4 }, promotion: PieceType.Unicorn },
    });
    expect(parseTypedMove('Dc5Ec5Q', promotionBoard(), 'white')).toMatchObject({
      move: { promotion: PieceType.Queen },
    });
  });
});
