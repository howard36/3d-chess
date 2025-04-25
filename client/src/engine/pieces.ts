export enum PieceType {
  King = 'King',
  Queen = 'Queen',
  Rook = 'Rook',
  Bishop = 'Bishop',
  Knight = 'Knight',
  Unicorn = 'Unicorn',
  Pawn = 'Pawn',
}

export interface Piece {
  type: PieceType;
  color: 'white' | 'black';
}

// Movement vectors for each piece type (3D chess, §2.4)
// Each vector is [dz, dx, dy] (z=level, x=file, y=rank)

export const ROOK_VECTORS: ReadonlyArray<[number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0], // up/down
  [0, 1, 0],
  [0, -1, 0], // right/left
  [0, 0, 1],
  [0, 0, -1], // forward/back
];

export const BISHOP_VECTORS: ReadonlyArray<[number, number, number]> = [
  [1, 1, 0],
  [1, -1, 0],
  [-1, 1, 0],
  [-1, -1, 0],
  [1, 0, 1],
  [1, 0, -1],
  [-1, 0, 1],
  [-1, 0, -1],
  [0, 1, 1],
  [0, 1, -1],
  [0, -1, 1],
  [0, -1, -1],
];

export const UNICORN_VECTORS: ReadonlyArray<[number, number, number]> = [
  [1, 1, 1],
  [1, 1, -1],
  [1, -1, 1],
  [1, -1, -1],
  [-1, 1, 1],
  [-1, 1, -1],
  [-1, -1, 1],
  [-1, -1, -1],
];

export const QUEEN_VECTORS: ReadonlyArray<[number, number, number]> = [
  ...ROOK_VECTORS,
  ...BISHOP_VECTORS,
  ...UNICORN_VECTORS,
];

export const KING_VECTORS = QUEEN_VECTORS;

// Knight: all (±2,±1,0) and permutations, excluding (0,0,0)
export const KNIGHT_VECTORS: ReadonlyArray<[number, number, number]> = (() => {
  const result: [number, number, number][] = [];
  const deltas = [2, 1, 0];
  for (const dz of deltas) {
    for (const dx of deltas) {
      for (const dy of deltas) {
        if (
          Math.abs(dz) + Math.abs(dx) + Math.abs(dy) === 3 &&
          [dz, dx, dy].filter((v) => v !== 0).length === 2
        ) {
          for (const sz of [-1, 1]) {
            for (const sx of [-1, 1]) {
              for (const sy of [-1, 1]) {
                result.push([dz * sz, dx * sx, dy * sy]);
              }
            }
          }
        }
      }
    }
  }
  // Remove duplicates
  return Array.from(new Set(result.map((v) => v.toString()))).map(
    (s) => s.split(',').map(Number) as [number, number, number],
  );
})();

// Pawn movement is handled separately due to color and promotion rules
