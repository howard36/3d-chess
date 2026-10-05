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
  ARMY,
  CORNERS,
  EDGES,
  FACES,
  JUMPS,
  LESSONS,
  LessonBoard,
  lessonById,
  practise,
  reachable,
  startPractice,
  stepFor,
} from './lessons';
import type { Step } from './lessons';

const lesson = (id: string) => lessonById(id)!;
/** The engine's [dz, dx, dy] vectors as a lesson's [file, rank, level] steps, sorted. */
const asSteps = (vectors: ReadonlyArray<readonly [number, number, number]>) =>
  vectors.map(([dz, dx, dy]) => [dx, dy, dz].join()).sort();
const sorted = (steps: readonly Step[]) => steps.map((s) => s.join()).sort();

describe('the lessons', () => {
  it('set the armies out first, then teach every piece, the unicorn as the new one', () => {
    expect(LESSONS.map((l) => l.id)).toEqual([
      'setup',
      'rook',
      'bishop',
      'unicorn',
      'queen',
      'king',
      'knight',
      'pawn',
    ]);
    expect(LESSONS.filter((l) => l.isNew).map((l) => l.id)).toEqual(['unicorn']);
    expect(new Set(LESSONS.flatMap((l) => l.piece ?? []))).toEqual(
      new Set(Object.values(PieceType)),
    );
    expect(lessonById('nonsense')).toBeUndefined();
  });

  it('show the armies as a game starts, nothing picked up, and count what each side has', () => {
    const [setup] = lesson('setup').steps;
    expect(setup.focus).toBeUndefined();
    expect(setup.army).toBe(true);
    const start = Board.setupStartingPosition();
    const board = startPractice(setup).board;
    for (const { at } of setup.pieces)
      expect(board.getPiece(fromZXY(at))).toEqual(start.getPiece(fromZXY(at)));
    for (const color of ['white', 'black'] as const) {
      const own = setup.pieces.filter((p) => p.color === color);
      expect(own).toHaveLength(20);
      // The card's count of each kind is the board's
      for (const { type, count } of ARMY)
        expect(own.filter((p) => p.type === type)).toHaveLength(count);
    }
    expect(ARMY.reduce((n, a) => n + a.count, 0)).toBe(20);
    // What chess doesn't have: the unicorns, and two more pawns
    expect(ARMY.filter((a) => a.new).map((a) => a.type)).toEqual([
      PieceType.Unicorn,
      PieceType.Pawn,
    ]);
    // White's at the bottom, Black's at the top
    expect(new Set(setup.pieces.filter((p) => p.color === 'white').map((p) => p.at[0]))).toEqual(
      new Set(['A', 'B']),
    );
    expect(new Set(setup.pieces.filter((p) => p.color === 'black').map((p) => p.at[0]))).toEqual(
      new Set(['D', 'E']),
    );
    expect(reachable(startPractice(setup))).toBe(0);
  });

  it('show every piece but the pawn alone in the middle of an empty board, in one step', () => {
    for (const id of ['rook', 'bishop', 'unicorn', 'queen', 'king', 'knight']) {
      expect(lesson(id).steps).toHaveLength(1);
      const [move] = lesson(id).steps;
      expect(move.pieces).toEqual([{ at: 'Cc3', type: lesson(id).piece, color: 'white' }]);
      expect(move.focus).toBe('Cc3');
    }
    expect(lesson('pawn').steps.map((s) => s.label)).toEqual(['Move', 'Capture', 'Promote']);
  });

  it('say each step in a sentence or two, and a note in a short one', () => {
    const sides = LESSONS.flatMap((l) => l.steps).flatMap((s) => [s, stepFor(s, 'black')]);
    for (const step of sides) {
      expect(step.line.split(' ').length).toBeLessThanOrEqual(20);
      if (step.note) expect(step.note.split(' ').length).toBeLessThanOrEqual(10);
    }
  });

  it('use "direction" for one of the six only, and count lines', () => {
    for (const step of LESSONS.flatMap((l) => l.steps)) {
      // The six are the only directions counted (the rook's)
      for (const [, n] of step.line.matchAll(/(\d+) directions/g)) expect(n).toBe('6');
      expect(step.directions?.caption ?? '').not.toMatch(/direction/);
    }
  });

  it("teach the pawn for each side, Black's said from Black's side: forwards and down", () => {
    const pawn = lesson('pawn');
    expect(pawn.bothSides).toBe(true);
    for (const step of pawn.steps) {
      expect(step.line).toMatch(/^White’s pawns/);
      expect(stepFor(step, 'black').line).toMatch(/^Black’s pawns/);
    }
    expect(LESSONS.filter((l) => l.bothSides).map((l) => l.id)).toEqual(['pawn']);
    const black = pawn.steps.map((s) => stepFor(s, 'black').line);
    expect(black[0]).toMatch(/forwards or one square down/);
    expect(black[1]).toMatch(/never backwards or up/);
    // Black's pawns go forwards, never "backwards", as they see it
    for (const line of black) expect(line).not.toMatch(/backwards or down|forwards or up/);
    // Only a step with words for Black has a Black side
    expect(stepFor(lesson('rook').steps[0], 'black')).toBe(lesson('rook').steps[0]);
  });

  it("mirror White's position for Black: the rank and level turned round, the colours swapped", () => {
    const capture = stepFor(lesson('pawn').steps[1], 'black');
    expect(capture.focus).toBe('Cc3');
    expect(capture.pieces).toEqual([
      { at: 'Cc3', type: PieceType.Pawn, color: 'black' },
      { at: 'Cb2', type: PieceType.Pawn, color: 'white' },
      { at: 'Cd2', type: PieceType.Knight, color: 'white' },
      { at: 'Bb3', type: PieceType.Bishop, color: 'white' },
      { at: 'Bd3', type: PieceType.Pawn, color: 'white' },
      { at: 'Bc2', type: PieceType.Unicorn, color: 'white' },
    ]);
    expect(stepFor(lesson('pawn').steps[0], 'black').directions).toMatchObject({
      moves: [
        [0, -1, 0],
        [0, 0, -1],
      ],
      caption: 'Forwards or down',
    });
    expect(startPractice(capture).side).toBe('black');
  });

  it("say where Black's pawns promote: on White's side", () => {
    const promote = stepFor(lesson('pawn').steps[2], 'black');
    expect(promote.line).toMatch(/Black.*far rank of the bottom level, on White’s side/);
    expect(promote.focus).toBe('Cc1');
    const black = new Board();
    expect(black.isPromotionSquare(fromZXY('Ac1'), 'black')).toBe(true);
    expect(black.isPromotionSquare(fromZXY('Ec5'), 'black')).toBe(false);
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
    const black = lesson('pawn').steps.map((s) => reachable(startPractice(stepFor(s, 'black'))));
    // Black's pawn, the other way, has as many
    expect(black).toEqual([2, 7, 1]);
    expect(counts).toEqual({
      // Nothing picked up: the armies are only to look at
      'setup.0': 0,
      'rook.0': 12,
      'bishop.0': 24,
      'unicorn.0': 16,
      'queen.0': 52,
      'king.0': 26,
      'knight.0': 24,
      'pawn.0': 2,
      // Its two steps and the five pieces it can take
      'pawn.1': 7,
      // Only up: it is on the far rank already
      'pawn.2': 1,
    });
  });

  it.each(['white', 'black'] as const)(
    "put a capture on every one of %s's pawn's capture squares, and draw them",
    (side) => {
      const step = stepFor(lesson('pawn').steps[1], side);
      const practice = startPractice(step);
      const from = fromZXY(step.focus!);
      const delta = (to: { x: number; y: number; z: number }) =>
        [to.x - from.x, to.y - from.y, to.z - from.z].join();
      const moves = practice.board.generateLegalMoves(from);
      const takes = moves.filter((m) => practice.board.getPiece(m.to)).map((m) => delta(m.to));
      const steps = moves.filter((m) => !practice.board.getPiece(m.to)).map((m) => delta(m.to));
      expect(takes.sort()).toEqual(sorted(step.directions!.captures!));
      expect(steps.sort()).toEqual(sorted(step.directions!.moves));
    },
  );

  it("promote Black's pawn on level A, rank 1", () => {
    const start = startPractice(stepFor(lesson('pawn').steps[2], 'black'));
    const [down] = start.board.generateLegalMoves(start.focus!);
    expect(toZXY(down.to)).toBe('Bc1');
    const climbed = practise(start, down);
    expect(climbed.side).toBe('black');
    const promotions = climbed.board.generateLegalMoves(climbed.focus!);
    expect(new Set(promotions.map((m) => toZXY(m.to)))).toEqual(new Set(['Ac1']));
    expect(promotions.every((m) => m.promotion)).toBe(true);
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
    const up = start.board.generateLegalMoves(start.focus!);
    expect(up.map((m) => [toZXY(m.to), m.promotion])).toEqual([['Dc5', undefined]]);
    const climbed = practise(start, up[0]);
    const promotions = climbed.board.generateLegalMoves(climbed.focus!);
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
