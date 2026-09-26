import { describe, expect, it } from 'vitest';
import { Board, PieceType } from '../engine';
import { parseTypedMove } from './typedMove';

const start = () => Board.setupStartingPosition();

// White pawn one step from promoting on Ec5 (level E, file c, rank 5)
const promotionBoard = () => {
  const board = new Board();
  board.setPiece({ x: 2, y: 3, z: 4 }, { type: PieceType.Pawn, color: 'white' });
  board.setPiece({ x: 0, y: 0, z: 0 }, { type: PieceType.King, color: 'white' });
  board.setPiece({ x: 4, y: 0, z: 0 }, { type: PieceType.King, color: 'black' });
  return board;
};

describe('parseTypedMove', () => {
  it.each(['Ba2-Ba3', 'Ba2 Ba3', 'Ba2Ba3', 'ba2–BA3', '  Ba2 - Ba3  '])(
    'reads %s as a legal move',
    (text) => {
      expect(parseTypedMove(text, start(), 'white')).toEqual({
        move: { from: { x: 0, y: 1, z: 1 }, to: { x: 0, y: 2, z: 1 }, promotion: undefined },
      });
    },
  );

  it('explains text that is not two cells', () => {
    expect(parseTypedMove('e4', start(), 'white')).toEqual({
      error: 'Type a move as two cells, like Ab2-Ab3.',
    });
    expect(parseTypedMove('Fa1-Fa2', start(), 'white')).toHaveProperty('error');
  });

  it("refuses an empty cell or the opponent's piece", () => {
    expect(parseTypedMove('Cc3-Cc4', start(), 'white')).toEqual({
      error: 'You have no piece on Cc3.',
    });
    expect(parseTypedMove('Ba2-Ba3', start(), 'black')).toEqual({
      error: 'You have no piece on Ba2.',
    });
  });

  it('refuses a destination the piece cannot reach', () => {
    expect(parseTypedMove('Ba2-Ba5', start(), 'white')).toEqual({
      error: 'The piece on Ba2 cannot move to Ba5.',
    });
  });

  it('refuses a promotion piece on an ordinary move', () => {
    expect(parseTypedMove('Ba2-Ba3=Q', start(), 'white')).toEqual({
      error: 'Ba2-Ba3 is not a promotion.',
    });
  });

  it('asks which piece a promoting pawn becomes, and takes any of the five', () => {
    expect(parseTypedMove('Ec4-Ec5', promotionBoard(), 'white')).toEqual({
      error: 'Say which piece to promote to: add =Q, =R, =B, =N or =U.',
    });
    expect(parseTypedMove('Ec4-Ec5=u', promotionBoard(), 'white')).toEqual({
      move: { from: { x: 2, y: 3, z: 4 }, to: { x: 2, y: 4, z: 4 }, promotion: PieceType.Unicorn },
    });
    expect(parseTypedMove('Ec4Ec5Q', promotionBoard(), 'white')).toMatchObject({
      move: { promotion: PieceType.Queen },
    });
  });
});
