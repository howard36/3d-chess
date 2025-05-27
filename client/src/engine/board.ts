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

const ALL_PROMOTION_TYPES = [
  PieceType.Queen,
  PieceType.Rook,
  PieceType.Bishop,
  PieceType.Knight,
  PieceType.Unicorn,
];

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

      // Captures: 5 specified diagonal directions
      const captureDeltas: [number, number, number][] = [
        [0, dir, dir], // Forwards-Up
        [-1, dir, 0], // Forwards-Left
        [1, dir, 0], // Forwards-Right
        [-1, 0, dir], // Up-Left
        [1, 0, dir], // Up-Right
      ];

      for (const [dx, dy, dz] of captureDeltas) {
        const to: Coord = { x: from.x + dx, y: from.y + dy, z: from.z + dz };
        addPawnMove(to, true);
      }
      return potentialMoves;
    }

    // Other pieces (Rook, Bishop, Unicorn, Queen, King, Knight)
    let vectors: ReadonlyArray<[number, number, number]> = [];
    let sliding = false;
    switch (piece.type) {
      case PieceType.Rook:
        vectors = ROOK_VECTORS;
        sliding = true;
        break;
      case PieceType.Bishop:
        vectors = BISHOP_VECTORS;
        sliding = true;
        break;
      case PieceType.Unicorn:
        vectors = UNICORN_VECTORS;
        sliding = true;
        break;
      case PieceType.Queen:
        vectors = QUEEN_VECTORS;
        sliding = true;
        break;
      case PieceType.King:
        vectors = KING_VECTORS;
        sliding = false;
        break;
      case PieceType.Knight:
        vectors = KNIGHT_VECTORS;
        sliding = false;
        break;
      default:
        throw new Error(`Unknown piece type at ${toZXY(from)}`);
    }

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
    // Promotion logic
    let newPiece = piece;
    if (
      piece.type === PieceType.Pawn &&
      this.isPromotionSquare(to, piece.color) &&
      promotion &&
      promotion !== PieceType.Pawn &&
      promotion !== PieceType.King
    ) {
      newPiece = { type: promotion, color: piece.color };
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

  isSquareAttacked(target: Coord, byColor: 'white' | 'black'): boolean {
    for (let z = 0; z < LEVELS.length; z++) {
      for (let x = 0; x < FILES.length; x++) {
        for (let y = 0; y < RANKS.length; y++) {
          const piece = this.getPiece({ x, y, z });
          if (piece && piece.color === byColor) {
            const fromCoord = { x, y, z };
            const moves = this.generatePotentialMoves(fromCoord);
            if (
              moves.some((m) => m.to.x === target.x && m.to.y === target.y && m.to.z === target.z)
            ) {
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

  static setupStartingPosition(): Board {
    const board = new Board();
    // White Pawns: (x, 1, 0) and (x, 1, 1) for x=0..4
    for (let x = 0; x < 5; x++) {
      board.setPiece({ x, y: 1, z: 0 }, { type: PieceType.Pawn, color: 'white' });
      board.setPiece({ x, y: 1, z: 1 }, { type: PieceType.Pawn, color: 'white' });
    }
    // White Back Rank 1: y=0, z=0
    board.setPiece({ x: 0, y: 0, z: 0 }, { type: PieceType.Rook, color: 'white' });
    board.setPiece({ x: 1, y: 0, z: 0 }, { type: PieceType.Knight, color: 'white' });
    board.setPiece({ x: 2, y: 0, z: 0 }, { type: PieceType.King, color: 'white' });
    board.setPiece({ x: 3, y: 0, z: 0 }, { type: PieceType.Knight, color: 'white' });
    board.setPiece({ x: 4, y: 0, z: 0 }, { type: PieceType.Rook, color: 'white' });
    // White Back Rank 2: y=0, z=1
    board.setPiece({ x: 0, y: 0, z: 1 }, { type: PieceType.Bishop, color: 'white' });
    board.setPiece({ x: 1, y: 0, z: 1 }, { type: PieceType.Unicorn, color: 'white' });
    board.setPiece({ x: 2, y: 0, z: 1 }, { type: PieceType.Queen, color: 'white' });
    board.setPiece({ x: 3, y: 0, z: 1 }, { type: PieceType.Bishop, color: 'white' });
    board.setPiece({ x: 4, y: 0, z: 1 }, { type: PieceType.Unicorn, color: 'white' });
    // Black Pawns: (x, 3, 4) and (x, 3, 3) for x=0..4
    for (let x = 0; x < 5; x++) {
      board.setPiece({ x, y: 3, z: 4 }, { type: PieceType.Pawn, color: 'black' });
      board.setPiece({ x, y: 3, z: 3 }, { type: PieceType.Pawn, color: 'black' });
    }
    // Black Back Rank 1: y=4, z=4
    board.setPiece({ x: 0, y: 4, z: 4 }, { type: PieceType.Rook, color: 'black' });
    board.setPiece({ x: 1, y: 4, z: 4 }, { type: PieceType.Knight, color: 'black' });
    board.setPiece({ x: 2, y: 4, z: 4 }, { type: PieceType.King, color: 'black' });
    board.setPiece({ x: 3, y: 4, z: 4 }, { type: PieceType.Knight, color: 'black' });
    board.setPiece({ x: 4, y: 4, z: 4 }, { type: PieceType.Rook, color: 'black' });
    // Black Back Rank 2: y=4, z=3
    board.setPiece({ x: 0, y: 4, z: 3 }, { type: PieceType.Unicorn, color: 'black' });
    board.setPiece({ x: 1, y: 4, z: 3 }, { type: PieceType.Bishop, color: 'black' });
    board.setPiece({ x: 2, y: 4, z: 3 }, { type: PieceType.Queen, color: 'black' });
    board.setPiece({ x: 3, y: 4, z: 3 }, { type: PieceType.Unicorn, color: 'black' });
    board.setPiece({ x: 4, y: 4, z: 3 }, { type: PieceType.Bishop, color: 'black' });
    return board;
  }
}
