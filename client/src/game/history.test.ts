import { describe, expect, it } from 'vitest';
import { deriveHistory } from './history';
import { PieceType, fromZXY } from '../engine';
import type { MoveRecord, WebSocketMessage } from '../types/messages';

const snapshot = (moves: MoveRecord[], started = true): WebSocketMessage => ({
  type: 'game_state',
  color: 'white',
  started,
  moves,
});
const moveMade = (by: 'white' | 'black', from: string, to: string): WebSocketMessage => ({
  type: 'move_made',
  by,
  from,
  to,
});

describe('deriveHistory: the move record', () => {
  it('starts from the initial position with no moves', () => {
    const h = deriveHistory([]);
    expect(h.moveRecords).toEqual([]);
    expect(h.appliedMoveCount).toBe(0);
    expect(h.currentTurn).toBe('white');
    expect(h.lastMove).toBeUndefined();
    expect(h.replayFailedAt).toBeNull();
    expect(h.gameOver).toBeNull();
    expect(h.snapshot).toBeUndefined();
    expect(h.board.getPiece(fromZXY('Aa2'))).toEqual({ type: PieceType.Pawn, color: 'white' });
  });

  it('is the latest snapshot plus the move_made messages after it', () => {
    const messages: WebSocketMessage[] = [
      { type: 'game_start', color: 'white' },
      moveMade('white', 'Aa2', 'Aa3'), // superseded by the snapshot below
      snapshot([{ by: 'white', from: 'Aa2', to: 'Aa3' }]),
      moveMade('black', 'Ed4', 'Ed3'),
      { type: 'presence', color: 'black', online: true },
      moveMade('white', 'Aa3', 'Aa4'),
    ];
    const h = deriveHistory(messages);
    expect(h.moveRecords).toMatchObject([
      { by: 'white', from: 'Aa2', to: 'Aa3' },
      { by: 'black', from: 'Ed4', to: 'Ed3' },
      { by: 'white', from: 'Aa3', to: 'Aa4' },
    ]);
    expect(h.snapshot).toBe(messages[2]);
    expect(h.appliedMoveCount).toBe(3);
    expect(h.currentTurn).toBe('black');
    expect(h.board.getPiece(fromZXY('Aa4'))).toEqual({ type: PieceType.Pawn, color: 'white' });
    expect(h.board.getPiece(fromZXY('Aa2'))).toBeNull();
    expect(h.lastMove).toEqual({
      move: { from: fromZXY('Aa3'), to: fromZXY('Aa4'), promotion: undefined },
      moveCount: 3,
      capturedPiece: null,
    });
  });

  it('takes the last of several snapshots (each reconnect replays the whole history)', () => {
    const h = deriveHistory([
      snapshot([{ by: 'white', from: 'Aa2', to: 'Aa3' }]),
      moveMade('black', 'Ed4', 'Ed3'),
      snapshot([
        { by: 'white', from: 'Aa2', to: 'Aa3' },
        { by: 'black', from: 'Ed4', to: 'Ed3' },
      ]),
    ]);
    expect(h.appliedMoveCount).toBe(2);
    expect(h.currentTurn).toBe('white');
  });

  it('reports the captured piece of the last move', () => {
    // A white knight jumps onto a black pawn (legality is not checked on replay).
    const h = deriveHistory([moveMade('white', 'Ab1', 'Dd4')]);
    expect(h.lastMove?.capturedPiece).toEqual({ type: PieceType.Pawn, color: 'black' });
    expect(h.board.getPiece(fromZXY('Dd4'))).toEqual({ type: PieceType.Knight, color: 'white' });
  });

  it('applies promotions from the record', () => {
    const h = deriveHistory([
      snapshot([
        { by: 'white', from: 'Aa2', to: 'Da4' },
        { by: 'black', from: 'Ee4', to: 'Ee3' },
        { by: 'white', from: 'Da4', to: 'Ea5', promotion: 'U' }, // forward-up capture of the rook
      ]),
    ]);
    expect(h.replayFailedAt).toBeNull();
    expect(h.board.getPiece(fromZXY('Ea5'))).toEqual({ type: PieceType.Unicorn, color: 'white' });
    expect(h.lastMove?.capturedPiece).toEqual({ type: PieceType.Rook, color: 'black' });
    expect(h.lastMove?.move.promotion).toBe(PieceType.Unicorn);
  });
});

describe('deriveHistory: identity', () => {
  const played: WebSocketMessage[] = [
    { type: 'game_start', color: 'white' },
    moveMade('white', 'Aa2', 'Aa3'),
  ];

  it('returns the previous history unchanged when only non-move messages arrived', () => {
    const first = deriveHistory(played);
    const again = deriveHistory(
      [
        ...played,
        { type: 'presence', color: 'black', online: false },
        { type: 'error', code: 'wrong_turn', message: 'Not your turn' },
      ],
      first,
    );
    expect(again).toBe(first);
  });

  it('returns a new history when a move arrives', () => {
    const first = deriveHistory(played);
    const next = deriveHistory([...played, moveMade('black', 'Ed4', 'Ed3')], first);
    expect(next).not.toBe(first);
    expect(next.appliedMoveCount).toBe(2);
    expect(next.board).not.toBe(first.board);
  });

  it('returns a new history when a snapshot arrives, even with the same moves', () => {
    const first = deriveHistory(played);
    const next = deriveHistory(
      [...played, snapshot([{ by: 'white', from: 'Aa2', to: 'Aa3' }])],
      first,
    );
    expect(next).not.toBe(first);
    expect(next.moveRecords).toMatchObject([{ by: 'white', from: 'Aa2', to: 'Aa3' }]);
    expect(next.board.getPiece(fromZXY('Aa3'))).toEqual({ type: PieceType.Pawn, color: 'white' });
  });

  it('ignores a previous history built from a different record', () => {
    const other = deriveHistory([moveMade('white', 'Ab2', 'Ab3')]);
    const h = deriveHistory(played, other);
    expect(h).not.toBe(other);
    expect(h.board.getPiece(fromZXY('Aa3'))).toEqual({ type: PieceType.Pawn, color: 'white' });
  });
});

describe('deriveHistory: game over', () => {
  it('detects checkmate and names the winner', () => {
    // The corner mate from board.test.ts, reached by teleporting: replay does
    // not check legality, so the record only has to be shape-valid. White's
    // queen lands on De5 defended by a rook on Ce5; Black's king walks onto
    // Ee5, where every neighbour is one of its own pieces.
    const h = deriveHistory([
      snapshot([
        { by: 'white', from: 'Bc1', to: 'De5' },
        { by: 'black', from: 'Ec5', to: 'Ee5' },
        { by: 'white', from: 'Aa1', to: 'Ce5' },
      ]),
    ]);
    expect(h.replayFailedAt).toBeNull();
    expect(h.currentTurn).toBe('black');
    expect(h.gameOver).toEqual({ result: 'checkmate', winner: 'white' });
  });

  it('is null while the game is on', () => {
    expect(deriveHistory([moveMade('white', 'Aa2', 'Aa3')]).gameOver).toBeNull();
  });
});

describe('deriveHistory: unplayable records', () => {
  it('freezes at the first record that cannot be applied', () => {
    const h = deriveHistory([
      snapshot([
        { by: 'white', from: 'Aa2', to: 'Aa3' },
        { by: 'black', from: 'Ed4', to: 'Ed3' },
        { by: 'white', from: 'Cc3', to: 'Cc4' }, // Cc3 is empty: no client could have made this
        { by: 'black', from: 'Ed3', to: 'Ed2' },
      ]),
    ]);
    expect(h.replayFailedAt).toBe(2);
    expect(h.appliedMoveCount).toBe(2);
    expect(h.currentTurn).toBe('white');
    expect(h.moveRecords).toHaveLength(4); // the record itself is still listed in full
    expect(h.board.getPiece(fromZXY('Ed3'))).toEqual({ type: PieceType.Pawn, color: 'black' });
    expect(h.lastMove?.moveCount).toBe(2);
    expect(h.gameOver).toBeNull();
  });

  it('freezes before a move that captures a king instead of throwing', () => {
    // Shape-valid and turn-correct, but a king capture leaves a position the
    // rules cannot evaluate (no king to find for check detection).
    const h = deriveHistory([
      snapshot([
        { by: 'white', from: 'Aa2', to: 'Aa3' },
        { by: 'black', from: 'Ed4', to: 'Ed3' },
        { by: 'white', from: 'Bc1', to: 'Ec5' }, // queen "captures" the black king
      ]),
    ]);
    expect(h.replayFailedAt).toBe(2);
    expect(h.appliedMoveCount).toBe(2);
    expect(h.currentTurn).toBe('white');
    expect(h.board.getPiece(fromZXY('Ec5'))).toEqual({ type: PieceType.King, color: 'black' });
    expect(h.board.getPiece(fromZXY('Bc1'))).toEqual({ type: PieceType.Queen, color: 'white' });
    expect(h.lastMove?.move.to).toEqual(fromZXY('Ed3'));
    expect(h.gameOver).toBeNull();
  });

  it('freezes at the capture even when the record continues past it', () => {
    // Nothing later in the record can be trusted once a king is gone, and
    // the side to move at the end may still have its king, so the check has
    // to happen at the capturing move itself.
    const h = deriveHistory([
      snapshot([
        { by: 'white', from: 'Aa2', to: 'Aa3' },
        { by: 'black', from: 'Ed4', to: 'Ed3' },
        { by: 'white', from: 'Bc1', to: 'Ec5' }, // captures the black king
        { by: 'black', from: 'Ed3', to: 'Ed2' },
      ]),
    ]);
    expect(h.replayFailedAt).toBe(2);
    expect(h.appliedMoveCount).toBe(2);
    expect(h.board.getPiece(fromZXY('Ec5'))).toEqual({ type: PieceType.King, color: 'black' });
  });

  it('freezes at the start when the first record captures a king', () => {
    const h = deriveHistory([moveMade('white', 'Bc1', 'Ec5')]);
    expect(h.replayFailedAt).toBe(0);
    expect(h.appliedMoveCount).toBe(0);
    expect(h.lastMove).toBeUndefined();
  });
});
