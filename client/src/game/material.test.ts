import { describe, expect, it } from 'vitest';
import { Board } from '../engine';
import { PieceType } from '../engine/pieces';
import { fromZXY } from '../engine/coords';
import { deriveHistory } from './history';
import type { WebSocketMessage } from '../types/messages';
import { describeTaken, groupTaken, materialLead, materialOf } from './material';

const { Queen, Rook, Bishop, Unicorn, Knight, Pawn, King } = PieceType;

/** The history after these moves (level-file-rank, "=Q" to promote). */
const replay = (...moves: string[]) =>
  deriveHistory([
    {
      type: 'game_state',
      color: 'white',
      started: true,
      moves: moves.map((m, i) => {
        const [from, rest] = m.split('-');
        const [to, promotion] = rest.split('=');
        return {
          by: i % 2 === 0 ? 'white' : 'black',
          from,
          to,
          ...(promotion ? { promotion: promotion as 'Q' } : {}),
        };
      }),
    } as WebSocketMessage,
  ]);

// The showcase game's opening: unicorns take pawns, a bishop takes a pawn
// with check, the queen takes the bishop, the rook takes the unicorn.
const OPENING = ['Ab2-De5', 'Ed4-Ba1', 'Ac2-Cc4', 'Dc4-Dc3', 'Ad2-Dd5', 'Ec4-Dd5', 'Aa1-Ba1'];

describe('the pieces each side has taken', () => {
  it('are none at the start, with the material even', () => {
    const h = replay();
    expect(h.captured).toEqual({ white: [], black: [] });
    expect(materialLead(h.board, 'white')).toBe(0);
    expect(materialOf(h.board, 'white')).toBe(10 + 2 * 3 + 2 * 3 + 2 * 2.5 + 2 * 1.5 + 10);
  });

  it('are what stood on each move’s destination, in the order taken', () => {
    const h = replay(...OPENING);
    expect(h.captured).toEqual({ white: [Pawn, Pawn, Unicorn], black: [Pawn, Bishop] });
    // White took a unicorn and two pawns, Black a bishop and a pawn
    expect(materialLead(h.board, 'white')).toBe(1.5 + 1 + 1 - 3 - 1);
    expect(materialLead(h.board, 'black')).toBe(0.5);
  });

  it('keep their count through a frozen record, up to the move that could not be played', () => {
    const h = deriveHistory([
      {
        type: 'game_state',
        color: 'white',
        started: true,
        moves: [
          { by: 'white', from: 'Ab2', to: 'De5' },
          { by: 'black', from: 'Cc3', to: 'Cc4' }, // no piece there
        ],
      },
    ]);
    expect(h.replayFailedAt).toBe(1);
    expect(h.captured).toEqual({ white: [Pawn], black: [] });
  });

  it('count a promoted piece as what it became, and the lead counts the promotion', () => {
    // A white pawn lands on Black's pawn on Da4, then takes the rook on Ea5 as
    // it promotes to a unicorn (legality is not checked on replay)
    const h = replay('Ba1-Da4', 'De5-Ce5', 'Da4-Ea5=U');
    expect(h.captured.white).toEqual([Pawn, Rook]);
    // White: + the unicorn (1.5) - its pawn (1); Black: - a pawn and the rook
    expect(materialLead(h.board, 'white')).toBe(1.5 - 1 + 1 + 2.5);
    // Taken in turn, it is a unicorn that burns away
    const next = replay('Ba1-Da4', 'De5-Ce5', 'Da4-Ea5=U', 'Eb5-Ea5');
    expect(next.captured.black).toEqual([Unicorn]);
  });
});

describe('groupTaken', () => {
  it('groups by kind, most valuable first, counting each', () => {
    expect(groupTaken([Pawn, Knight, Pawn, Queen, Unicorn, Pawn, Bishop, Rook, Rook])).toEqual([
      { type: Queen, count: 1 },
      { type: Knight, count: 1 },
      { type: Bishop, count: 1 },
      { type: Rook, count: 2 },
      { type: Unicorn, count: 1 },
      { type: Pawn, count: 3 },
    ]);
  });

  it('is empty for nothing taken', () => {
    expect(groupTaken([])).toEqual([]);
  });
});

describe('materialOf', () => {
  it('counts every piece on the board by its value, the king as nothing', () => {
    const board = new Board();
    board.setPiece(fromZXY('Aa1'), { type: King, color: 'white' });
    board.setPiece(fromZXY('Ee5'), { type: King, color: 'black' });
    board.setPiece(fromZXY('Cc3'), { type: Queen, color: 'white' });
    board.setPiece(fromZXY('Dc3'), { type: Queen, color: 'white' });
    board.setPiece(fromZXY('Bb2'), { type: Knight, color: 'black' });
    expect(materialOf(board, 'white')).toBe(20);
    expect(materialOf(board, 'black')).toBe(3);
    expect(materialLead(board, 'black')).toBe(-17);
  });
});

describe('describeTaken', () => {
  it('says what you have taken, and your lead', () => {
    expect(
      describeTaken(
        [
          { type: Knight, count: 1 },
          { type: Pawn, count: 3 },
        ],
        5,
        'you',
      ),
    ).toBe('You have taken a knight and 3 pawns; you are 5 ahead.');
  });

  it('says what the opponent has taken, and theirs', () => {
    expect(describeTaken([{ type: Bishop, count: 1 }], 0, 'opponent')).toBe(
      'Your opponent has taken a bishop.',
    );
    expect(
      describeTaken(
        [
          { type: Queen, count: 1 },
          { type: Rook, count: 2 },
          { type: Unicorn, count: 2 },
        ],
        14,
        'opponent',
      ),
    ).toBe('Your opponent has taken a queen, 2 rooks and 2 unicorns; they are 14 ahead.');
  });

  it('leaves out a lead that is not theirs', () => {
    expect(describeTaken([{ type: Pawn, count: 1 }], -2, 'you')).toBe('You have taken a pawn.');
  });

  it('says a lead with nothing taken (a promotion), and nothing when there is nothing', () => {
    expect(describeTaken([], 8, 'you')).toBe('You are 8 ahead.');
    expect(describeTaken([], 2, 'opponent')).toBe('Your opponent is 2 ahead.');
    expect(describeTaken([], 0, 'you')).toBe('');
    expect(describeTaken([], -3, 'opponent')).toBe('');
  });
});
