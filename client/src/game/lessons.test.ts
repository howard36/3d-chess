import { describe, expect, it } from 'vitest';
import { Board } from '../engine/board';
import { fromZXY, toZXY } from '../engine/coords';
import {
  BISHOP_VECTORS,
  KNIGHT_VECTORS,
  PieceType,
  QUEEN_VECTORS,
  ROOK_VECTORS,
  UNICORN_VECTORS,
} from '../engine/pieces';
import {
  CORNERS,
  captureState,
  EDGES,
  FACES,
  JUMPS,
  LESSONS,
  LessonBoard,
  lessonById,
  practise,
  reachable,
  startPractice,
} from './lessons';
import type { Step } from './lessons';

const lesson = (id: string) => lessonById(id)!;
/** The engine's [dz, dx, dy] vectors as a lesson's [file, rank, level] steps, sorted. */
const asSteps = (vectors: ReadonlyArray<readonly [number, number, number]>) =>
  vectors.map(([dz, dx, dy]) => [dx, dy, dz].join()).sort();
const sorted = (steps: readonly Step[]) => steps.map((s) => s.join()).sort();

describe('the lessons', () => {
  it('teach every piece, the unicorn as the new one', () => {
    expect(LESSONS.map((l) => l.id)).toEqual([
      'rook',
      'bishop',
      'unicorn',
      'queen',
      'king',
      'knight',
      'pawn',
    ]);
    expect(LESSONS.filter((l) => l.isNew).map((l) => l.id)).toEqual(['unicorn']);
    expect(new Set(LESSONS.map((l) => l.piece))).toEqual(new Set(Object.values(PieceType)));
    expect(lessonById('nonsense')).toBeUndefined();
  });

  it('show every piece but the pawn moving from the middle of an empty board, then a capture', () => {
    for (const id of ['rook', 'bishop', 'unicorn', 'queen', 'king', 'knight']) {
      const [move, capture] = lesson(id).steps;
      expect(lesson(id).steps.map((s) => s.label)).toEqual(['Move', 'Capture']);
      expect(move.pieces).toEqual([{ at: 'Cc3', type: lesson(id).piece, color: 'white' }]);
      expect(move.focus).toBe('Cc3');
      expect(move.target).toBeUndefined();
      expect(capture.pieces).toEqual([
        ...move.pieces,
        { at: capture.target, type: PieceType.Pawn, color: 'black' },
      ]);
      expect(capture.hint).toBeTruthy();
    }
    expect(lesson('pawn').steps.map((s) => s.label)).toEqual(['Move', 'Capture', 'Promote']);
  });

  it('keep to a line a step', () => {
    for (const step of LESSONS.flatMap((l) => l.steps)) {
      expect(step.line.split(' ').length).toBeLessThanOrEqual(9);
      if (step.note) expect(step.note.split(' ').length).toBeLessThanOrEqual(6);
      if (step.hint) expect(step.hint.split(' ').length).toBeLessThanOrEqual(5);
    }
  });

  it('stage each capture so only a move off the piece’s own level takes the pawn', () => {
    for (const id of ['rook', 'bishop', 'unicorn', 'queen', 'king', 'knight']) {
      const step = lesson(id).steps[1];
      const practice = startPractice(step);
      const takes = practice.board
        .generateLegalMoves(practice.focus)
        .filter((m) => practice.board.getPiece(m.to));
      expect(takes.map((m) => toZXY(m.to))).toEqual([step.target]);
      expect(takes[0].to.z).not.toBe(practice.focus.z);
    }
    // The queen's goes through a corner of the cube: a unicorn's line
    const q = lesson('queen').steps[1];
    const [dx, dy, dz] = (['x', 'y', 'z'] as const).map(
      (k) => fromZXY(q.target!)[k] - fromZXY(q.focus)[k],
    );
    expect([dx, dy, dz].every((d) => d !== 0)).toBe(true);
  });

  it("draw each piece's directions as the engine moves it", () => {
    expect(sorted(FACES)).toEqual(asSteps(ROOK_VECTORS));
    expect(sorted(EDGES)).toEqual(asSteps(BISHOP_VECTORS));
    expect(sorted(CORNERS)).toEqual(asSteps(UNICORN_VECTORS));
    expect(sorted(JUMPS)).toEqual(asSteps(KNIGHT_VECTORS));
    const drawn = (id: string) => sorted(lesson(id).steps[0].directions!.moves);
    expect(drawn('rook')).toEqual(asSteps(ROOK_VECTORS));
    expect(drawn('bishop')).toEqual(asSteps(BISHOP_VECTORS));
    expect(drawn('unicorn')).toEqual(asSteps(UNICORN_VECTORS));
    expect(drawn('queen')).toEqual(asSteps(QUEEN_VECTORS));
    expect(drawn('king')).toEqual(asSteps(QUEEN_VECTORS));
    expect(drawn('knight')).toEqual(asSteps(KNIGHT_VECTORS));
  });

  it('count the moves the rules give from where the piece starts', () => {
    const counts = Object.fromEntries(
      LESSONS.flatMap((l) => l.steps.map((s, i) => [`${l.id}.${i}`, reachable(startPractice(s))])),
    );
    expect(counts).toEqual({
      'rook.0': 12,
      'rook.1': 12,
      'bishop.0': 24,
      'bishop.1': 24,
      'unicorn.0': 16,
      'unicorn.1': 16,
      'queen.0': 52,
      'queen.1': 52,
      'king.0': 26,
      'king.1': 26,
      'knight.0': 24,
      'knight.1': 24,
      'pawn.0': 2,
      // Its two steps and the five pieces it can take
      'pawn.1': 7,
      // Only up: it is on the far rank already
      'pawn.2': 1,
    });
  });

  it("put a capture on every one of the pawn's capture squares", () => {
    const step = lesson('pawn').steps[1];
    const captures = step.directions!.captures!;
    const practice = startPractice(step);
    const from = fromZXY(step.focus);
    const takes = practice.board
      .generateLegalMoves(from)
      .filter((m) => practice.board.getPiece(m.to))
      .map((m) => [m.to.x - from.x, m.to.y - from.y, m.to.z - from.z].join())
      .sort();
    expect(takes).toEqual(sorted(captures));
  });
});

describe('LessonBoard', () => {
  it('lets a piece without its king make every move it has', () => {
    const board = LessonBoard.from([{ at: 'Aa1', type: PieceType.Rook, color: 'white' }]);
    // The engine looks for the king to keep safe
    const plain = new Board();
    plain.setPiece(fromZXY('Aa1'), { type: PieceType.Rook, color: 'white' });
    expect(() => plain.generateLegalMoves(fromZXY('Aa1'))).toThrow();
    expect(board.generateLegalMoves(fromZXY('Aa1'))).toEqual(
      board.generatePotentialMoves(fromZXY('Aa1')),
    );
  });

  it('keeps the rules of check where a king stands', () => {
    const board = LessonBoard.from([
      { at: 'Cc3', type: PieceType.King, color: 'white' },
      { at: 'Dd4', type: PieceType.Rook, color: 'black' },
    ]);
    const tos = board.generateLegalMoves(fromZXY('Cc3')).map((m) => toZXY(m.to));
    // The rook holds three lines through Dd4: six of the king's neighbours,
    // but he may take it
    for (const held of ['Db4', 'Dc4', 'Dd2', 'Dd3', 'Bd4', 'Cd4']) expect(tos).not.toContain(held);
    expect(tos).toContain('Dd4');
    expect(tos).toContain('Db2');
    expect(tos).toHaveLength(26 - 6);
  });

  it('stays a lesson board through a move', () => {
    const board = LessonBoard.from([{ at: 'Cc3', type: PieceType.Unicorn, color: 'white' }]);
    const next = board.applyMove({ from: fromZXY('Cc3'), to: fromZXY('Dd4') });
    expect(next).toBeInstanceOf(LessonBoard);
    expect(next.getPiece(fromZXY('Dd4'))).toEqual({ type: PieceType.Unicorn, color: 'white' });
    expect(next.getPiece(fromZXY('Cc3'))).toBeNull();
    expect(board.getPiece(fromZXY('Cc3'))).not.toBeNull();
    expect(next.generateLegalMoves(fromZXY('Dd4')).length).toBeGreaterThan(0);
  });
});

describe('practice', () => {
  it('moves the piece, keeps it picked up and records the move as live', () => {
    const start = startPractice(lesson('queen').steps[0]);
    expect(start.lastMove).toBeUndefined();
    const once = practise(start, { from: fromZXY('Cc3'), to: fromZXY('Dc3') });
    expect(once.focus).toEqual(fromZXY('Dc3'));
    expect(once.lastMove).toEqual({
      move: { from: fromZXY('Cc3'), to: fromZXY('Dc3') },
      moveCount: 1,
      capturedPiece: null,
    });
    expect(reachable(once)).toBe(44);
    const twice = practise(once, { from: fromZXY('Dc3'), to: fromZXY('Ee4') });
    expect(twice.lastMove?.moveCount).toBe(2);
    // On the top level, at its edge: barely half the moves it had in the middle
    expect(reachable(twice)).toBe(28);
  });

  it('records what a capture took', () => {
    const start = startPractice(lesson('pawn').steps[1]);
    const took = practise(start, { from: fromZXY('Cc3'), to: fromZXY('Dc4') });
    expect(took.lastMove?.capturedPiece).toEqual({ type: PieceType.Unicorn, color: 'black' });
    expect(took.board.getPiece(fromZXY('Dc4'))).toEqual({ type: PieceType.Pawn, color: 'white' });
  });

  it('promotes only on the top level’s far rank', () => {
    const start = startPractice(lesson('pawn').steps[2]);
    const up = start.board.generateLegalMoves(start.focus);
    expect(up.map((m) => [toZXY(m.to), m.promotion])).toEqual([['Dc5', undefined]]);
    const climbed = practise(start, up[0]);
    const promotions = climbed.board.generateLegalMoves(climbed.focus);
    expect(new Set(promotions.map((m) => toZXY(m.to)))).toEqual(new Set(['Ec5']));
    expect(promotions.map((m) => m.promotion)).toContain(PieceType.Unicorn);
    const promoted = practise(climbed, promotions.find((m) => m.promotion === PieceType.Unicorn)!);
    expect(promoted.board.getPiece(fromZXY('Ec5'))).toEqual({
      type: PieceType.Unicorn,
      color: 'white',
    });
  });

  it('counts nothing once the picked-up square is empty', () => {
    const start = startPractice(lesson('rook').steps[0]);
    expect(reachable({ ...start, board: LessonBoard.from([]) })).toBe(0);
  });
});

describe('captureState', () => {
  it('follows a capture step from trying, through a miss, to the pawn taken', () => {
    const step = lesson('rook').steps[1];
    const start = startPractice(step);
    expect(captureState(step, start)).toBe('trying');
    const missed = practise(start, { from: fromZXY('Cc3'), to: fromZXY('Dc3') });
    expect(captureState(step, missed)).toBe('missed');
    // A second try still counts
    expect(captureState(step, practise(missed, { from: fromZXY('Dc3'), to: fromZXY('Ec3') }))).toBe(
      'done',
    );
    expect(captureState(step, practise(start, { from: fromZXY('Cc3'), to: fromZXY('Ec3') }))).toBe(
      'done',
    );
  });

  it('has nothing to say where there is no pawn to take', () => {
    const step = lesson('rook').steps[0];
    expect(captureState(step, startPractice(step))).toBeNull();
  });
});
