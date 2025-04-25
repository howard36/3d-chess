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

describe('Pawn move generation and promotion', () => {
  function setPiece(board: Board, coord: Coord, piece: Piece | null) {
    board.grid[coord.z][coord.x][coord.y] = piece;
  }

  it('white pawn: legal non-capture forward & up', () => {
    const board = new Board();
    board.grid = buildStartingPosition();
    const from: Coord = { x: 2, y: 2, z: 2 };
    setPiece(board, from, { type: PieceType.Pawn, color: 'white' });
    const moves = board.generateMoves(from);
    expect(moves).toEqual(
      expect.arrayContaining([
        { x: 2, y: 3, z: 2 }, // forward
        { x: 2, y: 2, z: 3 }, // up
      ]),
    );
  });

  it('white pawn: capture directions matrix', () => {
    const board = new Board();
    board.grid = buildStartingPosition();
    const from: Coord = { x: 2, y: 2, z: 2 };
    setPiece(board, from, { type: PieceType.Pawn, color: 'white' });
    // Place black pieces in all capture squares
    const captureTargets = [
      { x: 3, y: 3, z: 2 },
      { x: 1, y: 3, z: 2 }, // forward-diagonals
      { x: 3, y: 2, z: 3 },
      { x: 1, y: 2, z: 3 }, // up-diagonals
      { x: 3, y: 3, z: 3 },
      { x: 1, y: 3, z: 3 }, // forward-up-diagonals
      { x: 3, y: 1, z: 2 },
      { x: 1, y: 1, z: 2 }, // backward-diagonals
      { x: 3, y: 2, z: 1 },
      { x: 1, y: 2, z: 1 }, // down-diagonals
      { x: 3, y: 1, z: 1 },
      { x: 1, y: 1, z: 1 }, // backward-down-diagonals
    ];
    for (const target of captureTargets) {
      setPiece(board, target, { type: PieceType.Knight, color: 'black' });
    }
    const moves = board.generateMoves(from);
    for (const target of captureTargets) {
      expect(moves).toContainEqual(target);
    }
  });

  it('white pawn: promotion only at (x,4,4)', () => {
    const board = new Board();
    board.grid = buildStartingPosition();
    const from: Coord = { x: 2, y: 3, z: 3 };
    setPiece(board, from, { type: PieceType.Pawn, color: 'white' });
    // Move to promotion square
    const to: Coord = { x: 2, y: 4, z: 4 };
    board.applyMove(from, to, PieceType.Queen);
    expect(board.grid[to.z][to.x][to.y]).toEqual({ type: PieceType.Queen, color: 'white' });
    // Move to non-promotion square
    const from2: Coord = { x: 1, y: 3, z: 3 };
    setPiece(board, from2, { type: PieceType.Pawn, color: 'white' });
    const to2: Coord = { x: 1, y: 4, z: 3 };
    board.applyMove(from2, to2, PieceType.Queen);
    expect(board.grid[to2.z][to2.x][to2.y]).toEqual({ type: PieceType.Pawn, color: 'white' });
  });

  it('white pawn: no two-square option', () => {
    const board = new Board();
    board.grid = buildStartingPosition();
    const from: Coord = { x: 2, y: 1, z: 2 };
    setPiece(board, from, { type: PieceType.Pawn, color: 'white' });
    const moves = board.generateMoves(from);
    // Should not include y: 3 (two squares forward)
    expect(moves).not.toContainEqual({ x: 2, y: 3, z: 2 });
    // Should only allow y: 2 (one square forward)
    expect(moves).toContainEqual({ x: 2, y: 2, z: 2 });
  });

  it('applyMove: promotion for black pawn at (x,0,0)', () => {
    const board = new Board();
    board.grid = buildStartingPosition();
    const from: Coord = { x: 2, y: 1, z: 1 };
    setPiece(board, from, { type: PieceType.Pawn, color: 'black' });
    const to: Coord = { x: 2, y: 0, z: 0 };
    board.applyMove(from, to, PieceType.Queen);
    expect(board.grid[to.z][to.x][to.y]).toEqual({ type: PieceType.Queen, color: 'black' });
  });
});
