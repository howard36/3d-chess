import { describe, expect, it } from 'vitest';
import { announceLastMove, describeLastMove, describeTurn, resultWords } from './announce';
import { deriveHistory } from './history';
import type { MoveRecord, WebSocketMessage } from '../types/messages';

const replay = (moves: MoveRecord[]) =>
  deriveHistory([
    { type: 'game_state', color: 'white', started: true, moves },
  ] as WebSocketMessage[]);

const w = (from: string, to: string, promotion?: MoveRecord['promotion']): MoveRecord => ({
  by: 'white',
  from,
  to,
  ...(promotion ? { promotion } : {}),
});
const b = (from: string, to: string): MoveRecord => ({ by: 'black', from, to });

// A short line with a capture and a check (the showcase's opening)
const CHECK_LINE = [
  w('Ab2', 'De5'),
  b('Ed4', 'Ba1'),
  w('Ac2', 'Cc4'),
  b('Dc4', 'Dc3'),
  w('Ad2', 'Dd5'),
];
// The shortest mate, by Black (e2e/gameOver.spec.ts)
const MATE = [w('Ad1', 'Ac3'), b('Ec4', 'Cc2'), w('Ac2', 'Ad1'), b('Cc2', 'Bb1')];
// A white pawn's way to promotion (e2e/promotion.spec.ts)
const PROMOTION = [
  w('Ba2', 'Ca2'),
  b('De5', 'Ce5'),
  w('Ca2', 'Ca3'),
  b('Ce5', 'Be5'),
  w('Ca3', 'Da4'),
  b('Be5', 'Ae5'),
  w('Da4', 'Ea5', 'U'),
];

describe('describeLastMove', () => {
  it('says nothing before the first move', () => {
    expect(describeLastMove(replay([]))).toBeNull();
    expect(announceLastMove(replay([]), 'white')).toBe('Your move.');
  });

  it('names the piece and the two cells of a quiet move', () => {
    expect(describeLastMove(replay([w('Bb1', 'Cb1')]))).toBe('White pawn Bb1 to Cb1');
  });

  it('names what a capture took', () => {
    expect(describeLastMove(replay(CHECK_LINE.slice(0, 2)))).toBe(
      'Black unicorn Ed4 takes pawn on Ba1',
    );
  });

  it('names what a pawn promoted to', () => {
    expect(describeLastMove(replay(PROMOTION))).toBe(
      'White pawn Da4 takes rook on Ea5, promotes to unicorn',
    );
  });
});

describe('describeTurn', () => {
  it('speaks to the player: their own move, or the other side by name', () => {
    const history = replay([w('Bb1', 'Cb1')]);
    expect(describeTurn(history, 'black')).toBe('Your move.');
    expect(describeTurn(history, 'white')).toBe('Black to move.');
  });

  it('says check before whose move it is', () => {
    const history = replay(CHECK_LINE);
    expect(describeTurn(history, 'black')).toBe('Check. Your move.');
    expect(announceLastMove(history, 'white')).toBe(
      'White bishop Ad2 takes pawn on Dd5. Check. Black to move.',
    );
  });

  it('gives the result instead once the game is over', () => {
    const history = replay(MATE);
    expect(describeTurn(history, 'black')).toBe('Checkmate. You win.');
    expect(describeTurn(history, 'white')).toBe('Checkmate. You lose.');
    expect(describeTurn(history, null)).toBe('Checkmate. Black wins.');
  });

  it('reports a stalemate as a draw', () => {
    const history = { ...replay([]), gameOver: { result: 'stalemate' as const } };
    expect(describeTurn(history, 'white')).toBe('Stalemate. Draw.');
  });

  it('names the other draws', () => {
    const repetition = { ...replay([]), gameOver: { result: 'repetition' as const } };
    expect(describeTurn(repetition, 'white')).toBe('Repetition. Draw.');
    const fifty = { ...replay([]), gameOver: { result: 'fifty-moves' as const } };
    expect(describeTurn(fifty, null)).toBe('50-move rule. Draw.');
  });

  it('works for a player whose seat is not yet known', () => {
    expect(describeTurn(replay([]), null)).toBe('White to move.');
  });

  it('says who resigned, and an agreed draw', () => {
    const resigned = {
      ...replay(CHECK_LINE),
      gameOver: { result: 'resignation' as const, winner: 'white' as const },
    };
    expect(describeTurn(resigned, 'white')).toBe('Black resigned. You win.');
    expect(describeTurn(resigned, 'black')).toBe('Black resigned. You lose.');
    expect(describeTurn(resigned, null)).toBe('Black resigned. White wins.');
    // Said alone: the last move was announced as it landed
    expect(announceLastMove(resigned, 'white')).toBe('Black resigned. You win.');
    const agreed = { ...replay(CHECK_LINE), gameOver: { result: 'agreement' as const } };
    expect(announceLastMove(agreed, 'black')).toBe('Draw agreed.');
  });
});

describe('resultWords', () => {
  it('names the result and the verdict for the seat', () => {
    expect(resultWords({ result: 'checkmate', winner: 'black' }, 'black')).toEqual({
      how: 'Checkmate',
      verdict: 'you win',
    });
    expect(resultWords({ result: 'resignation', winner: 'black' }, 'white')).toEqual({
      how: 'White resigned',
      verdict: 'you lose',
    });
    expect(resultWords({ result: 'repetition' }, 'white')).toEqual({
      how: 'Repetition',
      verdict: 'draw',
    });
    expect(resultWords({ result: 'agreement' }, 'white')).toEqual({
      how: 'Draw agreed',
      verdict: null,
    });
  });
});
