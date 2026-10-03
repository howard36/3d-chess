import { Board } from '../engine/board';
import type { Move } from '../engine/board';
import { fromZXY, toZXY } from '../engine/coords';
import type { Coord } from '../engine/coords';
import { KNIGHT_VECTORS, PieceType } from '../engine/pieces';
import type { LastMove } from './history';

// The tutorial (/learn): one lesson per piece, each a position on the real
// tower with the piece picked up and its moves ringed, for a player who
// knows chess. The words say only what the board cannot show.

export type LessonId =
  | 'board'
  | 'rook'
  | 'bishop'
  | 'unicorn'
  | 'queen'
  | 'king'
  | 'knight'
  | 'pawn';

/** A direction a piece moves in, as [file, rank, level] steps. */
export type Step = readonly [number, number, number];

export interface LessonStep {
  /** The step's name in the lesson's own switcher (lessons of more than one step). */
  label?: string;
  /** The one line under the lesson's name. */
  line: string;
  /** A few short facts, a phrase each. */
  facts: readonly string[];
  /** Where the pieces stand, as ZXY squares. */
  pieces: readonly { at: string; type: PieceType; color: 'white' | 'black' }[];
  /** The piece kept picked up, its moves ringed; none on a board to look at. */
  focus: string | null;
  /** The directions it moves in, for the little cube beside the words. */
  directions?: {
    moves: readonly Step[];
    /** Directions it only captures in (a pawn's). */
    captures?: readonly Step[];
    /** One step, or as far as the line runs. */
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
  /** The piece its menu entry shows (none for the board). */
  piece: PieceType | null;
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

/** The pieces on a board, as a lesson places them. */
const placed = (board: Board): LessonStep['pieces'] =>
  SQUARES.flatMap((at) => {
    const piece = board.getPiece(at);
    return piece ? [{ at: toZXY(at), ...piece }] : [];
  });

const lone = (type: PieceType) => [{ at: 'Cc3', type, color: 'white' as const }];

export const LESSONS: readonly Lesson[] = [
  {
    id: 'board',
    name: 'Board',
    piece: null,
    steps: [
      {
        line: 'Five boards, stacked. Every piece now moves up and down too.',
        facts: [
          'Levels A–E, bottom to top',
          'Cc3 is level C, file c, rank 3',
          'No castling, en passant or double step',
        ],
        pieces: placed(Board.setupStartingPosition()),
        focus: null,
      },
    ],
  },
  {
    id: 'rook',
    name: 'Rook',
    piece: PieceType.Rook,
    steps: [
      {
        line: 'Straight lines, now straight up and down as well.',
        facts: ['Changes one of level, file, rank'],
        pieces: lone(PieceType.Rook),
        focus: 'Cc3',
        directions: { moves: FACES, reach: 'line', caption: '6 directions' },
      },
    ],
  },
  {
    id: 'bishop',
    name: 'Bishop',
    piece: PieceType.Bishop,
    steps: [
      {
        line: 'Diagonals across a level, and up or down through the levels.',
        facts: ['Changes two of level, file, rank', 'Keeps its colour'],
        pieces: lone(PieceType.Bishop),
        focus: 'Cc3',
        directions: { moves: EDGES, reach: 'line', caption: '12 directions' },
      },
    ],
  },
  {
    id: 'unicorn',
    name: 'Unicorn',
    piece: PieceType.Unicorn,
    isNew: true,
    steps: [
      {
        line: 'The new piece. It slices through the corners of the cube.',
        facts: ['Changes all three, every step', 'Switches colour every step', 'Two a side'],
        pieces: lone(PieceType.Unicorn),
        focus: 'Cc3',
        directions: { moves: CORNERS, reach: 'line', caption: '8 directions' },
      },
    ],
  },
  {
    id: 'queen',
    name: 'Queen',
    piece: PieceType.Queen,
    steps: [
      {
        line: 'Rook, bishop and unicorn in one.',
        facts: ['The most powerful piece by far'],
        pieces: lone(PieceType.Queen),
        focus: 'Cc3',
        directions: { moves: all, reach: 'line', caption: '26 directions' },
      },
    ],
  },
  {
    id: 'king',
    name: 'King',
    piece: PieceType.King,
    steps: [
      {
        line: 'One step any way, to any of 26 neighbours.',
        facts: ['No castling'],
        pieces: lone(PieceType.King),
        focus: 'Cc3',
        directions: { moves: all, reach: 'step', caption: '26 directions' },
      },
    ],
  },
  {
    id: 'knight',
    name: 'Knight',
    piece: PieceType.Knight,
    steps: [
      {
        line: 'Still an L: two squares one way, one square another.',
        facts: ['Any two of level, file, rank', 'Jumps over pieces'],
        pieces: lone(PieceType.Knight),
        focus: 'Cc3',
        directions: { moves: JUMPS, reach: 'jump', caption: '24 jumps' },
      },
    ],
  },
  {
    id: 'pawn',
    name: 'Pawn',
    piece: PieceType.Pawn,
    steps: [
      {
        label: 'Move',
        line: 'One step forward, or one step up.',
        facts: ['No double step', "Black's go back or down"],
        pieces: lone(PieceType.Pawn),
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
        line: 'One step diagonally, always forward or up.',
        facts: ['Forward and to the side', 'Up and to the side', 'Forward and up'],
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
          caption: '5 ways to capture',
        },
      },
      {
        label: 'Promote',
        line: 'Promotes only on the top level’s far rank.',
        facts: ['Rank 5 of level E', 'Unicorn included'],
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
  /** Where the lesson's piece stands now (null on a board only to look at). */
  focus: Coord | null;
  lastMove?: LastMove;
}

export const startPractice = (step: LessonStep): Practice => ({
  board: LessonBoard.from(step.pieces),
  focus: step.focus ? fromZXY(step.focus) : null,
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
  if (!practice.focus || !practice.board.getPiece(practice.focus)) return 0;
  return new Set(practice.board.generateLegalMoves(practice.focus).map((m) => toZXY(m.to))).size;
};
