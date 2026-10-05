import { Board } from '../engine/board';
import type { Move } from '../engine/board';
import { fromZXY, toZXY } from '../engine/coords';
import type { Coord } from '../engine/coords';
import { KNIGHT_VECTORS, PieceType } from '../engine/pieces';
import type { LastMove } from './history';

// The tutorial (/learn): first the armies as a game starts, then a lesson
// per piece on the real tower and rules, each piece alone in the middle of
// the board, picked up, every square it can reach ringed. A piece captures as it moves, as in chess, so only the
// pawn has more to show: its captures and where it promotes, each for White
// and for Black, seen from Black's side: its pawns go forwards and down. The words are a sentence or
// two a step, said plainly; the board shows the rest. A direction is always
// one of the six (left, right, forwards, backwards, up, down): a diagonal
// goes two or three of them at once, and the ways a piece goes from its
// square are its lines.

export type LessonId =
  | 'setup'
  | 'rook'
  | 'bishop'
  | 'unicorn'
  | 'queen'
  | 'king'
  | 'knight'
  | 'pawn';

/** A line a piece moves along, as [file, rank, level] steps. */
export type Step = readonly [number, number, number];

export type Side = 'white' | 'black';

export interface LessonStep {
  /** The step's name in the lesson's switcher (lessons of more than one step). */
  label?: string;
  /** What the lesson says, a sentence or two, as a teacher would put it. */
  line: string;
  /** A second, quieter line, for a rule the board can't show. */
  note?: string;
  /** Where the pieces stand, as ZXY squares. */
  pieces: readonly { at: string; type: PieceType; color: 'white' | 'black' }[];
  /** The piece kept picked up, its moves ringed; none, the board only to look at. */
  focus?: string;
  /** The lines it moves along, for the little cube beside the words. */
  directions?: {
    moves: readonly Step[];
    /** Lines it only captures along (a pawn's). */
    captures?: readonly Step[];
    /** One step, as far as the line runs, or a jump. */
    reach: 'step' | 'line' | 'jump';
    /** Under the cube. */
    caption: string;
  };
  /** A picture of where a pawn promotes, in place of the cube. */
  promotionRow?: boolean;
  /** A picture of the pieces each side has, in place of the cube. */
  army?: boolean;
  /**
   * The step for Black, in a lesson with a side for each colour: its words,
   * and its caption where it differs. The position is White's, mirrored.
   */
  black?: Pick<LessonStep, 'line' | 'note'> & { caption?: string };
}

export interface Lesson {
  id: LessonId;
  /** Its name in the menu and its heading. */
  name: string;
  /** The piece its menu entry shows; none, the tower's levels. */
  piece?: PieceType;
  /** A piece 2D chess does not have. */
  isNew?: boolean;
  /** Each step shown for White, then for Black (its steps' `black`). */
  bothSides?: boolean;
  steps: readonly LessonStep[];
}

// Directions from a cube's centre: to the middle of a face (one axis
// changes), of an edge (two) and to a corner (all three)
const all: Step[] = [];
for (const dz of [-1, 0, 1])
  for (const dx of [-1, 0, 1])
    for (const dy of [-1, 0, 1]) if (dx || dy || dz) all.push([dx, dy, dz]);
const changing = (n: number) => all.filter((s) => s.filter((d) => d !== 0).length === n);
export const FACES = changing(1);
export const EDGES = changing(2);
export const CORNERS = changing(3);
export const JUMPS: Step[] = KNIGHT_VECTORS.map(([dz, dx, dy]) => [dx, dy, dz]);

/** Every square, level by level. */
const SQUARES: Coord[] = [];
for (let z = 0; z < 5; z++)
  for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) SQUARES.push({ x, y, z });

/** The armies as a game starts: White on the bottom two levels, Black on the top two. */
const START: LessonStep['pieces'] = (() => {
  const board = Board.setupStartingPosition();
  return SQUARES.flatMap((at) => {
    const piece = board.getPiece(at);
    return piece ? [{ at: toZXY(at), type: piece.type, color: piece.color }] : [];
  });
})();

/** What each side has, as a game starts, in the order the card shows it. */
export const ARMY: readonly { type: PieceType; count: number; new?: boolean }[] = [
  { type: PieceType.King, count: 1 },
  { type: PieceType.Queen, count: 1 },
  { type: PieceType.Rook, count: 2 },
  { type: PieceType.Bishop, count: 2 },
  { type: PieceType.Knight, count: 2 },
  { type: PieceType.Unicorn, count: 2, new: true },
  { type: PieceType.Pawn, count: 10, new: true },
];

/** A piece's one step: its moves from the middle of the board. */
const lesson = (type: PieceType, move: Pick<LessonStep, 'line' | 'note' | 'directions'>) => [
  { pieces: [{ at: 'Cc3', type, color: 'white' as const }], focus: 'Cc3', ...move },
];

export const LESSONS: readonly Lesson[] = [
  {
    id: 'setup',
    name: 'Setup',
    steps: [
      {
        line: 'Each side has 20 pieces, including two unicorns and ten pawns. White starts at the bottom, Black at the top.',
        pieces: START,
        army: true,
      },
    ],
  },
  {
    id: 'rook',
    name: 'Rook',
    piece: PieceType.Rook,
    steps: lesson(PieceType.Rook, {
      line: 'Rooks move in a straight line, in any of 6 directions: left, right, forwards, backwards, up or down.',
      directions: { moves: FACES, reach: 'line', caption: '6 lines' },
    }),
  },
  {
    id: 'bishop',
    name: 'Bishop',
    piece: PieceType.Bishop,
    steps: lesson(PieceType.Bishop, {
      line: 'Bishops move diagonally, two directions at once, like forwards and left, or up and right.',
      directions: { moves: EDGES, reach: 'line', caption: '12 lines' },
    }),
  },
  {
    id: 'unicorn',
    name: 'Unicorn',
    piece: PieceType.Unicorn,
    isNew: true,
    steps: lesson(PieceType.Unicorn, {
      line: 'Unicorns move diagonally, three directions at once, like forwards, right and up.',
      directions: { moves: CORNERS, reach: 'line', caption: '8 lines' },
    }),
  },
  {
    id: 'queen',
    name: 'Queen',
    piece: PieceType.Queen,
    steps: lesson(PieceType.Queen, {
      line: 'Queens move like a rook, a bishop or a unicorn, along any of their 26 lines.',
      directions: { moves: all, reach: 'line', caption: '26 lines' },
    }),
  },
  {
    id: 'king',
    name: 'King',
    piece: PieceType.King,
    steps: lesson(PieceType.King, {
      line: 'Kings move like a queen, but only one square: 26 squares in all.',
      note: 'There\u2019s no castling.',
      directions: { moves: all, reach: 'step', caption: '26 squares' },
    }),
  },
  {
    id: 'knight',
    name: 'Knight',
    piece: PieceType.Knight,
    steps: lesson(PieceType.Knight, {
      line: 'Knights jump in an L: two squares in one direction, then one square at a right angle.',
      directions: { moves: JUMPS, reach: 'jump', caption: '24 jumps' },
    }),
  },
  {
    id: 'pawn',
    name: 'Pawn',
    piece: PieceType.Pawn,
    bothSides: true,
    steps: [
      {
        label: 'Move',
        line: 'White\u2019s pawns move one square forwards or one square up, never two.',
        pieces: [{ at: 'Cc3', type: PieceType.Pawn, color: 'white' }],
        focus: 'Cc3',
        directions: {
          moves: [
            [0, 1, 0],
            [0, 0, 1],
          ],
          reach: 'step',
          caption: 'Forwards or up',
        },
        black: {
          line: 'Black\u2019s pawns move one square forwards or one square down, never two.',
          caption: 'Forwards or down',
        },
      },
      {
        label: 'Capture',
        line: 'White\u2019s pawns capture one square diagonally, like a bishop, but never backwards or down.',
        pieces: [
          { at: 'Cc3', type: PieceType.Pawn, color: 'white' },
          { at: 'Cb4', type: PieceType.Pawn, color: 'black' },
          { at: 'Cd4', type: PieceType.Knight, color: 'black' },
          { at: 'Db3', type: PieceType.Bishop, color: 'black' },
          { at: 'Dd3', type: PieceType.Pawn, color: 'black' },
          { at: 'Dc4', type: PieceType.Unicorn, color: 'black' },
        ],
        focus: 'Cc3',
        directions: {
          moves: [
            [0, 1, 0],
            [0, 0, 1],
          ],
          captures: [
            [-1, 1, 0],
            [1, 1, 0],
            [-1, 0, 1],
            [1, 0, 1],
            [0, 1, 1],
          ],
          reach: 'step',
          caption: '5 captures',
        },
        black: {
          line: 'Black\u2019s pawns capture one square diagonally, like a bishop, but never backwards or up.',
        },
      },
      {
        label: 'Promote',
        line: 'White\u2019s pawns promote when they reach the far rank of the top level.',
        // On the far rank already, but two levels short
        pieces: [{ at: 'Cc5', type: PieceType.Pawn, color: 'white' }],
        focus: 'Cc5',
        promotionRow: true,
        black: {
          line: 'Black\u2019s pawns promote on the far rank of the bottom level, on White\u2019s side.',
        },
      },
    ],
  },
];

export const lessonById = (id: string | undefined): Lesson | undefined =>
  LESSONS.find((l) => l.id === id);

/** A square seen from the other side: the same file, the rank and level turned round. */
const mirror = (at: string) => {
  const { x, y, z } = fromZXY(at);
  return toZXY({ x, y: 4 - y, z: 4 - z });
};
const mirrorStep = ([file, rank, level]: Step): Step => [file, 0 - rank, 0 - level];
const other = (color: Side): Side => (color === 'white' ? 'black' : 'white');

/**
 * A step for `side`. Black's is White's position turned round (each piece's
 * rank and level mirrored and its colour swapped) with Black's own words,
 * said from Black's side: its pawns go forwards and down.
 */
export const stepFor = (step: LessonStep, side: Side): LessonStep => {
  if (side === 'white' || !step.black) return step;
  const { black, directions, ...rest } = step;
  return {
    ...rest,
    line: black.line,
    note: black.note,
    pieces: step.pieces.map((p) => ({ ...p, at: mirror(p.at), color: other(p.color) })),
    focus: step.focus && mirror(step.focus),
    directions: directions && {
      ...directions,
      moves: directions.moves.map(mirrorStep),
      captures: directions.captures?.map(mirrorStep),
      caption: black.caption ?? directions.caption,
    },
  };
};

/**
 * The tutorial's board: the real rules on a board without kings. With no
 * king of its own to keep safe, a piece may make every move it has (the
 * engine would look for that king); where its king stands, the rules are
 * the game's.
 */
export class LessonBoard extends Board {
  static from(pieces: LessonStep['pieces']): LessonBoard {
    const board = new LessonBoard();
    for (const { at, type, color } of pieces) board.setPiece(fromZXY(at), { type, color });
    return board;
  }

  override clone(): LessonBoard {
    const board = new LessonBoard();
    for (const at of SQUARES) board.setPiece(at, this.getPiece(at));
    return board;
  }

  override generateLegalMoves(from: Coord): Move[] {
    const piece = this.getPiece(from);
    if (piece && !this.hasKing(piece.color)) return this.generatePotentialMoves(from);
    return super.generateLegalMoves(from);
  }

  private hasKing(color: 'white' | 'black'): boolean {
    return SQUARES.some((at) => {
      const piece = this.getPiece(at);
      return piece?.type === PieceType.King && piece.color === color;
    });
  }
}

/** A lesson's position as it stands: the board, the picked-up piece and the last move. */
export interface Practice {
  board: LessonBoard;
  /** Where the lesson's piece stands now; null where none is picked up. */
  focus: Coord | null;
  /** The lesson's piece's colour, the side that moves. */
  side: Side;
  lastMove?: LastMove;
}

export const startPractice = (step: LessonStep): Practice => {
  const focus = step.focus ? fromZXY(step.focus) : null;
  const board = LessonBoard.from(step.pieces);
  return { board, focus, side: (focus && board.getPiece(focus)?.color) || 'white' };
};

/** The position after `move`: the piece it moved stays picked up. */
export const practise = (practice: Practice, move: Move): Practice => ({
  ...practice,
  board: practice.board.applyMove(move) as LessonBoard,
  focus: move.to,
  lastMove: {
    move,
    moveCount: (practice.lastMove?.moveCount ?? 0) + 1,
    capturedPiece: practice.board.getPiece(move.to),
  },
});

/** The squares the lesson's piece can reach from where it stands. */
export const reachable = (practice: Practice): number => {
  const { board, focus } = practice;
  if (!focus || !board.getPiece(focus)) return 0;
  return new Set(board.generateLegalMoves(focus).map((m) => toZXY(m.to))).size;
};
