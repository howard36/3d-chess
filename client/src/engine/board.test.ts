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

  it('knight from corner (0,0,0) has correct moves', () => {
    const board = new Board();
    board.grid = buildStartingPosition(); // Clear board
    const corner: Coord = { x: 0, y: 0, z: 0 };
    setPiece(board, corner, { type: PieceType.Knight, color: 'white' });
    const moves = board.generateMoves(corner);

    // Based on spec (permutations of ±2, ±1, 0) and board bounds (0-4)
    const expectedMoves: Coord[] = [
      // From (0,0,0), only positive displacements are possible
      { x: 2, y: 1, z: 0 }, // (+2, +1, 0)
      { x: 1, y: 2, z: 0 }, // (+1, +2, 0)
      { x: 2, y: 0, z: 1 }, // (+2, 0, +1)
      { x: 0, y: 2, z: 1 }, // (0, +2, +1)
      { x: 1, y: 0, z: 2 }, // (+1, 0, +2)
      { x: 0, y: 1, z: 2 }, // (0, +1, +2)
    ];

    // Check that exactly these moves are generated
    expect(moves).toHaveLength(expectedMoves.length);
    expect(moves).toEqual(expect.arrayContaining(expectedMoves));
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
    // Place black pieces in the 5 valid capture squares
    const captureTargets = [
      { x: 2, y: 3, z: 3 }, // Forwards-Up
      { x: 1, y: 3, z: 2 }, // Forwards-Left
      { x: 3, y: 3, z: 2 }, // Forwards-Right
      { x: 1, y: 2, z: 3 }, // Up-Left
      { x: 3, y: 2, z: 3 }, // Up-Right
    ];
    for (const target of captureTargets) {
      setPiece(board, target, { type: PieceType.Knight, color: 'black' });
    }
    const moves = board.generateMoves(from);
    // Moves should include the 2 non-capture moves + 5 capture moves
    const expectedMoves = [
      { x: 2, y: 3, z: 2 }, // forward
      { x: 2, y: 2, z: 3 }, // up
      ...captureTargets,
    ];
    expect(moves).toHaveLength(expectedMoves.length);
    expect(moves).toEqual(expect.arrayContaining(expectedMoves));
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

describe('Attack map and king locator', () => {
  function setPiece(board: Board, coord: Coord, piece: Piece | null) {
    board.grid[coord.z][coord.x][coord.y] = piece;
  }

  it('findKing locates the correct king', () => {
    const board = new Board();
    board.grid = buildStartingPosition();
    const kingPos: Coord = { x: 1, y: 2, z: 3 };
    setPiece(board, kingPos, { type: PieceType.King, color: 'black' });
    expect(board.findKing('black')).toEqual(kingPos);
  });

  it('isSquareAttacked: single white rook attacks black king', () => {
    const board = new Board();
    board.grid = buildStartingPosition();
    const rook: Coord = { x: 0, y: 0, z: 0 };
    const king: Coord = { x: 0, y: 4, z: 0 };
    setPiece(board, rook, { type: PieceType.Rook, color: 'white' });
    setPiece(board, king, { type: PieceType.King, color: 'black' });
    expect(board.isSquareAttacked(king, 'white')).toBe(true);
    expect(board.isSquareAttacked(rook, 'black')).toBe(false);
  });

  it('isSquareAttacked: knight L-shape in 3D', () => {
    const board = new Board();
    board.grid = buildStartingPosition();
    const knight: Coord = { x: 1, y: 0, z: 0 };
    const king: Coord = { x: 3, y: 1, z: 0 };
    setPiece(board, knight, { type: PieceType.Knight, color: 'white' });
    setPiece(board, king, { type: PieceType.King, color: 'black' });
    expect(board.isSquareAttacked(king, 'white')).toBe(true);
  });

  it('isSquareAttacked: unicorn diagonal attack', () => {
    const board = new Board();
    board.grid = buildStartingPosition();
    const unicorn: Coord = { x: 0, y: 0, z: 0 };
    const king: Coord = { x: 4, y: 4, z: 4 };
    setPiece(board, unicorn, { type: PieceType.Unicorn, color: 'white' });
    setPiece(board, king, { type: PieceType.King, color: 'black' });
    expect(board.isSquareAttacked(king, 'white')).toBe(true);
  });
});
