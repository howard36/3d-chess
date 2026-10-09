import { describe, expect, it, vi } from 'vitest';
import { Board, PieceType } from '../engine';
import { deriveHistory } from './history';
import { formatMove, plyLabel, reviewLine, stepOfKey, stepTo } from './review';
import type { MoveRecord, WebSocketMessage } from '../types/messages';

const recordsOf = (moves: string[]): MoveRecord[] =>
  moves.map((m, i) => {
    const [from, to] = m.split('-');
    return { by: i % 2 ? 'black' : 'white', from, to };
  });
const snapshot = (moves: MoveRecord[]): WebSocketMessage => ({
  type: 'game_state',
  color: 'white',
  started: true,
  moves,
});
const moveMade = (r: MoveRecord): WebSocketMessage => ({ type: 'move_made', ...r });

// A short game with captures on both sides (hudFit.spec.ts's long game's start)
const GAME = recordsOf([
  'Ae2-Db5',
  'Ec4-Bc1',
  'Ac2-Bc1',
  'Ed5-Db5',
  'Ad2-Dd5',
  'Ec5-Dd5',
  'Aa2-Da5',
]);

/** Every square's piece, as one string, to compare positions. */
const pieces = (board: Board) =>
  JSON.stringify(
    Array.from({ length: 125 }, (_, i) =>
      board.getPiece({ x: i % 5, y: Math.floor(i / 5) % 5, z: Math.floor(i / 25) }),
    ),
  );

describe('reviewLine', () => {
  it('holds the position after every move, as the replay of the record that far derives it', () => {
    const line = reviewLine(deriveHistory([snapshot(GAME)]));
    expect(line.positions).toHaveLength(GAME.length + 1);
    for (let ply = 0; ply <= GAME.length; ply++) {
      const there = deriveHistory([snapshot(GAME.slice(0, ply))]);
      const p = line.positions[ply];
      expect(p.ply).toBe(ply);
      expect(pieces(p.board)).toBe(pieces(there.board));
      expect(p.currentTurn).toBe(there.currentTurn);
      expect(p.lastMove).toEqual(there.lastMove);
      expect(p.captured).toEqual(there.captured);
    }
    // The start, before any move
    expect(line.positions[0].lastMove).toBeUndefined();
    expect(pieces(line.positions[0].board)).toBe(pieces(Board.setupStartingPosition()));
    // A capture is counted from its move on
    expect(line.positions[1].captured.white).toEqual([PieceType.Pawn]);
    expect(line.positions[0].captured.white).toEqual([]);
  });

  it('carries the line on as moves land: the same positions, only the new moves played', () => {
    const log = GAME.slice(0, 4).map(moveMade);
    const before = deriveHistory(log);
    const line = reviewLine(before);
    const applied = vi.spyOn(Board.prototype, 'applyMove');
    const after = deriveHistory([...log, moveMade(GAME[4])], before);
    applied.mockClear();
    const on = reviewLine(after, line);
    expect(applied).toHaveBeenCalledTimes(1);
    applied.mockRestore();
    expect(on.positions).toHaveLength(6);
    for (let ply = 0; ply <= 4; ply++) expect(on.positions[ply]).toBe(line.positions[ply]);
    // The same record: the same line
    expect(reviewLine(after, on)).toBe(on);
  });

  it('starts again for a record that is not the old one carried on', () => {
    const line = reviewLine(deriveHistory([snapshot(GAME.slice(0, 3))]));
    // A reconnect's snapshot: the same moves, new records
    const again = reviewLine(deriveHistory([snapshot(recordsOf(['Ae2-Db5', 'Ec4-Bc1']))]), line);
    expect(again.positions).toHaveLength(3);
    expect(again.positions[0]).not.toBe(line.positions[0]);
  });

  it('leaves out a record past one the replay could not play', () => {
    // Black's second move is from an empty square
    const history = deriveHistory([
      snapshot(recordsOf(['Bb1-Cb1', 'Dd5-Cd5', 'Cb1-Db1', 'Cc3-Bc3'])),
    ]);
    expect(history.replayFailedAt).toBe(3);
    expect(reviewLine(history).positions).toHaveLength(4);
  });
});

describe('the steps through the record', () => {
  it('lead to the start, one back, one on, the latest, never past either end', () => {
    expect(stepTo('first', 5, 9)).toBe(0);
    expect(stepTo('previous', 5, 9)).toBe(4);
    expect(stepTo('previous', 0, 9)).toBe(0);
    expect(stepTo('next', 5, 9)).toBe(6);
    expect(stepTo('next', 9, 9)).toBe(9);
    expect(stepTo('latest', 2, 9)).toBe(9);
  });

  it('are taken by ← → Home End, and no other key', () => {
    expect(stepOfKey('ArrowLeft')).toBe('previous');
    expect(stepOfKey('ArrowRight')).toBe('next');
    expect(stepOfKey('Home')).toBe('first');
    expect(stepOfKey('End')).toBe('latest');
    expect(stepOfKey('ArrowUp')).toBeNull();
    expect(stepOfKey('a')).toBeNull();
  });
});

describe('how a ply is written', () => {
  it('numbers the moves in pairs, Black’s after "…", the start as "Start"', () => {
    expect(plyLabel(GAME, 0)).toBe('Start');
    expect(plyLabel(GAME, 1)).toBe('1. Ae2–Db5');
    expect(plyLabel(GAME, 2)).toBe('1… Ec4–Bc1');
    expect(plyLabel(GAME, 7)).toBe('4. Aa2–Da5');
  });

  it('writes a promotion after the move', () => {
    expect(formatMove({ by: 'white', from: 'Db4', to: 'Eb5', promotion: 'Q' })).toBe('Db4–Eb5=Q');
  });
});
