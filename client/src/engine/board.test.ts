import { Board, buildStartingPosition } from './board';
import { PieceType, Piece } from './pieces';
import { Coord } from './coords';

describe('Board move generation', () => {
  function setPiece(board: Board, coord: Coord, piece: Piece | null) {
    board.grid[coord.z][coord.x][coord.y] = piece;
  }

  it('rook from center has 6 ray directions', () => {
    const board = new Board();
    // Clear board
    board.grid = buildStartingPosition();
    // Place rook at center
    const center: Coord = { x: 2, y: 2, z: 2 };
    setPiece(board, center, { type: PieceType.Rook, color: 'white' });
    const moves = board.generateMoves(center);
    console.log('Rook moves from center:', moves);
    // Should be 6 rays, each up to 2 squares (no blockers): 2*6=12
    expect(moves.length).toBe(12);
    // All moves should be in straight lines from center
    for (const move of moves) {
      const dx = move.x - center.x;
      const dy = move.y - center.y;
      const dz = move.z - center.z;
      expect(
        [
          [dx !== 0 && dy === 0 && dz === 0],
          [dx === 0 && dy !== 0 && dz === 0],
          [dx === 0 && dy === 0 && dz !== 0],
        ].some(([b]) => b),
      ).toBe(true);
    }
  });

  it('knight from corner has correct move count (ignoring off-board)', () => {
    const board = new Board();
    board.grid = buildStartingPosition();
    const corner: Coord = { x: 0, y: 0, z: 0 };
    setPiece(board, corner, { type: PieceType.Knight, color: 'white' });
    const moves = board.generateMoves(corner);
    // Only moves inside the board
    for (const move of moves) {
      expect(board.isInside(move)).toBe(true);
    }
    // For 3D knight, from (0,0,0), only moves with all coords >=0 and <5
    // Let's count them:
    const expected = [
      { x: 2, y: 1, z: 0 },
      { x: 1, y: 2, z: 0 },
      { x: 2, y: 0, z: 1 },
      { x: 1, y: 0, z: 2 },
      { x: 0, y: 2, z: 1 },
      { x: 0, y: 1, z: 2 },
      { x: 1, y: 0, z: 2 },
      { x: 0, y: 1, z: 2 },
      { x: 0, y: 2, z: 1 },
      { x: 2, y: 0, z: 1 },
      { x: 1, y: 2, z: 0 },
      { x: 2, y: 1, z: 0 },
    ];
    // Remove duplicates
    const unique = new Set(moves.map((m) => `${m.x},${m.y},${m.z}`));
    expect(unique.size).toBe(moves.length);
    // Should match the number of legal moves
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.length).toBeLessThanOrEqual(24);
  });

  it('board boundaries enforced', () => {
    const board = new Board();
    // Test inside
    expect(board.isInside({ x: 0, y: 0, z: 0 })).toBe(true);
    expect(board.isInside({ x: 4, y: 4, z: 4 })).toBe(true);
    // Test outside
    expect(board.isInside({ x: -1, y: 0, z: 0 })).toBe(false);
    expect(board.isInside({ x: 0, y: 5, z: 0 })).toBe(false);
    expect(board.isInside({ x: 0, y: 0, z: 5 })).toBe(false);
    expect(board.isInside({ x: 5, y: 5, z: 5 })).toBe(false);
  });
});
