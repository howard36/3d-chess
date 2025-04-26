import { Board } from './board';
import { PieceType } from './pieces';
import { Coord } from './coords';

describe('Board move generation', () => {
  it('rook from center has 6 ray directions', () => {
    const board = new Board();
    // Place rook at center
    const center: Coord = { x: 2, y: 2, z: 2 };
    board.setPiece(center, { type: PieceType.Rook, color: 'white' });
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
    const corner: Coord = { x: 0, y: 0, z: 0 };
    board.setPiece(corner, { type: PieceType.Knight, color: 'white' });
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
  it('white pawn: legal non-capture forward & up', () => {
    const board = new Board();
    const from: Coord = { x: 2, y: 2, z: 2 };
    board.setPiece(from, { type: PieceType.Pawn, color: 'white' });
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
    const from: Coord = { x: 2, y: 2, z: 2 };
    board.setPiece(from, { type: PieceType.Pawn, color: 'white' });
    // Place black pieces in the 5 valid capture squares
    const captureTargets = [
      { x: 2, y: 3, z: 3 }, // Forwards-Up
      { x: 1, y: 3, z: 2 }, // Forwards-Left
      { x: 3, y: 3, z: 2 }, // Forwards-Right
      { x: 1, y: 2, z: 3 }, // Up-Left
      { x: 3, y: 2, z: 3 }, // Up-Right
    ];
    for (const target of captureTargets) {
      board.setPiece(target, { type: PieceType.Knight, color: 'black' });
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
    const from: Coord = { x: 2, y: 3, z: 3 };
    board.setPiece(from, { type: PieceType.Pawn, color: 'white' });
    // Move to promotion square
    const to: Coord = { x: 2, y: 4, z: 4 };
    board.applyMove(from, to, PieceType.Queen);
    expect(board.getPiece(to)).toEqual({ type: PieceType.Queen, color: 'white' });
    // Move to non-promotion square
    const from2: Coord = { x: 1, y: 3, z: 3 };
    board.setPiece(from2, { type: PieceType.Pawn, color: 'white' });
    const to2: Coord = { x: 1, y: 4, z: 3 };
    board.applyMove(from2, to2, PieceType.Queen);
    expect(board.getPiece(to2)).toEqual({ type: PieceType.Pawn, color: 'white' });
  });

  it('white pawn: no two-square option', () => {
    const board = new Board();
    const from: Coord = { x: 2, y: 1, z: 2 };
    board.setPiece(from, { type: PieceType.Pawn, color: 'white' });
    const moves = board.generateMoves(from);
    // Should not include y: 3 (two squares forward)
    expect(moves).not.toContainEqual({ x: 2, y: 3, z: 2 });
    // Should only allow y: 2 (one square forward)
    expect(moves).toContainEqual({ x: 2, y: 2, z: 2 });
  });

  it('applyMove: promotion for black pawn at (x,0,0)', () => {
    const board = new Board();
    const from: Coord = { x: 2, y: 1, z: 1 };
    board.setPiece(from, { type: PieceType.Pawn, color: 'black' });
    const to: Coord = { x: 2, y: 0, z: 0 };
    board.applyMove(from, to, PieceType.Queen);
    expect(board.getPiece(to)).toEqual({ type: PieceType.Queen, color: 'black' });
  });
});

describe('Attack map and king locator', () => {
  it('findKing locates the correct king', () => {
    const board = new Board();
    const kingPos: Coord = { x: 1, y: 2, z: 3 };
    board.setPiece(kingPos, { type: PieceType.King, color: 'black' });
    expect(board.findKing('black')).toEqual(kingPos);
  });

  it('isSquareAttacked: single white rook attacks black king', () => {
    const board = new Board();
    const rook: Coord = { x: 0, y: 0, z: 0 };
    const king: Coord = { x: 0, y: 4, z: 0 };
    board.setPiece(rook, { type: PieceType.Rook, color: 'white' });
    board.setPiece(king, { type: PieceType.King, color: 'black' });
    expect(board.isSquareAttacked(king, 'white')).toBe(true);
    expect(board.isSquareAttacked(rook, 'black')).toBe(false);
  });

  it('isSquareAttacked: knight L-shape in 3D', () => {
    const board = new Board();
    const knight: Coord = { x: 1, y: 0, z: 0 };
    const king: Coord = { x: 3, y: 1, z: 0 };
    board.setPiece(knight, { type: PieceType.Knight, color: 'white' });
    board.setPiece(king, { type: PieceType.King, color: 'black' });
    expect(board.isSquareAttacked(king, 'white')).toBe(true);
  });

  it('isSquareAttacked: unicorn diagonal attack', () => {
    const board = new Board();
    const unicorn: Coord = { x: 0, y: 0, z: 0 };
    const king: Coord = { x: 4, y: 4, z: 4 };
    board.setPiece(unicorn, { type: PieceType.Unicorn, color: 'white' });
    board.setPiece(king, { type: PieceType.King, color: 'black' });
    expect(board.isSquareAttacked(king, 'white')).toBe(true);
  });
});

// --- inCheck tests ---
describe('inCheck', () => {
  it('rook attacks king: black in check, white not', () => {
    const board = new Board();
    const rook: Coord = { x: 0, y: 0, z: 0 };
    const blackKing: Coord = { x: 0, y: 4, z: 0 };
    const whiteKing: Coord = { x: 4, y: 4, z: 4 };
    board.setPiece(rook, { type: PieceType.Rook, color: 'white' });
    board.setPiece(blackKing, { type: PieceType.King, color: 'black' });
    board.setPiece(whiteKing, { type: PieceType.King, color: 'white' });
    expect(board.inCheck('black')).toBe(true);
    expect(board.inCheck('white')).toBe(false);
  });

  it('only two kings: neither in check', () => {
    const board = new Board();
    // Clear board
    for (let z = 0; z < 5; z++)
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) board.setPiece({ x, y, z }, null);
    const blackKing: Coord = { x: 0, y: 0, z: 0 };
    const whiteKing: Coord = { x: 4, y: 4, z: 4 };
    board.setPiece(blackKing, { type: PieceType.King, color: 'black' });
    board.setPiece(whiteKing, { type: PieceType.King, color: 'white' });
    expect(board.inCheck('black')).toBe(false);
    expect(board.inCheck('white')).toBe(false);
  });
});

describe('generateLegalMoves', () => {
  it('excludes illegal moves for a pinned piece (rook can only move along pin line)', () => {
    const board = new Board();
    // Place black king at (0,0,0), white rook at (0,0,4), black rook at (0,0,2)
    const blackKing: Coord = { x: 0, y: 0, z: 0 };
    const whiteRook: Coord = { x: 0, y: 0, z: 4 };
    const blackRook: Coord = { x: 0, y: 0, z: 2 };
    board.setPiece(blackKing, { type: PieceType.King, color: 'black' });
    board.setPiece(whiteRook, { type: PieceType.Rook, color: 'white' });
    board.setPiece(blackRook, { type: PieceType.Rook, color: 'black' });
    // The black rook is pinned and can only move along the z-axis between king and attacker
    const legalMoves = board.generateLegalMoves('black');
    const rookMoves = legalMoves.filter((m) => m.from.x === 0 && m.from.y === 0 && m.from.z === 2);
    // All rook moves must stay on (0,0,*) and not move off the line
    expect(rookMoves.length).toBeGreaterThan(0);
    for (const move of rookMoves) {
      expect(move.to.x).toBe(0);
      expect(move.to.y).toBe(0);
      // Must be between king and attacker (z=1,3,4)
      expect([1, 3, 4]).toContain(move.to.z);
    }
  });

  it('black king in corner has only one legal move due to two white rooks defending each other', () => {
    const board = new Board();
    // Place black king at (0,0,0)
    const blackKing: Coord = { x: 0, y: 0, z: 0 };
    // Place white rooks at (1,1,0) and (1,1,1)
    const whiteRook1: Coord = { x: 1, y: 1, z: 0 };
    const whiteRook2: Coord = { x: 1, y: 1, z: 1 };
    board.setPiece(blackKing, { type: PieceType.King, color: 'black' });
    board.setPiece(whiteRook1, { type: PieceType.Rook, color: 'white' });
    board.setPiece(whiteRook2, { type: PieceType.Rook, color: 'white' });

    // The only legal move for the black king is to (0,0,1)
    const legalMoves = board.generateLegalMoves('black');
    expect(legalMoves).toHaveLength(1);
    expect(legalMoves[0].from).toEqual({ x: 0, y: 0, z: 0 });
    expect(legalMoves[0].to).toEqual({ x: 0, y: 0, z: 1 });
  });
});

describe('3-D checkmate & stalemate scenarios', () => {
  it('Simple 3-D corner mate: black king at (4,4,4) is checkmated', () => {
    const board = new Board();
    // White: queen at (4,4,3), rook at (3,4,4), king at (0,0,0)
    board.setPiece({ x: 4, y: 4, z: 3 }, { type: PieceType.Queen, color: 'white' });
    // Defend the checking queen so capturing it is illegal
    board.setPiece({ x: 4, y: 4, z: 2 }, { type: PieceType.Rook, color: 'white' });
    board.setPiece({ x: 0, y: 0, z: 0 }, { type: PieceType.King, color: 'white' });
    // Black: king at (4,4,4)
    board.setPiece({ x: 4, y: 4, z: 4 }, { type: PieceType.King, color: 'black' });
    expect(board.isCheckmate('black')).toBe(true);
  });

  it("Classic 2-D Fool's-mate analogue is NOT mate in 3-D (king escapes vertically)", () => {
    const board = new Board();
    // Place black king at (4,0,0) (E a 1)
    board.setPiece({ x: 0, y: 0, z: 4 }, { type: PieceType.King, color: 'black' });
    // Place white queen at (4,1,1) (E b 2), white bishop at (2,2,2) (C c 3)
    board.setPiece({ x: 1, y: 1, z: 4 }, { type: PieceType.Queen, color: 'white' });
    board.setPiece({ x: 2, y: 2, z: 2 }, { type: PieceType.Bishop, color: 'white' });
    // Place white king far away
    board.setPiece({ x: 0, y: 4, z: 0 }, { type: PieceType.King, color: 'white' });
    // Black king should NOT be checkmated (can escape to (4,0,1))
    expect(board.isCheckmate('black')).toBe(false);
    // Should be in check, but not mate
    expect(board.inCheck('black')).toBe(true);
  });

  it('Stalemate box: black king at (0,0,0) is stalemated', () => {
    const board = new Board();
    // Black king at (0,0,0)
    board.setPiece({ x: 0, y: 0, z: 0 }, { type: PieceType.King, color: 'black' });
    // White king far away
    board.setPiece({ x: 4, y: 4, z: 4 }, { type: PieceType.King, color: 'white' });
    // White rooks seal last moves: (1,1,0), (1,0,1), (0,1,1), and (1,1,1)
    board.setPiece({ x: 1, y: 1, z: 0 }, { type: PieceType.Rook, color: 'white' });
    board.setPiece({ x: 1, y: 0, z: 1 }, { type: PieceType.Rook, color: 'white' });
    board.setPiece({ x: 0, y: 1, z: 1 }, { type: PieceType.Rook, color: 'white' });
    board.setPiece({ x: 1, y: 1, z: 1 }, { type: PieceType.Rook, color: 'white' });
    expect(board.isStalemate('black')).toBe(true);
  });
});

describe('Board cloning', () => {
  it('modifying a clone does not affect the original board', () => {
    const board = new Board();
    const from = { x: 0, y: 1, z: 0 };
    const to = { x: 0, y: 2, z: 0 };
    // Place a white pawn at from
    board.setPiece(from, { type: PieceType.Pawn, color: 'white' });
    // Clone the board
    const clone = board.clone();
    // Make a move on the clone
    clone.applyMove(from, to);
    // The original board should still have the pawn at 'from' and not at 'to'
    expect(board.getPiece(from)).toEqual({ type: PieceType.Pawn, color: 'white' });
    expect(board.getPiece(to)).toBeNull();
    // The clone should have the pawn at 'to' and not at 'from'
    expect(clone.getPiece(from)).toBeNull();
    expect(clone.getPiece(to)).toEqual({ type: PieceType.Pawn, color: 'white' });
  });
});
