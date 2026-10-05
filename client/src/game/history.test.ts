import { describe, expect, it, vi } from 'vitest';
import { deriveHistory } from './history';
import type { Turn } from './history';
import { PieceType } from '../engine';
import { fromZXY } from '../engine/coords';
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
    expect(h.board.getPiece(fromZXY('Ba1'))).toEqual({ type: PieceType.Pawn, color: 'white' });
  });

  it('is the latest snapshot plus the move_made messages after it', () => {
    const messages: WebSocketMessage[] = [
      { type: 'game_start', color: 'white' },
      moveMade('white', 'Ba1', 'Ca1'), // superseded by the snapshot below
      snapshot([{ by: 'white', from: 'Ba1', to: 'Ca1' }]),
      moveMade('black', 'Dd5', 'Cd5'),
      { type: 'presence', color: 'black', online: true },
      moveMade('white', 'Ca1', 'Da1'),
    ];
    const h = deriveHistory(messages);
    expect(h.moveRecords).toMatchObject([
      { by: 'white', from: 'Ba1', to: 'Ca1' },
      { by: 'black', from: 'Dd5', to: 'Cd5' },
      { by: 'white', from: 'Ca1', to: 'Da1' },
    ]);
    expect(h.snapshot).toBe(messages[2]);
    expect(h.appliedMoveCount).toBe(3);
    expect(h.currentTurn).toBe('black');
    expect(h.board.getPiece(fromZXY('Da1'))).toEqual({ type: PieceType.Pawn, color: 'white' });
    expect(h.board.getPiece(fromZXY('Ba1'))).toBeNull();
    expect(h.lastMove).toEqual({
      move: { from: fromZXY('Ca1'), to: fromZXY('Da1'), promotion: undefined },
      moveCount: 3,
      capturedPiece: null,
    });
  });

  it('takes the last of several snapshots (each reconnect replays the whole history)', () => {
    const h = deriveHistory([
      snapshot([{ by: 'white', from: 'Ba1', to: 'Ca1' }]),
      moveMade('black', 'Dd5', 'Cd5'),
      snapshot([
        { by: 'white', from: 'Ba1', to: 'Ca1' },
        { by: 'black', from: 'Dd5', to: 'Cd5' },
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
        { by: 'white', from: 'Ba1', to: 'Da4' },
        { by: 'black', from: 'De5', to: 'Ce5' },
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
    moveMade('white', 'Ba1', 'Ca1'),
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
    const next = deriveHistory([...played, moveMade('black', 'Dd5', 'Cd5')], first);
    expect(next).not.toBe(first);
    expect(next.appliedMoveCount).toBe(2);
    expect(next.board).not.toBe(first.board);
  });

  it('returns a new history when a snapshot arrives, even with the same moves', () => {
    const first = deriveHistory(played);
    const next = deriveHistory(
      [...played, snapshot([{ by: 'white', from: 'Ba1', to: 'Ca1' }])],
      first,
    );
    expect(next).not.toBe(first);
    expect(next.moveRecords).toMatchObject([{ by: 'white', from: 'Ba1', to: 'Ca1' }]);
    expect(next.board.getPiece(fromZXY('Ca1'))).toEqual({ type: PieceType.Pawn, color: 'white' });
  });

  it('carries on from the previous history as moves land, as a full replay would', () => {
    // A game with a capture in it, arriving one move at a time
    const moves: [Turn, string, string][] = [
      ['white', 'Ab1', 'Cb2'],
      ['black', 'Dd5', 'Cd5'],
      ['white', 'Cb2', 'Db4'], // the knight takes a pawn
      ['black', 'Dc5', 'Cc5'],
    ];
    const log: WebSocketMessage[] = [{ type: 'game_start', color: 'white' }];
    let h = deriveHistory(log);
    for (const [by, from, to] of moves) {
      const before = h;
      const board = before.board;
      const taken = { white: [...before.captured.white], black: [...before.captured.black] };
      log.push(moveMade(by, from, to));
      h = deriveHistory(log, before);
      const full = deriveHistory(log);
      expect(h.board).not.toBe(board);
      expect(h.appliedMoveCount).toBe(full.appliedMoveCount);
      expect(h.captured).toEqual(full.captured);
      expect(h.lastMove).toEqual(full.lastMove);
      expect(h.currentTurn).toBe(full.currentTurn);
      expect(h.gameOver).toEqual(full.gameOver);
      for (let i = 0; i < 125; i++) {
        const c = { x: Math.floor(i / 5) % 5, y: i % 5, z: Math.floor(i / 25) };
        expect(h.board.getPiece(c)).toEqual(full.board.getPiece(c));
      }
      // The previous history is left exactly as it was
      expect(before.board).toBe(board);
      expect(before.captured).toEqual(taken);
    }
    expect(h.captured.white).toEqual([PieceType.Pawn]);
    expect(h.lastMove?.capturedPiece).toBeNull();
  });

  it('stays frozen when moves arrive after an unplayable one', () => {
    const log: WebSocketMessage[] = [
      moveMade('white', 'Ba1', 'Ca1'),
      moveMade('black', 'Cc3', 'Dc3'), // Cc3 is empty
    ];
    const first = deriveHistory(log);
    expect(first.replayFailedAt).toBe(1);
    log.push(moveMade('white', 'Ca1', 'Da1'));
    const next = deriveHistory(log, first);
    expect(next.replayFailedAt).toBe(1);
    expect(next.appliedMoveCount).toBe(1);
    expect(next.board.getPiece(fromZXY('Da1'))).toBeNull();
  });

  it('ignores a previous history built from a different record', () => {
    const other = deriveHistory([moveMade('white', 'Bb1', 'Cb1')]);
    const h = deriveHistory(played, other);
    expect(h).not.toBe(other);
    expect(h.board.getPiece(fromZXY('Ca1'))).toEqual({ type: PieceType.Pawn, color: 'white' });
  });
});

describe('deriveHistory: game over', () => {
  it('detects checkmate and names the winner', () => {
    // The corner mate from board.test.ts, reached by teleporting: replay does
    // not check legality, so the record only has to be shape-valid. White's
    // queen lands on Ee4 defended by a rook on Ee3; Black's king walks onto
    // Ee5, where every neighbour is one of its own pieces.
    const h = deriveHistory([
      snapshot([
        { by: 'white', from: 'Ac2', to: 'Ee4' },
        { by: 'black', from: 'Ec5', to: 'Ee5' },
        { by: 'white', from: 'Aa1', to: 'Ee3' },
      ]),
    ]);
    expect(h.replayFailedAt).toBeNull();
    expect(h.currentTurn).toBe('black');
    expect(h.gameOver).toEqual({ result: 'checkmate', winner: 'white' });
  });

  it('is null while the game is on', () => {
    expect(deriveHistory([moveMade('white', 'Ba1', 'Ca1')]).gameOver).toBeNull();
  });
});

describe('deriveHistory: unplayable records', () => {
  it('freezes at the first record that cannot be applied', () => {
    const h = deriveHistory([
      snapshot([
        { by: 'white', from: 'Ba1', to: 'Ca1' },
        { by: 'black', from: 'Dd5', to: 'Cd5' },
        { by: 'white', from: 'Cc3', to: 'Dc3' }, // Cc3 is empty: no client could have made this
        { by: 'black', from: 'Cd5', to: 'Bd5' },
      ]),
    ]);
    expect(h.replayFailedAt).toBe(2);
    expect(h.appliedMoveCount).toBe(2);
    expect(h.currentTurn).toBe('white');
    expect(h.moveRecords).toHaveLength(4); // the record itself is still listed in full
    expect(h.board.getPiece(fromZXY('Cd5'))).toEqual({ type: PieceType.Pawn, color: 'black' });
    expect(h.lastMove?.moveCount).toBe(2);
    expect(h.gameOver).toBeNull();
  });

  it('freezes before a move that captures a king instead of throwing', () => {
    // Shape-valid and turn-correct, but a king capture leaves a position the
    // rules cannot evaluate (no king to find for check detection).
    const h = deriveHistory([
      snapshot([
        { by: 'white', from: 'Ba1', to: 'Ca1' },
        { by: 'black', from: 'Dd5', to: 'Cd5' },
        { by: 'white', from: 'Ac2', to: 'Ec5' }, // queen "captures" the black king
      ]),
    ]);
    expect(h.replayFailedAt).toBe(2);
    expect(h.appliedMoveCount).toBe(2);
    expect(h.currentTurn).toBe('white');
    expect(h.board.getPiece(fromZXY('Ec5'))).toEqual({ type: PieceType.King, color: 'black' });
    expect(h.board.getPiece(fromZXY('Ac2'))).toEqual({ type: PieceType.Queen, color: 'white' });
    expect(h.lastMove?.move.to).toEqual(fromZXY('Cd5'));
    expect(h.gameOver).toBeNull();
  });

  it('freezes at the capture even when the record continues past it', () => {
    // Nothing later in the record can be trusted once a king is gone, and
    // the side to move at the end may still have its king, so the check has
    // to happen at the capturing move itself.
    const h = deriveHistory([
      snapshot([
        { by: 'white', from: 'Ba1', to: 'Ca1' },
        { by: 'black', from: 'Dd5', to: 'Cd5' },
        { by: 'white', from: 'Ac2', to: 'Ec5' }, // captures the black king
        { by: 'black', from: 'Cd5', to: 'Bd5' },
      ]),
    ]);
    expect(h.replayFailedAt).toBe(2);
    expect(h.appliedMoveCount).toBe(2);
    expect(h.board.getPiece(fromZXY('Ec5'))).toEqual({ type: PieceType.King, color: 'black' });
  });

  it('freezes at the start when the first record captures a king', () => {
    const h = deriveHistory([moveMade('white', 'Ac2', 'Ec5')]);
    expect(h.replayFailedAt).toBe(0);
    expect(h.appliedMoveCount).toBe(0);
    expect(h.lastMove).toBeUndefined();
  });
});

describe('deriveHistory: the work a landing move costs', () => {
  it('applies only the new move', async () => {
    const { Board } = await import('../engine');
    const log: WebSocketMessage[] = [
      moveMade('white', 'Ba1', 'Ca1'),
      moveMade('black', 'Dd5', 'Cd5'),
      moveMade('white', 'Ca1', 'Da1'),
    ];
    const prev = deriveHistory(log);
    const applied = vi.spyOn(Board.prototype, 'applyMove');
    deriveHistory([...log, moveMade('black', 'Cd5', 'Bd5')], prev);
    expect(applied).toHaveBeenCalledTimes(1);
    applied.mockRestore();
  });
});

describe('deriveHistory: the draws', () => {
  const recordsOf = (moves: string[]): MoveRecord[] =>
    moves.map((m, i) => {
      const [from, to] = m.split('-');
      return { by: i % 2 ? 'black' : 'white', from, to };
    });
  // The knights out and back: the start stands again every four plies
  const shuffle = ['Ab1-Cc1', 'Ed5-Cc5', 'Cc1-Ab1', 'Cc5-Ed5'];

  it('draws the third time the same position stands, the same side to move', () => {
    const twice = deriveHistory([snapshot(recordsOf(shuffle))]);
    expect(twice.gameOver).toBeNull();
    expect(twice.sinceIrreversible).toHaveLength(5);
    const almost = deriveHistory([snapshot(recordsOf([...shuffle, ...shuffle.slice(0, 3)]))]);
    expect(almost.gameOver).toBeNull();
    const thrice = deriveHistory([snapshot(recordsOf([...shuffle, ...shuffle]))]);
    expect(thrice.gameOver).toEqual({ result: 'repetition' });
    expect(thrice.currentTurn).toBe('white');
  });

  it('reaches the same verdict move by move as replayed whole', () => {
    const records = recordsOf([...shuffle, ...shuffle]);
    let h = deriveHistory([snapshot([])]);
    const log: WebSocketMessage[] = [snapshot([])];
    for (const r of records) {
      log.push(moveMade(r.by, r.from, r.to));
      h = deriveHistory([...log], h);
    }
    expect(h.gameOver).toEqual({ result: 'repetition' });
    expect(h.sinceIrreversible).toEqual(deriveHistory([snapshot(records)]).sinceIrreversible);
  });

  it('forgets the positions before a capture or a pawn move', () => {
    // The pawn move in the middle: the start can never stand again
    const h = deriveHistory([
      snapshot(recordsOf([...shuffle, 'Ba1-Ca1', 'Ed5-Cc5', 'Ab1-Cc1', 'Cc5-Ed5', 'Cc1-Ab1'])),
    ]);
    expect(h.replayFailedAt).toBeNull();
    expect(h.gameOver).toBeNull();
    expect(h.sinceIrreversible).toHaveLength(5);
  });

  /**
   * A hundred plies with no capture and no pawn move, no position three
   * times: each side moves its pieces about, the first move in the engine's
   * order that is neither and does not bring back a position seen twice.
   */
  const quietGame = async (plies: number, pawnAt?: number) => {
    const { Board } = await import('../engine');
    const { toZXY } = await import('../engine/coords');
    const { positionHash } = await import('../engine/draws');
    let board = Board.setupStartingPosition();
    const seen = new Map<number, number>();
    const moves: string[] = [];
    for (let ply = 0; ply < plies; ply++) {
      const color: Turn = ply % 2 ? 'black' : 'white';
      const next: Turn = color === 'white' ? 'black' : 'white';
      const legal = board.generateAllLegalMoves(color);
      const pick = legal.find((m) => {
        const pawn = board.getPiece(m.from)!.type === PieceType.Pawn;
        if (board.getPiece(m.to) || pawn !== (ply === pawnAt)) return false;
        const after = board.applyMove(m);
        return (seen.get(positionHash(after, next)) ?? 0) < 2 && after.hasLegalMove(next);
      })!;
      board = board.applyMove(pick);
      const key = positionHash(board, next);
      seen.set(key, (seen.get(key) ?? 0) + 1);
      moves.push(`${toZXY(pick.from)}-${toZXY(pick.to)}`);
    }
    return recordsOf(moves);
  };

  it('draws after fifty moves each with no capture and no pawn move', async () => {
    const game = await quietGame(100);
    expect(deriveHistory([snapshot(game.slice(0, 99))]).gameOver).toBeNull();
    const h = deriveHistory([snapshot(game)]);
    expect(h.sinceIrreversible).toHaveLength(101);
    expect(h.gameOver).toEqual({ result: 'fifty-moves' });
  });

  it('counts the fifty moves again from a pawn move', async () => {
    const game = await quietGame(100, 40);
    expect(deriveHistory([snapshot(game)]).gameOver).toBeNull();
    expect(deriveHistory([snapshot(game)]).sinceIrreversible).toHaveLength(60);
  });

  it('a mate stands, even on the move that would draw', async () => {
    const { Board } = await import('../engine');
    // The engine sees mate: the hundredth ply mates instead of drawing
    const mated = vi.spyOn(Board.prototype, 'isCheckmate').mockReturnValue(true);
    const h = deriveHistory([snapshot(await quietGame(100))]);
    expect(h.gameOver).toEqual({ result: 'checkmate', winner: 'black' });
    mated.mockRestore();
  });
});
