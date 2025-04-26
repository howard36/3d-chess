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
import { Coord, LEVELS, FILES, RANKS } from './coords';

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

  generateMoves(from: Coord): Coord[] {
    const piece = this.getPiece(from);
    if (!piece) return [];
    // Pawn logic
    if (piece.type === PieceType.Pawn) {
      const moves: Coord[] = [];
      const dir = piece.color === 'white' ? 1 : -1;
      // Forward (y axis)
      const forward: Coord = { x: from.x, y: from.y + dir, z: from.z };
      if (this.isInside(forward) && !this.getPiece(forward)) {
        moves.push(forward);
      }
      // Up (z axis)
      const up: Coord = { x: from.x, y: from.y, z: from.z + dir };
      if (this.isInside(up) && !this.getPiece(up)) {
        moves.push(up);
      }
      // Captures: 5 specified diagonal directions
      // Spec Section 2.5: Relative to White (dir=1):
      // - Forwards-Up: (0, +1, +1) -> (dx=0, dy=dir, dz=dir)
      // - Forwards-Left: (-1, +1, 0) -> (dx=-1, dy=dir, dz=0)
      // - Forwards-Right: (+1, +1, 0) -> (dx=1, dy=dir, dz=0)
      // - Up-Left: (-1, 0, +1) -> (dx=-1, dy=0, dz=dir)
      // - Up-Right: (+1, 0, +1) -> (dx=1, dy=0, dz=dir)
      const captureDeltas: [number, number, number][] = [
        [0, dir, dir], // Forwards-Up
        [-1, dir, 0], // Forwards-Left
        [1, dir, 0], // Forwards-Right
        [-1, 0, dir], // Up-Left
        [1, 0, dir], // Up-Right
      ];

      // Only allow captures to squares with enemy piece
      for (const [dx, dy, dz] of captureDeltas) {
        const to: Coord = { x: from.x + dx, y: from.y + dy, z: from.z + dz };
        if (this.isInside(to)) {
          const target = this.getPiece(to);
          if (target && target.color !== piece.color) {
            moves.push(to);
          }
        }
      }
      return moves;
    }
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
        return [];
    }
    const moves: Coord[] = [];
    for (const [dz, dx, dy] of vectors) {
      let n = 1;
      while (true) {
        const to: Coord = { z: from.z + dz * n, x: from.x + dx * n, y: from.y + dy * n };
        if (!this.isInside(to)) break;
        const target = this.getPiece(to);
        if (!target) {
          moves.push(to);
        } else {
          if (target.color !== piece.color) moves.push(to);
          break;
        }
        if (!sliding) break;
        n++;
      }
    }
    return moves;
  }

  applyMove(from: Coord, to: Coord, promotion?: PieceType, board: Board = this): void {
    const piece = board.getPiece(from);
    if (!piece) return;
    // Remove from origin
    board.setPiece(from, null);
    // Promotion logic
    let newPiece = piece;
    if (
      piece.type === PieceType.Pawn &&
      ((piece.color === 'white' && to.y === 4 && to.z === 4) ||
        (piece.color === 'black' && to.y === 0 && to.z === 0)) &&
      promotion &&
      promotion !== PieceType.Pawn &&
      promotion !== PieceType.King
    ) {
      newPiece = { type: promotion, color: piece.color };
    }
    board.setPiece(to, newPiece);
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
            const from = { x, y, z };
            const moves = this.generateMoves(from);
            if (moves.some((m) => m.x === target.x && m.y === target.y && m.z === target.z)) {
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
   * Generate all legal moves for the given color.
   * Returns array of { from, to, promotion? }
   */
  generateLegalMoves(
    color: 'white' | 'black',
  ): { from: Coord; to: Coord; promotion?: PieceType }[] {
    const legalMoves: { from: Coord; to: Coord; promotion?: PieceType }[] = [];
    for (let z = 0; z < LEVELS.length; z++) {
      for (let x = 0; x < FILES.length; x++) {
        for (let y = 0; y < RANKS.length; y++) {
          const piece = this.getPiece({ x, y, z });
          if (piece && piece.color === color) {
            const from: Coord = { x, y, z };
            const moves = this.generateMoves(from);
            for (const to of moves) {
              // Handle pawn promotion: if pawn moves to promotion square, generate all valid promotions
              if (
                piece.type === PieceType.Pawn &&
                ((piece.color === 'white' && to.y === 4 && to.z === 4) ||
                  (piece.color === 'black' && to.y === 0 && to.z === 0))
              ) {
                // Try all promotion types except Pawn/King
                for (const promotion of [
                  PieceType.Queen,
                  PieceType.Rook,
                  PieceType.Bishop,
                  PieceType.Knight,
                  PieceType.Unicorn,
                ]) {
                  const clone = this.clone();
                  clone.applyMove(from, to, promotion);
                  if (!clone.inCheck(color)) {
                    legalMoves.push({ from, to, promotion });
                  }
                }
              } else {
                const clone = this.clone();
                clone.applyMove(from, to);
                if (!clone.inCheck(color)) {
                  legalMoves.push({ from, to });
                }
              }
            }
          }
        }
      }
    }
    return legalMoves;
  }

  /**
   * Returns true if the given color is checkmated.
   */
  isCheckmate(color: 'white' | 'black'): boolean {
    return this.inCheck(color) && this.generateLegalMoves(color).length === 0;
  }

  /**
   * Returns true if the given color is stalemated.
   */
  isStalemate(color: 'white' | 'black'): boolean {
    return !this.inCheck(color) && this.generateLegalMoves(color).length === 0;
  }

  /**
   * Returns true if the given color has at least one legal move.
   */
  hasLegalMove(color: 'white' | 'black'): boolean {
    return this.generateLegalMoves(color).length > 0;
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
}
