import { describe, expect, it } from 'vitest';
import { Board, PieceType } from '../engine';
import { LONG_PATTERN, parseTypedMove } from './typedMove';

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
  it.each(['Ba2-Ca2', 'Ba2 Ca2', 'Ba2Ca2', 'ba2–CA2', '  Ba2 - Ca2  ', 'Ba2 \t\n -\u00a0 Ca2'])(
    'reads %s as a legal move',
    (text) => {
      expect(parseTypedMove(text, start(), 'white')).toEqual({
        move: { from: { x: 0, y: 1, z: 1 }, to: { x: 0, y: 1, z: 2 }, promotion: undefined },
      });
    },
  );

  it('reads every text with the long-text pattern as with the short-text one', () => {
    const before =
      /^\s*([a-e])([a-e])([1-5])\s*(?:[-–x]\s*)?([a-e])([a-e])([1-5])\s*(?:=?\s*([qrbnu]))?\s*$/i;
    const alphabet = [
      'a',
      'b',
      'E',
      '1',
      '5',
      '6',
      'f',
      ' ',
      ' ',
      '\t',
      '-',
      '–',
      'x',
      '=',
      'q',
      'U',
      '!',
    ];
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const texts = ['Ba2-Ca2', 'Db5-Eb5=Q', 'Db5 Eb5 = u ', ' ab1 aa3 ', 'Ab1Aa3 =', 'Ab1Aa3=q!'];
    for (let i = 0; i < 20_000; i++) {
      const n = Math.floor(random() * 14);
      texts.push(
        Array.from({ length: n }, () => alphabet[Math.floor(random() * alphabet.length)]).join(''),
      );
      // and moves with spaces and extras round them, which random text rarely makes
      const pick = (s: string) => s[Math.floor(random() * s.length)];
      const ws = () => ' '.repeat(Math.floor(random() * 3));
      texts.push(
        `${ws()}${pick('abcdeF')}${pick('abcde')}${pick('123456')}${ws()}${pick('-–x= ')}${ws()}` +
          `${pick('abcde')}${pick('abcde')}${pick('12345')}${ws()}${pick('= !q')}${ws()}${pick('qrbnu!= ')}${ws()}`,
      );
    }
    let matched = 0;
    for (const text of texts) {
      const old = before.exec(text);
      const now = LONG_PATTERN.exec(text);
      expect(now ? [1, 2, 3, 5, 6, 7, 10].map((i) => now[i]) : null).toEqual(
        old ? old.slice(1, 8) : null,
      );
      if (old) matched++;
    }
    expect(matched).toBeGreaterThan(1000);
  });

  it('turns away a long paste at once, however many spaces it holds', () => {
    // A legal move, a long run of spaces and a stray character: the pattern
    // once took time quadratic in the run's length (784 ms for 20,000)
    const pasted = `Ab1Aa3${' '.repeat(200_000)}!`;
    const t0 = performance.now();
    expect(parseTypedMove(pasted, start(), 'white')).toEqual({
      error: 'Type a move as two cells, like Bb1-Cb1.',
    });
    expect(performance.now() - t0).toBeLessThan(200);
    expect(parseTypedMove(`Ab1${' '.repeat(200_000)}Aa3`, start(), 'white')).toHaveProperty('move');
  });

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
