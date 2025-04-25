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

// Helper to build the starting position (stub for now)
export function buildStartingPosition(): (Piece | null)[][][] {
  // 5x5x5 grid, all null for now (to be filled in later)
  return Array.from({ length: LEVELS.length }, () =>
    Array.from({ length: FILES.length }, () =>
      Array.from({ length: RANKS.length }, () => null as Piece | null),
    ),
  );
}

export class Board {
  grid: (Piece | null)[][][];

  constructor() {
    this.grid = buildStartingPosition();
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

  generateMoves(from: Coord): Coord[] {
    const piece = this.grid[from.z][from.x][from.y];
    if (!piece || piece.type === PieceType.Pawn) return [];
    const moves: Coord[] = [];
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
    for (const [dz, dx, dy] of vectors) {
      let n = 1;
      while (true) {
        const to: Coord = { z: from.z + dz * n, x: from.x + dx * n, y: from.y + dy * n };
        if (!this.isInside(to)) break;
        const target = this.grid[to.z][to.x][to.y];
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
}
