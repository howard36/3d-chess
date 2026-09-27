import {
  Piece,
  PieceType,
  ROOK_VECTORS,
  BISHOP_VECTORS,
  UNICORN_VECTORS,
  QUEEN_VECTORS,
  KING_VECTORS,
  KNIGHT_VECTORS,
} from './pieces';
import { Coord, LEVELS, FILES, RANKS, toZXY } from './coords';

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

/** Movement vectors ([dz, dx, dy]) and whether they repeat, for every non-pawn type. */
const MOVEMENT_VECTORS: Record<
  Exclude<PieceType, PieceType.Pawn>,
  { vectors: ReadonlyArray<[number, number, number]>; sliding: boolean }
> = {
  [PieceType.Rook]: { vectors: ROOK_VECTORS, sliding: true },
  [PieceType.Bishop]: { vectors: BISHOP_VECTORS, sliding: true },
  [PieceType.Unicorn]: { vectors: UNICORN_VECTORS, sliding: true },
  [PieceType.Queen]: { vectors: QUEEN_VECTORS, sliding: true },
  [PieceType.King]: { vectors: KING_VECTORS, sliding: false },
  [PieceType.Knight]: { vectors: KNIGHT_VECTORS, sliding: false },
};

export class Board {
  grid: (Piece | null)[][][];

  constructor() {
    // 5x5x5 grid, all null by default
    this.grid = Array.from({ length: LEVELS.length }, () =>
      Array.from({ length: FILES.length }, () =>
        Array.from({ length: RANKS.length }, () => null as Piece | null),
      ),
    );
  }

  isInside(coord: Coord): boolean {
    return (
      coord.z >= 0 &&
      coord.z < LEVELS.length &&
      coord.x >= 0 &&
      coord.x < FILES.length &&
      coord.y >= 0 &&
      coord.y < RANKS.length
    );
  }

  setPiece(coord: Coord, piece: Piece | null): void {
    this.grid[coord.z][coord.x][coord.y] = piece;
  }

  getPiece(coord: Coord): Piece | null {
    return this.grid[coord.z][coord.x][coord.y];
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

    const potentialMoves: Move[] = [];

    if (piece.type === PieceType.Pawn) {
      const dir = piece.color === 'white' ? 1 : -1;

      // Helper to add pawn moves, handling promotions
      const addPawnMove = (to: Coord, isCapture: boolean) => {
        if (!this.isInside(to)) return;
        const targetPiece = this.getPiece(to);

        if (isCapture) {
          if (!targetPiece || targetPiece.color === piece.color) return; // Must capture opponent
        } else {
          if (targetPiece) return; // Cannot move to occupied square
        }

        if (this.isPromotionSquare(to, piece.color)) {
          for (const promotionType of ALL_PROMOTION_TYPES) {
            potentialMoves.push({ from, to, promotion: promotionType });
          }
        } else {
          potentialMoves.push({ from, to, promotion: undefined });
        }
      };

      // Forward (y axis) - non-capture
      const forward: Coord = { x: from.x, y: from.y + dir, z: from.z };
      addPawnMove(forward, false);

      // Up (z axis) - non-capture
      const up: Coord = { x: from.x, y: from.y, z: from.z + dir };
      addPawnMove(up, false);

      for (const [dx, dy, dz] of pawnCaptureDeltas(dir)) {
        const to: Coord = { x: from.x + dx, y: from.y + dy, z: from.z + dz };
        addPawnMove(to, true);
      }
      return potentialMoves;
    }

    // Other pieces (Rook, Bishop, Unicorn, Queen, King, Knight)
    const { vectors, sliding } = MOVEMENT_VECTORS[piece.type];

    for (const [dz, dx, dy] of vectors) {
      let n = 1;
      while (true) {
        const to: Coord = { z: from.z + dz * n, x: from.x + dx * n, y: from.y + dy * n };
        if (!this.isInside(to)) break;

        const targetPiece = this.getPiece(to);
        if (!targetPiece) {
          potentialMoves.push({ from, to, promotion: undefined });
        } else {
          if (targetPiece.color !== piece.color) {
            potentialMoves.push({ from, to, promotion: undefined });
          }
          break; // Blocked by a piece
        }
        if (!sliding) break;
        n++;
      }
    }
    return potentialMoves;
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

  findKing(color: 'white' | 'black'): Coord {
    for (let z = 0; z < LEVELS.length; z++) {
      for (let x = 0; x < FILES.length; x++) {
        for (let y = 0; y < RANKS.length; y++) {
          const piece = this.getPiece({ x, y, z });
          if (piece && piece.type === PieceType.King && piece.color === color) {
            return { x, y, z };
          }
        }
      }
    }
    throw new Error(`King of color ${color} not found`);
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

    const attacked: Coord[] = [];
    if (piece.type === PieceType.Pawn) {
      const dir = piece.color === 'white' ? 1 : -1;
      for (const [dx, dy, dz] of pawnCaptureDeltas(dir)) {
        const to: Coord = { x: from.x + dx, y: from.y + dy, z: from.z + dz };
        if (this.isInside(to)) attacked.push(to);
      }
      return attacked;
    }

    const { vectors, sliding } = MOVEMENT_VECTORS[piece.type];
    for (const [dz, dx, dy] of vectors) {
      let n = 1;
      while (true) {
        const to: Coord = { z: from.z + dz * n, x: from.x + dx * n, y: from.y + dy * n };
        if (!this.isInside(to)) break;
        attacked.push(to);
        if (this.getPiece(to) || !sliding) break;
        n++;
      }
    }
    return attacked;
  }

  /** True if any piece of `byColor` attacks `target` (see generateAttackedSquares). */
  isSquareAttacked(target: Coord, byColor: 'white' | 'black'): boolean {
    for (let z = 0; z < LEVELS.length; z++) {
      for (let x = 0; x < FILES.length; x++) {
        for (let y = 0; y < RANKS.length; y++) {
          const piece = this.getPiece({ x, y, z });
          if (piece && piece.color === byColor) {
            const squares = this.generateAttackedSquares({ x, y, z });
            if (squares.some((c) => c.x === target.x && c.y === target.y && c.z === target.z)) {
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  /**
   * Returns true if the king of the given color is in check.
   */
  inCheck(color: 'white' | 'black'): boolean {
    const kingPos = this.findKing(color);
    const enemyColor = color === 'white' ? 'black' : 'white';
    return this.isSquareAttacked(kingPos, enemyColor);
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

    const legalMovesForPiece: Move[] = [];
    const potentialMoves = this.generatePotentialMoves(from);

    for (const potentialMove of potentialMoves) {
      const newBoard = this.applyMove(potentialMove);
      if (!newBoard.inCheck(piece.color)) {
        legalMovesForPiece.push(potentialMove);
      }
    }
    return legalMovesForPiece;
  }

  /**
   * Generate all legal moves for all pieces of the given color.
   * Returns array of { from, to, promotion? }
   */
  generateAllLegalMoves(color: 'white' | 'black'): Move[] {
    const allLegalMovesForColor: Move[] = [];
    for (let z = 0; z < LEVELS.length; z++) {
      for (let x = 0; x < FILES.length; x++) {
        for (let y = 0; y < RANKS.length; y++) {
          const piece = this.getPiece({ x, y, z });
          if (piece && piece.color === color) {
            const movesForThisPiece = this.generateLegalMoves({ x, y, z });
            allLegalMovesForColor.push(...movesForThisPiece);
          }
        }
      }
    }
    return allLegalMovesForColor;
  }

  /**
   * Returns true if the given color is checkmated.
   */
  isCheckmate(color: 'white' | 'black'): boolean {
    return this.inCheck(color) && this.generateAllLegalMoves(color).length === 0;
  }

  /**
   * Returns true if the given color is stalemated.
   */
  isStalemate(color: 'white' | 'black'): boolean {
    return !this.inCheck(color) && this.generateAllLegalMoves(color).length === 0;
  }

  /**
   * Shallow clone of the board (for move simulation)
   */
  clone(): Board {
    const newBoard = new Board();
    // Deep copy grid (3D array)
    newBoard.grid = this.grid.map((level) => level.map((file) => file.slice()));
    return newBoard;
  }

  /**
   * The starting position: Raumschach's with ranks and levels exchanged, so
   * each army's pawns stand on a level of their own. White holds level A
   * (R N K N R on rank 1, B U Q B U on rank 2) with pawns filling ranks 1 and
   * 2 of level B; Black's army is White's turned through the board's centre,
   * (x, y, z) -> (4 - x, 4 - y, 4 - z), on levels E and D.
   *
   * Every rule treats rank and level alike (the move vectors, the pawn's
   * forward and up steps and its captures, promotion on rank 5 of level E),
   * so this is Raumschach's own game with two axes renamed.
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
