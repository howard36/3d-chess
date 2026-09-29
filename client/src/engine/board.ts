import {
  Piece,
  PieceType,
  ROOK_VECTORS,
  BISHOP_VECTORS,
  QUEEN_VECTORS,
  KING_VECTORS,
  KNIGHT_VECTORS,
} from './pieces';
import { Coord, LEVELS, RANKS, toZXY } from './coords';

export type Move = { from: Coord; to: Coord; promotion?: PieceType };

export const ALL_PROMOTION_TYPES = [
  PieceType.Queen,
  PieceType.Rook,
  PieceType.Bishop,
  PieceType.Knight,
  PieceType.Unicorn,
];

/** A pawn's five capture directions, as [dx, dy, dz] for a pawn moving in `dir`. */
const pawnCaptureDeltas = (dir: number): [number, number, number][] => [
  [0, dir, dir], // Forwards-Up
  [-1, dir, 0], // Forwards-Left
  [1, dir, 0], // Forwards-Right
  [-1, 0, dir], // Up-Left
  [1, 0, dir], // Up-Right
];

// The board is one array of 125 cells, cell z * 25 + x * 5 + y, so walking
// the cells in order visits squares level by level, file by file, rank by
// rank (the order every move list comes out in). What each piece could reach
// from each cell is worked out once, below, as lists of cells.

const SIZE = LEVELS.length; // the board is a cube: as many files and ranks as levels
const CELLS = SIZE * SIZE * SIZE;
const cellOf = (x: number, y: number, z: number) => z * SIZE * SIZE + x * SIZE + y;
const inBoard = (x: number, y: number, z: number) =>
  x >= 0 && x < SIZE && y >= 0 && y < SIZE && z >= 0 && z < SIZE;
const CX: number[] = [];
const CY: number[] = [];
const CZ: number[] = [];
for (let z = 0; z < SIZE; z++)
  for (let x = 0; x < SIZE; x++)
    for (let y = 0; y < SIZE; y++) {
      CX.push(x);
      CY.push(y);
      CZ.push(z);
    }
const coordOf = (cell: number): Coord => ({ x: CX[cell], y: CY[cell], z: CZ[cell] });

/**
 * RAYS[cell][d]: the cells along QUEEN_VECTORS[d] from `cell`, nearest first.
 * The rook's directions are the first 6, the bishop's the next 12 and the
 * unicorn's the last 8 (QUEEN_VECTORS is the three in that order).
 */
const RAYS: number[][][] = [];
/** KNIGHT_JUMPS[cell]: the cells a knight reaches, in KNIGHT_VECTORS order. */
const KNIGHT_JUMPS: number[][] = [];
/** PAWN_CAPTURES[colour][cell]: a pawn's capture cells, in pawnCaptureDeltas order. */
const PAWN_CAPTURES: Record<'white' | 'black', number[][]> = { white: [], black: [] };
/** PAWN_ATTACKERS[colour][cell]: the cells a pawn of that colour attacks `cell` from. */
const PAWN_ATTACKERS: Record<'white' | 'black', number[][]> = { white: [], black: [] };
for (let c = 0; c < CELLS; c++) {
  const x = CX[c];
  const y = CY[c];
  const z = CZ[c];
  RAYS.push(
    QUEEN_VECTORS.map(([dz, dx, dy]) => {
      const ray: number[] = [];
      for (let n = 1; inBoard(x + dx * n, y + dy * n, z + dz * n); n++)
        ray.push(cellOf(x + dx * n, y + dy * n, z + dz * n));
      return ray;
    }),
  );
  KNIGHT_JUMPS.push(
    KNIGHT_VECTORS.filter(([dz, dx, dy]) => inBoard(x + dx, y + dy, z + dz)).map(([dz, dx, dy]) =>
      cellOf(x + dx, y + dy, z + dz),
    ),
  );
  for (const [color, dir] of [
    ['white', 1],
    ['black', -1],
  ] as const) {
    const deltas = pawnCaptureDeltas(dir);
    PAWN_CAPTURES[color].push(
      deltas
        .filter(([dx, dy, dz]) => inBoard(x + dx, y + dy, z + dz))
        .map(([dx, dy, dz]) => cellOf(x + dx, y + dy, z + dz)),
    );
    PAWN_ATTACKERS[color].push(
      deltas
        .filter(([dx, dy, dz]) => inBoard(x - dx, y - dy, z - dz))
        .map(([dx, dy, dz]) => cellOf(x - dx, y - dy, z - dz)),
    );
  }
}
/** The slider that moves along each of QUEEN_VECTORS besides the queen. */
const SLIDER = QUEEN_VECTORS.map((_, d) =>
  d < ROOK_VECTORS.length
    ? PieceType.Rook
    : d < ROOK_VECTORS.length + BISHOP_VECTORS.length
      ? PieceType.Bishop
      : PieceType.Unicorn,
);

/** The directions (indices into QUEEN_VECTORS) each non-pawn type moves along. */
const DIRECTIONS: Record<
  Exclude<PieceType, PieceType.Pawn | PieceType.Knight>,
  { from: number; to: number; sliding: boolean }
> = {
  [PieceType.Rook]: { from: 0, to: ROOK_VECTORS.length, sliding: true },
  [PieceType.Bishop]: {
    from: ROOK_VECTORS.length,
    to: ROOK_VECTORS.length + BISHOP_VECTORS.length,
    sliding: true,
  },
  [PieceType.Unicorn]: {
    from: ROOK_VECTORS.length + BISHOP_VECTORS.length,
    to: QUEEN_VECTORS.length,
    sliding: true,
  },
  [PieceType.Queen]: { from: 0, to: QUEEN_VECTORS.length, sliding: true },
  [PieceType.King]: { from: 0, to: KING_VECTORS.length, sliding: false },
};

type Color = 'white' | 'black';

export class Board {
  /** The pieces by cell (see cellOf). */
  private cells: (Piece | null)[];

  constructor() {
    this.cells = new Array<Piece | null>(CELLS).fill(null);
  }

  isInside(coord: Coord): boolean {
    return inBoard(coord.x, coord.y, coord.z);
  }

  setPiece(coord: Coord, piece: Piece | null): void {
    this.cells[cellOf(coord.x, coord.y, coord.z)] = piece;
  }

  getPiece(coord: Coord): Piece | null {
    return this.cells[cellOf(coord.x, coord.y, coord.z)];
  }

  isPromotionSquare(coord: Coord, color: 'white' | 'black'): boolean {
    return (
      (color === 'white' && coord.y === RANKS.length - 1 && coord.z === LEVELS.length - 1) ||
      (color === 'black' && coord.y === 0 && coord.z === 0)
    );
  }

  generatePotentialMoves(from: Coord): Move[] {
    const piece = this.getPiece(from);
    if (!piece) throw new Error(`No piece at ${toZXY(from)}`);
    const moves: Move[] = [];
    const cells = this.cells;
    const color = piece.color;
    const add = (to: number) => moves.push({ from, to: coordOf(to), promotion: undefined });

    if (piece.type === PieceType.Pawn) {
      const dir = color === 'white' ? 1 : -1;
      // Pawn moves, handling promotions
      const addPawnMove = (to: number) => {
        const toCoord = coordOf(to);
        if (this.isPromotionSquare(toCoord, color)) {
          for (const promotion of ALL_PROMOTION_TYPES) moves.push({ from, to: toCoord, promotion });
        } else {
          moves.push({ from, to: toCoord, promotion: undefined });
        }
      };
      // Forward (y axis), then up (z axis): non-captures, onto an empty square
      if (inBoard(from.x, from.y + dir, from.z)) {
        const to = cellOf(from.x, from.y + dir, from.z);
        if (!cells[to]) addPawnMove(to);
      }
      if (inBoard(from.x, from.y, from.z + dir)) {
        const to = cellOf(from.x, from.y, from.z + dir);
        if (!cells[to]) addPawnMove(to);
      }
      // Captures: an opponent's piece only
      for (const to of PAWN_CAPTURES[color][cellOf(from.x, from.y, from.z)]) {
        const target = cells[to];
        if (target && target.color !== color) addPawnMove(to);
      }
      return moves;
    }

    const at = cellOf(from.x, from.y, from.z);
    if (piece.type === PieceType.Knight) {
      for (const to of KNIGHT_JUMPS[at]) {
        const target = cells[to];
        if (!target || target.color !== color) add(to);
      }
      return moves;
    }
    // Rook, Bishop, Unicorn, Queen, King: along rays, stopping at a piece
    const { from: d0, to: d1, sliding } = DIRECTIONS[piece.type];
    const rays = RAYS[at];
    for (let d = d0; d < d1; d++) {
      const ray = rays[d];
      const reach = sliding ? ray.length : Math.min(1, ray.length);
      for (let n = 0; n < reach; n++) {
        const target = cells[ray[n]];
        if (!target) {
          add(ray[n]);
          continue;
        }
        if (target.color !== color) add(ray[n]);
        break; // Blocked by a piece
      }
    }
    return moves;
  }

  applyMove(move: Move): Board {
    const { from, to, promotion } = move;
    const piece = this.getPiece(from);
    if (!piece) throw new Error(`No piece at ${toZXY(from)}`);

    // Create a new board with the move applied
    const newBoard = this.clone();

    // Remove from origin
    newBoard.setPiece(from, null);
    // Promotion logic: promotion is mandatory (and only valid) when a pawn
    // reaches a promotion square, and must be one of ALL_PROMOTION_TYPES.
    let newPiece = piece;
    if (piece.type === PieceType.Pawn && this.isPromotionSquare(to, piece.color)) {
      if (!promotion || !ALL_PROMOTION_TYPES.includes(promotion)) {
        throw new Error(
          `Pawn moving to promotion square ${toZXY(to)} requires a valid promotion, got: ${promotion}`,
        );
      }
      newPiece = { type: promotion, color: piece.color };
    } else if (promotion !== undefined) {
      throw new Error(
        `Move ${toZXY(from)} -> ${toZXY(to)} is not a pawn promotion but has promotion: ${promotion}`,
      );
    }
    newBoard.setPiece(to, newPiece);

    return newBoard;
  }

  /** The cell of the first king of `color` in cell order. */
  private kingCell(color: Color): number {
    const cells = this.cells;
    for (let c = 0; c < CELLS; c++) {
      const piece = cells[c];
      if (piece && piece.type === PieceType.King && piece.color === color) return c;
    }
    throw new Error(`King of color ${color} not found`);
  }

  findKing(color: 'white' | 'black'): Coord {
    return coordOf(this.kingCell(color));
  }

  /**
   * Squares the piece at `from` attacks: every square it could capture on if
   * an enemy piece stood there. Differs from generatePotentialMoves in two
   * ways that matter for check detection on arbitrary squares: a pawn attacks
   * its capture squares whether or not they are occupied (and never the
   * square it steps to), and a ray counts the first piece it hits whatever
   * its colour (a friendly piece there is defended).
   */
  generateAttackedSquares(from: Coord): Coord[] {
    const piece = this.getPiece(from);
    if (!piece) throw new Error(`No piece at ${toZXY(from)}`);
    const at = cellOf(from.x, from.y, from.z);
    if (piece.type === PieceType.Pawn) return PAWN_CAPTURES[piece.color][at].map(coordOf);
    if (piece.type === PieceType.Knight) return KNIGHT_JUMPS[at].map(coordOf);
    const attacked: Coord[] = [];
    const { from: d0, to: d1, sliding } = DIRECTIONS[piece.type];
    for (let d = d0; d < d1; d++) {
      for (const to of RAYS[at][d]) {
        attacked.push(coordOf(to));
        if (this.cells[to] || !sliding) break;
      }
    }
    return attacked;
  }

  /**
   * True if any piece of `byColor` attacks the cell (as generateAttackedSquares
   * counts attacks). Looks outward from the cell instead of at every piece:
   * along each direction the first piece met attacks it if it moves that way
   * (the queen always, the king from one step), then the knights' and pawns'
   * squares.
   */
  private attacks(target: number, byColor: Color): boolean {
    const cells = this.cells;
    const rays = RAYS[target];
    for (let d = 0; d < rays.length; d++) {
      const ray = rays[d];
      for (let n = 0; n < ray.length; n++) {
        const piece = cells[ray[n]];
        if (!piece) continue;
        if (piece.color === byColor) {
          const type = piece.type;
          if (
            type === PieceType.Queen ||
            type === SLIDER[d] ||
            (n === 0 && type === PieceType.King)
          )
            return true;
        }
        break;
      }
    }
    for (const from of KNIGHT_JUMPS[target]) {
      const piece = cells[from];
      if (piece && piece.type === PieceType.Knight && piece.color === byColor) return true;
    }
    for (const from of PAWN_ATTACKERS[byColor][target]) {
      const piece = cells[from];
      if (piece && piece.type === PieceType.Pawn && piece.color === byColor) return true;
    }
    return false;
  }

  /** True if any piece of `byColor` attacks `target` (see generateAttackedSquares). */
  isSquareAttacked(target: Coord, byColor: 'white' | 'black'): boolean {
    return this.attacks(cellOf(target.x, target.y, target.z), byColor);
  }

  /**
   * Returns true if the king of the given color is in check.
   */
  inCheck(color: 'white' | 'black'): boolean {
    return this.attacks(this.kingCell(color), color === 'white' ? 'black' : 'white');
  }

  /**
   * Whether `move` (one of the piece's potential moves) leaves the mover's
   * king safe: played on this board and taken back, instead of on a copy.
   * `king` is the mover's king's cell before the move.
   */
  private isSafe(move: Move, piece: Piece, king: number): boolean {
    const cells = this.cells;
    const from = cellOf(move.from.x, move.from.y, move.from.z);
    const to = cellOf(move.to.x, move.to.y, move.to.z);
    const taken = cells[to];
    cells[from] = null;
    cells[to] = move.promotion ? { type: move.promotion, color: piece.color } : piece;
    try {
      // A king that moves takes the check test with it (and with two kings,
      // the first in cell order is the one tested, as findKing would say)
      const at = piece.type === PieceType.King ? this.kingCell(piece.color) : king;
      return !this.attacks(at, piece.color === 'white' ? 'black' : 'white');
    } finally {
      cells[to] = taken;
      cells[from] = piece;
    }
  }

  /**
   * Generate all legal moves for the piece at the given 'from' coordinate.
   * Returns an array of legal Move objects.
   * Throws an error if no piece is at the specified 'from' coordinate.
   */
  generateLegalMoves(from: Coord): Move[] {
    const piece = this.getPiece(from);
    if (!piece) {
      throw new Error(`No piece at ${toZXY(from)} to generate legal moves for.`);
    }
    const potentialMoves = this.generatePotentialMoves(from);
    if (potentialMoves.length === 0) return potentialMoves;
    const king = this.kingCell(piece.color);
    return potentialMoves.filter((move) => this.isSafe(move, piece, king));
  }

  /**
   * Generate all legal moves for all pieces of the given color.
   * Returns array of { from, to, promotion? }
   */
  generateAllLegalMoves(color: 'white' | 'black'): Move[] {
    const allLegalMovesForColor: Move[] = [];
    for (let c = 0; c < CELLS; c++) {
      const piece = this.cells[c];
      if (piece && piece.color === color) {
        allLegalMovesForColor.push(...this.generateLegalMoves(coordOf(c)));
      }
    }
    return allLegalMovesForColor;
  }

  /** Whether the given color has any legal move (stops at the first). */
  hasLegalMove(color: 'white' | 'black'): boolean {
    let king = -1;
    for (let c = 0; c < CELLS; c++) {
      const piece = this.cells[c];
      if (!piece || piece.color !== color) continue;
      const moves = this.generatePotentialMoves(coordOf(c));
      if (moves.length === 0) continue;
      if (king < 0) king = this.kingCell(color);
      for (const move of moves) if (this.isSafe(move, piece, king)) return true;
    }
    return false;
  }

  /**
   * Returns true if the given color is checkmated.
   */
  isCheckmate(color: 'white' | 'black'): boolean {
    return this.inCheck(color) && !this.hasLegalMove(color);
  }

  /**
   * Returns true if the given color is stalemated.
   */
  isStalemate(color: 'white' | 'black'): boolean {
    return !this.inCheck(color) && !this.hasLegalMove(color);
  }

  /**
   * Copy of the board (for move simulation); the pieces themselves are shared.
   */
  clone(): Board {
    const newBoard = new Board();
    newBoard.cells = this.cells.slice();
    return newBoard;
  }

  /**
   * The starting position: the traditional 5×5×5 set-up with ranks and levels
   * exchanged, so each army's pawns stand on a level of their own. White
   * holds level A (R N K N R on rank 1, B U Q B U on rank 2) with pawns
   * filling ranks 1 and 2 of level B; Black's army is White's turned through
   * the board's centre, (x, y, z) -> (4 - x, 4 - y, 4 - z), on levels E and D.
   *
   * Every rule treats rank and level alike (the move vectors, the pawn's
   * forward and up steps and its captures, promotion on rank 5 of level E),
   * so this is the traditional game with two axes renamed.
   */
  static setupStartingPosition(): Board {
    const board = new Board();
    const firstRank = [
      PieceType.Rook,
      PieceType.Knight,
      PieceType.King,
      PieceType.Knight,
      PieceType.Rook,
    ];
    const secondRank = [
      PieceType.Bishop,
      PieceType.Unicorn,
      PieceType.Queen,
      PieceType.Bishop,
      PieceType.Unicorn,
    ];
    const place = (x: number, y: number, z: number, type: PieceType) => {
      board.setPiece({ x, y, z }, { type, color: 'white' });
      board.setPiece({ x: 4 - x, y: 4 - y, z: 4 - z }, { type, color: 'black' });
    };
    for (let x = 0; x < 5; x++) {
      place(x, 0, 0, firstRank[x]);
      place(x, 1, 0, secondRank[x]);
      place(x, 0, 1, PieceType.Pawn);
      place(x, 1, 1, PieceType.Pawn);
    }
    return board;
  }
}
