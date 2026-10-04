import { Board } from '../engine/board';
import type { Move } from '../engine/board';
import { fromZXY, toZXY } from '../engine/coords';
import type { Coord } from '../engine/coords';
import { KNIGHT_VECTORS, PieceType } from '../engine/pieces';
import type { LastMove } from './history';

// The tutorial (/learn): a lesson per piece on the real tower and rules,
// each piece alone in the middle of the board, picked up, every square it
// can reach ringed. A piece captures as it moves, as in chess, so only the
// pawn has more to show: its captures and where it promotes. The words are
// a line a step; the board shows the rest.

export type LessonId = 'rook' | 'bishop' | 'unicorn' | 'queen' | 'king' | 'knight' | 'pawn';

/** A direction a piece moves in, as [file, rank, level] steps. */
export type Step = readonly [number, number, number];

export interface LessonStep {
  /** The step's name in the lesson's switcher (lessons of more than one step). */
  label?: string;
  /** The one line under the lesson's name. */
  line: string;
  /** A second, quieter line, for a rule the board can't show. */
  note?: string;
  /** Where the pieces stand, as ZXY squares. */
  pieces: readonly { at: string; type: PieceType; color: 'white' | 'black' }[];
  /** The piece kept picked up, its moves ringed. */
  focus: string;
  /** The directions it moves in, for the little cube beside the words. */
  directions?: {
    moves: readonly Step[];
    /** Directions it only captures in (a pawn's). */
    captures?: readonly Step[];
    /** One step, as far as the line runs, or a jump. */
    reach: 'step' | 'line' | 'jump';
    /** Under the cube. */
    caption: string;
  };
  /** A picture of where a pawn promotes, in place of the cube. */
  promotionRow?: boolean;
}

export interface Lesson {
  id: LessonId;
  /** Its name in the menu and its heading. */
  name: string;
  /** The piece its menu entry shows. */
  piece: PieceType;
  /** A piece 2D chess does not have. */
  isNew?: boolean;
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

/** A piece's one step: its moves from the middle of the board. */
const lesson = (type: PieceType, move: Pick<LessonStep, 'line' | 'note' | 'directions'>) => [
  { pieces: [{ at: 'Cc3', type, color: 'white' as const }], focus: 'Cc3', ...move },
];

export const LESSONS: readonly Lesson[] = [
  {
    id: 'rook',
    name: 'Rook',
    piece: PieceType.Rook,
    steps: lesson(PieceType.Rook, {
      line: 'Straight lines: sideways, forward and back, up and down.',
      directions: { moves: FACES, reach: 'line', caption: '6 directions' },
    }),
  },
  {
    id: 'bishop',
    name: 'Bishop',
    piece: PieceType.Bishop,
    steps: lesson(PieceType.Bishop, {
      line: 'Diagonals, across a level or climbing between levels.',
      directions: { moves: EDGES, reach: 'line', caption: '12 directions' },
    }),
  },
  {
    id: 'unicorn',
    name: 'Unicorn',
    piece: PieceType.Unicorn,
    isNew: true,
    steps: lesson(PieceType.Unicorn, {
      line: 'Level, file and rank all change, every step.',
      directions: { moves: CORNERS, reach: 'line', caption: '8 directions' },
    }),
  },
  {
    id: 'queen',
    name: 'Queen',
    piece: PieceType.Queen,
    steps: lesson(PieceType.Queen, {
      line: 'Rook, bishop and unicorn combined.',
      directions: { moves: all, reach: 'line', caption: '26 directions' },
    }),
  },
  {
    id: 'king',
    name: 'King',
    piece: PieceType.King,
    steps: lesson(PieceType.King, {
      line: 'One step in any direction.',
      note: 'No castling.',
      directions: { moves: all, reach: 'step', caption: '26 directions' },
    }),
  },
  {
    id: 'knight',
    name: 'Knight',
    piece: PieceType.Knight,
    steps: lesson(PieceType.Knight, {
      line: 'Two squares one way, then one square another.',
      directions: { moves: JUMPS, reach: 'jump', caption: '24 jumps' },
    }),
  },
  {
    id: 'pawn',
    name: 'Pawn',
    piece: PieceType.Pawn,
    steps: [
      {
        label: 'Move',
        line: 'One step forward or one step up, never two.',
        note: "Black's pawns move back and down.",
        pieces: [{ at: 'Cc3', type: PieceType.Pawn, color: 'white' }],
        focus: 'Cc3',
        directions: {
          moves: [
            [0, 1, 0],
            [0, 0, 1],
          ],
          reach: 'step',
          caption: 'Forward or up',
        },
      },
      {
        label: 'Capture',
        line: 'Captures one diagonal step, forward or up.',
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
      },
      {
        label: 'Promote',
        line: 'Promotes on the top level\u2019s far rank.',
        note: 'Black promotes on White\u2019s side: level A, rank 1.',
        // On the far rank already, but two levels short
        pieces: [{ at: 'Cc5', type: PieceType.Pawn, color: 'white' }],
        focus: 'Cc5',
        promotionRow: true,
      },
    ],
  },
];

export const lessonById = (id: string | undefined): Lesson | undefined =>
  LESSONS.find((l) => l.id === id);

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
  /** Where the lesson's piece stands now. */
  focus: Coord;
  lastMove?: LastMove;
}

export const startPractice = (step: LessonStep): Practice => ({
  board: LessonBoard.from(step.pieces),
  focus: fromZXY(step.focus),
});

/** The position after `move`: the piece it moved stays picked up. */
export const practise = (practice: Practice, move: Move): Practice => ({
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
  if (!practice.board.getPiece(practice.focus)) return 0;
  return new Set(practice.board.generateLegalMoves(practice.focus).map((m) => toZXY(m.to))).size;
};
