import { ALL_PROMOTION_TYPES, Board, Move } from './board';
import { PieceType } from './pieces';
import { Coord } from './coords';

describe('Board move generation', () => {
  it('rook from center has 6 ray directions, each up to 2 squares', () => {
    const board = new Board();
    const center: Coord = { x: 2, y: 2, z: 2 };
    board.setPiece(center, { type: PieceType.Rook, color: 'white' });
    const moves = board.generatePotentialMoves(center);
    // Expected: 6 directions * 2 squares each = 12 moves
    expect(moves.length).toBe(12);
    for (const move of moves) {
      expect(move.from).toEqual(center);
      expect(move.promotion).toBeUndefined();
      const dx = move.to.x - center.x;
      const dy = move.to.y - center.y;
      const dz = move.to.z - center.z;
      // Check it's a straight line and not stationary
      const isStraightLine =
        (dx !== 0 && dy === 0 && dz === 0) ||
        (dx === 0 && dy !== 0 && dz === 0) ||
        (dx === 0 && dy === 0 && dz !== 0);
      expect(isStraightLine).toBe(true);
    }
  });

  it('knight from corner (0,0,0) has correct moves', () => {
    const board = new Board();
    const corner: Coord = { x: 0, y: 0, z: 0 };
    board.setPiece(corner, { type: PieceType.Knight, color: 'white' });
    const moves = board.generatePotentialMoves(corner);
    const expectedDestinations: Coord[] = [
      { x: 2, y: 1, z: 0 },
      { x: 1, y: 2, z: 0 },
      { x: 2, y: 0, z: 1 },
      { x: 0, y: 2, z: 1 },
      { x: 1, y: 0, z: 2 },
      { x: 0, y: 1, z: 2 },
    ];
    expect(moves.length).toBe(expectedDestinations.length);
    for (const dest of expectedDestinations) {
      expect(moves).toContainEqual({ from: corner, to: dest, promotion: undefined });
    }
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
  it('white pawn: non-capture forward & up, no promotion', () => {
    const board = new Board();
    const from: Coord = { x: 2, y: 2, z: 2 }; // Not a promotion rank/level
    board.setPiece(from, { type: PieceType.Pawn, color: 'white' });
    const moves = board.generatePotentialMoves(from);
    const expectedMoves: Move[] = [
      { from, to: { x: 2, y: 3, z: 2 }, promotion: undefined }, // forward
      { from, to: { x: 2, y: 2, z: 3 }, promotion: undefined }, // up
    ];
    expect(moves).toEqual(expect.arrayContaining(expectedMoves));
    expect(moves.length).toBe(expectedMoves.length); // Ensure no extra moves
  });

  it('white pawn: capture directions, no promotion', () => {
    const board = new Board();
    const from: Coord = { x: 2, y: 2, z: 2 }; // Not promotion rank/level
    board.setPiece(from, { type: PieceType.Pawn, color: 'white' });
    const captureTargetCoords: Coord[] = [
      { x: 2, y: 3, z: 3 },
      { x: 1, y: 3, z: 2 },
      { x: 3, y: 3, z: 2 },
      { x: 1, y: 2, z: 3 },
      { x: 3, y: 2, z: 3 },
    ];
    for (const target of captureTargetCoords) {
      board.setPiece(target, { type: PieceType.Knight, color: 'black' });
    }
    const moves = board.generatePotentialMoves(from);
    const expectedSimpleMoves: Move[] = [
      { from, to: { x: 2, y: 3, z: 2 }, promotion: undefined },
      { from, to: { x: 2, y: 2, z: 3 }, promotion: undefined },
    ];
    const expectedCaptureMoves: Move[] = captureTargetCoords.map((to) => ({
      from,
      to,
      promotion: undefined,
    }));
    expect(moves).toEqual(
      expect.arrayContaining([...expectedSimpleMoves, ...expectedCaptureMoves]),
    );
    expect(moves.length).toBe(expectedSimpleMoves.length + expectedCaptureMoves.length);
  });

  it('white pawn: generates all promotion types when moving to promotion square (y=4, z=4)', () => {
    const board = new Board();
    const from: Coord = { x: 2, y: 3, z: 4 };
    board.setPiece(from, { type: PieceType.Pawn, color: 'white' });
    const to: Coord = { x: 2, y: 4, z: 4 }; // Promotion square for white

    // Simulate empty square for forward move
    board.setPiece(to, null);

    const moves = board.generatePotentialMoves(from);

    // Check only moves to the promotion square are considered for promotion
    const promotionMoves = moves.filter(
      (m) => m.to.x === to.x && m.to.y === to.y && m.to.z === to.z && m.promotion,
    );
    expect(promotionMoves.length).toBe(ALL_PROMOTION_TYPES.length);
    for (const promoType of ALL_PROMOTION_TYPES) {
      expect(promotionMoves).toContainEqual({ from, to, promotion: promoType });
    }

    // The up-move from (2,3,4) would go to (2,3,5), which is out of bounds, and
    // there are no capture targets — so the 5 promotion moves are the only moves.
    expect(moves.length).toBe(ALL_PROMOTION_TYPES.length);
  });

  it('white pawn: generates all promotion types when capturing onto promotion square', () => {
    const board = new Board();
    const from: Coord = { x: 1, y: 3, z: 4 };
    board.setPiece(from, { type: PieceType.Pawn, color: 'white' });
    const captureTo: Coord = { x: 0, y: 4, z: 4 }; // Forward-Left capture to promotion square
    board.setPiece(captureTo, { type: PieceType.Rook, color: 'black' }); // Enemy piece

    const moves = board.generatePotentialMoves(from);
    const promotionCaptureMoves = moves.filter(
      (m) =>
        m.to.x === captureTo.x && m.to.y === captureTo.y && m.to.z === captureTo.z && m.promotion,
    );
    expect(promotionCaptureMoves.length).toBe(ALL_PROMOTION_TYPES.length);
    for (const promoType of ALL_PROMOTION_TYPES) {
      expect(promotionCaptureMoves).toContainEqual({ from, to: captureTo, promotion: promoType });
    }
  });

  it('applyMove: promotion for white pawn at (x,4,4)', () => {
    const board = new Board();
    const from: Coord = { x: 2, y: 3, z: 3 };
    board.setPiece(from, { type: PieceType.Pawn, color: 'white' });
    const to: Coord = { x: 2, y: 4, z: 4 };
    const newBoard = board.applyMove({ from, to, promotion: PieceType.Queen });
    expect(newBoard.getPiece(to)).toEqual({ type: PieceType.Queen, color: 'white' });

    // A non-promotion move must not carry a promotion
    const from2: Coord = { x: 1, y: 3, z: 3 };
    board.setPiece(from2, { type: PieceType.Pawn, color: 'white' });
    const to2: Coord = { x: 1, y: 4, z: 3 }; // Not a full promotion square (z is not 4)
    expect(() => board.applyMove({ from: from2, to: to2, promotion: PieceType.Queen })).toThrow();
    const newBoard2 = board.applyMove({ from: from2, to: to2, promotion: undefined });
    expect(newBoard2.getPiece(to2)).toEqual({ type: PieceType.Pawn, color: 'white' });
  });

  it('applyMove: throws when a pawn reaches a promotion square without a valid promotion', () => {
    const white: Coord = { x: 2, y: 3, z: 4 };
    const whiteTo: Coord = { x: 2, y: 4, z: 4 };
    const black: Coord = { x: 2, y: 1, z: 0 };
    const blackTo: Coord = { x: 2, y: 0, z: 0 };
    const board = new Board();
    board.setPiece(white, { type: PieceType.Pawn, color: 'white' });
    board.setPiece(black, { type: PieceType.Pawn, color: 'black' });

    expect(() => board.applyMove({ from: white, to: whiteTo })).toThrow();
    expect(() =>
      board.applyMove({ from: white, to: whiteTo, promotion: PieceType.Pawn }),
    ).toThrow();
    expect(() =>
      board.applyMove({ from: white, to: whiteTo, promotion: PieceType.King }),
    ).toThrow();
    expect(() => board.applyMove({ from: black, to: blackTo })).toThrow();

    // All five legal promotion types are honored
    for (const promoType of ALL_PROMOTION_TYPES) {
      const promoted = board.applyMove({ from: white, to: whiteTo, promotion: promoType });
      expect(promoted.getPiece(whiteTo)).toEqual({ type: promoType, color: 'white' });
    }
  });

  it('white pawn: no two-square option (as per current rules)', () => {
    const board = new Board();
    const from: Coord = { x: 2, y: 1, z: 2 }; // Starting rank for two-square would be y=0 or y=1 depending on interpretation
    board.setPiece(from, { type: PieceType.Pawn, color: 'white' });
    const moves = board.generatePotentialMoves(from);
    // Standard 3D chess rules don't usually have a two-square first move for pawns.
    // This test confirms that for a pawn at (2,1,2), (2,3,2) is not a generated move.
    const twoSqForward: Coord = { x: 2, y: 3, z: 2 };
    expect(
      moves.find(
        (m) => m.to.x === twoSqForward.x && m.to.y === twoSqForward.y && m.to.z === twoSqForward.z,
      ),
    ).toBeUndefined();
    const oneSqForward: Coord = { x: 2, y: 2, z: 2 };
    expect(
      moves.find(
        (m) => m.to.x === oneSqForward.x && m.to.y === oneSqForward.y && m.to.z === oneSqForward.z,
      ),
    ).toBeDefined();
  });

  it('applyMove: promotion for black pawn at (x,0,0)', () => {
    const board = new Board();
    const from: Coord = { x: 2, y: 1, z: 1 };
    board.setPiece(from, { type: PieceType.Pawn, color: 'black' });
    const to: Coord = { x: 2, y: 0, z: 0 }; // Promotion square for black
    const newBoard = board.applyMove({ from, to, promotion: PieceType.Unicorn });
    expect(newBoard.getPiece(to)).toEqual({ type: PieceType.Unicorn, color: 'black' });
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

describe('generateAllLegalMoves', () => {
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
    const legalMoves = board.generateAllLegalMoves('black');
    const rookMoves = legalMoves.filter(
      (m: Move) => m.from.x === 0 && m.from.y === 0 && m.from.z === 2,
    );
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
    const legalMoves = board.generateAllLegalMoves('black');
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
    const movedClone = clone.applyMove({ from, to });
    // The original board should still have the pawn at 'from' and not at 'to'
    expect(board.getPiece(from)).toEqual({ type: PieceType.Pawn, color: 'white' });
    expect(board.getPiece(to)).toBeNull();
    // The moved clone should have the pawn at 'to' and not at 'from'
    expect(movedClone.getPiece(from)).toBeNull();
    expect(movedClone.getPiece(to)).toEqual({ type: PieceType.Pawn, color: 'white' });
  });
});

describe('generateLegalMoves (per piece)', () => {
  it('pinned rook can only move along the pin line', () => {
    const board = new Board();
    const blackKing: Coord = { x: 0, y: 0, z: 0 };
    const whiteRookAttacker: Coord = { x: 0, y: 0, z: 4 }; // Attacks along z-axis
    const blackRookPinned: Coord = { x: 0, y: 0, z: 2 }; // Pinned piece

    board.setPiece(blackKing, { type: PieceType.King, color: 'black' });
    board.setPiece(whiteRookAttacker, { type: PieceType.Rook, color: 'white' });
    board.setPiece(blackRookPinned, { type: PieceType.Rook, color: 'black' });

    // Add a friendly piece NOT on the pin line, to ensure it cannot move there
    board.setPiece({ x: 1, y: 0, z: 2 }, { type: PieceType.Pawn, color: 'black' });
    // Add an enemy piece NOT on the pin line, to ensure it can be captured if not pinned
    board.setPiece({ x: 0, y: 1, z: 2 }, { type: PieceType.Pawn, color: 'white' });

    const legalMovesForPinnedRook = board.generateLegalMoves(blackRookPinned);

    // Expected moves for the pinned rook:
    // Can move to z=1 (towards king)
    // Can move to z=3 (towards attacker, before attacker)
    // Can capture attacker at z=4
    const expectedDestinations: Coord[] = [
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: 3 },
      { x: 0, y: 0, z: 4 }, // Capture attacker
    ];

    expect(legalMovesForPinnedRook.length).toBe(expectedDestinations.length);
    for (const dest of expectedDestinations) {
      expect(legalMovesForPinnedRook).toContainEqual({
        from: blackRookPinned,
        to: dest,
        promotion: undefined,
      });
    }

    // Ensure it cannot move off the pin line, e.g., to (1,0,2) or capture at (0,1,2)
    expect(legalMovesForPinnedRook).not.toContainEqual({
      from: blackRookPinned,
      to: { x: 1, y: 0, z: 2 },
      promotion: undefined,
    });
    expect(legalMovesForPinnedRook).not.toContainEqual({
      from: blackRookPinned,
      to: { x: 0, y: 1, z: 2 },
      promotion: undefined,
    });
  });

  it('throws an error if called on an empty square', () => {
    const board = new Board();
    const emptyCoord: Coord = { x: 1, y: 1, z: 1 };
    // Ensure the square is empty
    board.setPiece(emptyCoord, null);
    expect(() => board.generateLegalMoves(emptyCoord)).toThrow(
      `No piece at Bb2 to generate legal moves for.`, // ZXY for (1 1 1) is Bb2
    );
  });
});

// ---------------------------------------------------------------------------
// Exact, position-specific tests. Expected destination sets are derived from
// the movement rules in README.md (not from the vector tables in pieces.ts), so
// these tests would catch a wrong or missing vector.
// ---------------------------------------------------------------------------

const CENTRE: Coord = { x: 2, y: 2, z: 2 };
const CORNER: Coord = { x: 0, y: 0, z: 0 };

const key = (c: Coord) => `${c.x},${c.y},${c.z}`;
const destinationKeys = (moves: Move[]) => new Set(moves.map((m) => key(m.to)));

// Every cell of the 5x5x5 board.
const ALL_CELLS: Coord[] = [];
for (let z = 0; z < 5; z++)
  for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) ALL_CELLS.push({ x, y, z });

// In-bounds cells reachable from `from` under a rule on the absolute deltas
// (|dx|, |dy|, |dz|), which is how README.md states each piece's movement.
const cellsWhere = (from: Coord, rule: (ax: number, ay: number, az: number) => boolean) =>
  new Set(
    ALL_CELLS.filter((c) =>
      rule(Math.abs(c.x - from.x), Math.abs(c.y - from.y), Math.abs(c.z - from.z)),
    ).map(key),
  );

// README: rook ±n along exactly one axis.
const rookRule = (ax: number, ay: number, az: number) =>
  [ax, ay, az].filter((a) => a !== 0).length === 1;
// README: bishop ±n along exactly two axes (same n on both).
const bishopRule = (ax: number, ay: number, az: number) => {
  const nonZero = [ax, ay, az].filter((a) => a !== 0);
  return nonZero.length === 2 && nonZero[0] === nonZero[1];
};
// README: unicorn ±n along all three axes.
const unicornRule = (ax: number, ay: number, az: number) => ax !== 0 && ax === ay && ay === az;
const queenRule = (ax: number, ay: number, az: number) =>
  rookRule(ax, ay, az) || bishopRule(ax, ay, az) || unicornRule(ax, ay, az);
// README: king = any queen direction, one step.
const kingRule = (ax: number, ay: number, az: number) =>
  Math.max(ax, ay, az) === 1 && queenRule(ax, ay, az);
// README: knight (±2, ±1, 0) in any axis order.
const knightRule = (ax: number, ay: number, az: number) => [ax, ay, az].sort().join() === '0,1,2';

const lone = (type: PieceType, at: Coord, color: 'white' | 'black' = 'white') => {
  const board = new Board();
  board.setPiece(at, { type, color });
  return board;
};

describe('generatePotentialMoves: exact destination sets on an empty board', () => {
  // Centre (2,2,2): every ray has exactly 2 in-bounds squares before the edge,
  // so a slider's count is (number of directions) x 2.
  //   rook    6 directions x 2 = 12
  //   bishop 12 directions x 2 = 24
  //   unicorn 8 directions x 2 = 16
  //   queen  26 directions x 2 = 52
  //   king   26 directions x 1 = 26
  //   knight 24 vectors, all in bounds from the centre (2 +/- 2, 2 +/- 1) = 24
  it.each([
    [PieceType.Rook, rookRule, 12],
    [PieceType.Bishop, bishopRule, 24],
    [PieceType.Unicorn, unicornRule, 16],
    [PieceType.Queen, queenRule, 52],
    [PieceType.King, kingRule, 26],
    [PieceType.Knight, knightRule, 24],
  ] as const)('%s from the centre', (type, rule, count) => {
    const moves = lone(type, CENTRE).generatePotentialMoves(CENTRE);
    expect(moves).toHaveLength(count);
    expect(destinationKeys(moves)).toEqual(cellsWhere(CENTRE, rule));
    for (const move of moves) {
      expect(move.from).toEqual(CENTRE);
      expect(move.promotion).toBeUndefined();
    }
  });

  // Corner (0,0,0): only the positive sense of each axis stays in bounds, and
  // each such ray has 4 squares.
  //   rook    3 rays (+x, +y, +z) x 4 = 12
  //   bishop  3 rays (+x+y, +x+z, +y+z) x 4 = 12
  //   unicorn 1 ray (+x+y+z) x 4 = 4
  //   queen   12 + 12 + 4 = 28
  //   king    3 + 3 + 1 = 7 (one step along each of the 7 rays above)
  //   knight  the 6 permutations of (2, 1, 0) with all-positive signs
  it.each([
    [PieceType.Rook, rookRule, 12],
    [PieceType.Bishop, bishopRule, 12],
    [PieceType.Unicorn, unicornRule, 4],
    [PieceType.Queen, queenRule, 28],
    [PieceType.King, kingRule, 7],
    [PieceType.Knight, knightRule, 6],
  ] as const)('%s from the corner', (type, rule, count) => {
    const moves = lone(type, CORNER).generatePotentialMoves(CORNER);
    expect(moves).toHaveLength(count);
    expect(destinationKeys(moves)).toEqual(cellsWhere(CORNER, rule));
  });

  it('throws on an empty square', () => {
    expect(() => new Board().generatePotentialMoves(CORNER)).toThrow('No piece at Aa1');
  });
});

describe('generatePotentialMoves: sliders are blocked', () => {
  it('rook stops short of a friendly piece and cannot land on it', () => {
    const board = lone(PieceType.Rook, CENTRE);
    board.setPiece({ x: 2, y: 3, z: 2 }, { type: PieceType.Pawn, color: 'white' });
    const dests = destinationKeys(board.generatePotentialMoves(CENTRE));
    // The whole +y ray (2 squares) is gone; the other 5 rays are untouched.
    expect(dests.size).toBe(10);
    expect(dests.has('2,3,2')).toBe(false);
    expect(dests.has('2,4,2')).toBe(false);
    expect(dests.has('2,1,2')).toBe(true);
  });

  it('rook can capture an enemy piece but cannot pass beyond it', () => {
    const board = lone(PieceType.Rook, CENTRE);
    board.setPiece({ x: 2, y: 3, z: 2 }, { type: PieceType.Pawn, color: 'black' });
    const dests = destinationKeys(board.generatePotentialMoves(CENTRE));
    expect(dests.size).toBe(11);
    expect(dests.has('2,3,2')).toBe(true);
    expect(dests.has('2,4,2')).toBe(false);
  });

  it('bishop is blocked on a planar diagonal', () => {
    const friendly = lone(PieceType.Bishop, CORNER);
    friendly.setPiece({ x: 2, y: 2, z: 0 }, { type: PieceType.Pawn, color: 'white' });
    const friendlyDests = destinationKeys(friendly.generatePotentialMoves(CORNER));
    expect(friendlyDests.has('1,1,0')).toBe(true);
    expect(friendlyDests.has('2,2,0')).toBe(false);
    expect(friendlyDests.has('3,3,0')).toBe(false);
    expect(friendlyDests.size).toBe(12 - 3); // +x+y ray loses 3 of its 4 squares

    const enemy = lone(PieceType.Bishop, CORNER);
    enemy.setPiece({ x: 2, y: 2, z: 0 }, { type: PieceType.Pawn, color: 'black' });
    const enemyDests = destinationKeys(enemy.generatePotentialMoves(CORNER));
    expect(enemyDests.has('1,1,0')).toBe(true);
    expect(enemyDests.has('2,2,0')).toBe(true);
    expect(enemyDests.has('3,3,0')).toBe(false);
    expect(enemyDests.has('4,4,0')).toBe(false);
    expect(enemyDests.size).toBe(12 - 2);
  });

  it('unicorn is blocked on a space diagonal', () => {
    const friendly = lone(PieceType.Unicorn, CORNER);
    friendly.setPiece({ x: 2, y: 2, z: 2 }, { type: PieceType.Pawn, color: 'white' });
    expect(destinationKeys(friendly.generatePotentialMoves(CORNER))).toEqual(new Set(['1,1,1']));

    const enemy = lone(PieceType.Unicorn, CORNER);
    enemy.setPiece({ x: 2, y: 2, z: 2 }, { type: PieceType.Pawn, color: 'black' });
    expect(destinationKeys(enemy.generatePotentialMoves(CORNER))).toEqual(
      new Set(['1,1,1', '2,2,2']),
    );
  });
});

describe('generatePotentialMoves: knight jumps', () => {
  it('a knight boxed in by friendly pieces on all 26 neighbours keeps every destination', () => {
    const board = lone(PieceType.Knight, CENTRE);
    const neighbours = ALL_CELLS.filter((c) => cellsWhere(CENTRE, kingRule).has(key(c)));
    expect(neighbours).toHaveLength(26);
    for (const c of neighbours) board.setPiece(c, { type: PieceType.Pawn, color: 'white' });
    const moves = board.generatePotentialMoves(CENTRE);
    expect(moves).toHaveLength(24);
    expect(destinationKeys(moves)).toEqual(cellsWhere(CENTRE, knightRule));
  });
});

describe('Black pawn move generation', () => {
  const from = CENTRE;

  it('quiet moves are one step -y (forward) or -z (down)', () => {
    const moves = lone(PieceType.Pawn, from, 'black').generatePotentialMoves(from);
    expect(moves).toHaveLength(2);
    expect(moves).toContainEqual({ from, to: { x: 2, y: 1, z: 2 }, promotion: undefined });
    expect(moves).toContainEqual({ from, to: { x: 2, y: 2, z: 1 }, promotion: undefined });
  });

  it('captures in all five mirrored directions', () => {
    const board = lone(PieceType.Pawn, from, 'black');
    // White's (dx, dy, dz) capture deltas with dy and dz negated.
    const targets: Coord[] = [
      { x: 2, y: 1, z: 1 }, // forward-down (0,-1,-1)
      { x: 1, y: 1, z: 2 }, // forward-left (-1,-1,0)
      { x: 3, y: 1, z: 2 }, // forward-right (+1,-1,0)
      { x: 1, y: 2, z: 1 }, // down-left (-1,0,-1)
      { x: 3, y: 2, z: 1 }, // down-right (+1,0,-1)
    ];
    for (const t of targets) board.setPiece(t, { type: PieceType.Knight, color: 'white' });
    const moves = board.generatePotentialMoves(from);
    expect(moves).toHaveLength(2 + targets.length);
    for (const to of targets) {
      expect(moves).toContainEqual({ from, to, promotion: undefined });
    }
  });

  it('is blocked forward and down by any piece, and cannot capture straight ahead', () => {
    const board = lone(PieceType.Pawn, from, 'black');
    board.setPiece({ x: 2, y: 1, z: 2 }, { type: PieceType.Rook, color: 'white' }); // enemy ahead
    board.setPiece({ x: 2, y: 2, z: 1 }, { type: PieceType.Rook, color: 'black' }); // friend below
    expect(board.generatePotentialMoves(from)).toHaveLength(0);
  });

  it('cannot capture a friendly piece on a capture square', () => {
    const board = lone(PieceType.Pawn, from, 'black');
    board.setPiece({ x: 1, y: 1, z: 2 }, { type: PieceType.Knight, color: 'black' });
    const dests = destinationKeys(board.generatePotentialMoves(from));
    expect(dests).toEqual(new Set(['2,1,2', '2,2,1']));
  });

  it('white and black pawn moves mirror each other through the board centre', () => {
    const mirror = (c: Coord): Coord => ({ x: 4 - c.x, y: 4 - c.y, z: 4 - c.z });
    const white = new Board();
    const at: Coord = { x: 1, y: 1, z: 1 };
    white.setPiece(at, { type: PieceType.Pawn, color: 'white' });
    white.setPiece({ x: 2, y: 2, z: 1 }, { type: PieceType.Rook, color: 'black' });
    const black = new Board();
    black.setPiece(mirror(at), { type: PieceType.Pawn, color: 'black' });
    black.setPiece(mirror({ x: 2, y: 2, z: 1 }), { type: PieceType.Rook, color: 'white' });

    const whiteDests = [...destinationKeys(white.generatePotentialMoves(at))].sort();
    const blackDests = [...destinationKeys(black.generatePotentialMoves(mirror(at)))]
      .map((k) => {
        const [x, y, z] = k.split(',').map(Number);
        return key(mirror({ x, y, z }));
      })
      .sort();
    expect(blackDests).toEqual(whiteDests);
    expect(whiteDests).toHaveLength(3);
  });
});

describe('Check detection by piece type', () => {
  const withKings = (board: Board, white: Coord, black: Coord) => {
    board.setPiece(white, { type: PieceType.King, color: 'white' });
    board.setPiece(black, { type: PieceType.King, color: 'black' });
    return board;
  };

  it('white pawn gives check only along its five capture directions', () => {
    const pawn: Coord = { x: 2, y: 2, z: 2 };
    const attacked: Coord[] = [
      { x: 2, y: 3, z: 3 },
      { x: 1, y: 3, z: 2 },
      { x: 3, y: 3, z: 2 },
      { x: 1, y: 2, z: 3 },
      { x: 3, y: 2, z: 3 },
    ];
    for (const kingAt of attacked) {
      const board = withKings(lone(PieceType.Pawn, pawn), { x: 0, y: 0, z: 0 }, kingAt);
      expect(board.isSquareAttacked(kingAt, 'white')).toBe(true);
      expect(board.inCheck('black')).toBe(true);
    }
    // The quiet forward and up steps are not attacks.
    for (const kingAt of [
      { x: 2, y: 3, z: 2 },
      { x: 2, y: 2, z: 3 },
    ]) {
      const board = withKings(lone(PieceType.Pawn, pawn), { x: 0, y: 0, z: 0 }, kingAt);
      expect(board.isSquareAttacked(kingAt, 'white')).toBe(false);
      expect(board.inCheck('black')).toBe(false);
    }
  });

  it('black pawn gives check only along its five mirrored capture directions', () => {
    const pawn: Coord = { x: 2, y: 2, z: 2 };
    const attacked: Coord[] = [
      { x: 2, y: 1, z: 1 },
      { x: 1, y: 1, z: 2 },
      { x: 3, y: 1, z: 2 },
      { x: 1, y: 2, z: 1 },
      { x: 3, y: 2, z: 1 },
    ];
    for (const kingAt of attacked) {
      const board = withKings(lone(PieceType.Pawn, pawn, 'black'), kingAt, { x: 4, y: 4, z: 4 });
      expect(board.isSquareAttacked(kingAt, 'black')).toBe(true);
      expect(board.inCheck('white')).toBe(true);
    }
    for (const kingAt of [
      { x: 2, y: 1, z: 2 },
      { x: 2, y: 2, z: 1 },
    ]) {
      const board = withKings(lone(PieceType.Pawn, pawn, 'black'), kingAt, { x: 4, y: 4, z: 4 });
      expect(board.isSquareAttacked(kingAt, 'black')).toBe(false);
      expect(board.inCheck('white')).toBe(false);
    }
  });

  it('bishop gives check along a planar diagonal unless a piece interposes', () => {
    const board = withKings(
      lone(PieceType.Bishop, CORNER),
      { x: 4, y: 0, z: 4 },
      { x: 3, y: 3, z: 0 },
    );
    expect(board.inCheck('black')).toBe(true);
    board.setPiece({ x: 1, y: 1, z: 0 }, { type: PieceType.Pawn, color: 'black' });
    expect(board.inCheck('black')).toBe(false);
    // A space diagonal is not a bishop line.
    const offLine = withKings(
      lone(PieceType.Bishop, CORNER),
      { x: 4, y: 0, z: 4 },
      { x: 3, y: 3, z: 3 },
    );
    expect(offLine.inCheck('black')).toBe(false);
  });

  it('queen gives check along rook, bishop, and unicorn lines', () => {
    for (const kingAt of [
      { x: 0, y: 4, z: 0 }, // rook line
      { x: 3, y: 3, z: 0 }, // bishop line
      { x: 4, y: 4, z: 4 }, // unicorn line
    ]) {
      const board = withKings(lone(PieceType.Queen, CORNER), { x: 4, y: 0, z: 4 }, kingAt);
      expect(board.inCheck('black')).toBe(true);
    }
    // A knight's offset is not a queen line.
    const safe = withKings(
      lone(PieceType.Queen, CORNER),
      { x: 4, y: 0, z: 4 },
      { x: 2, y: 1, z: 0 },
    );
    expect(safe.inCheck('black')).toBe(false);
  });

  it('adjacent kings attack each other; a two-step gap does not', () => {
    const board = withKings(new Board(), CENTRE, { x: 3, y: 3, z: 3 });
    expect(board.isSquareAttacked({ x: 3, y: 3, z: 3 }, 'white')).toBe(true);
    expect(board.isSquareAttacked(CENTRE, 'black')).toBe(true);
    expect(board.inCheck('white')).toBe(true);
    expect(board.inCheck('black')).toBe(true);

    const apart = withKings(new Board(), CENTRE, { x: 4, y: 4, z: 4 });
    expect(apart.inCheck('white')).toBe(false);
    expect(apart.inCheck('black')).toBe(false);
  });

  it('findKing throws when the king is absent', () => {
    expect(() => new Board().findKing('white')).toThrow('King of color white not found');
    const blackOnly = lone(PieceType.King, CORNER, 'black');
    expect(() => blackOnly.findKing('white')).toThrow();
    expect(blackOnly.findKing('black')).toEqual(CORNER);
  });
});

describe('Checkmate refutations', () => {
  // Black king boxed into the (0,0,0) corner by four mutually-defended white
  // rooks (the stalemate box), then checked by a fifth rook along the y-axis.
  // With no other black piece this is mate.
  const matedCorner = () => {
    const board = new Board();
    board.setPiece(CORNER, { type: PieceType.King, color: 'black' });
    board.setPiece({ x: 4, y: 4, z: 4 }, { type: PieceType.King, color: 'white' });
    board.setPiece({ x: 1, y: 1, z: 0 }, { type: PieceType.Rook, color: 'white' });
    board.setPiece({ x: 1, y: 0, z: 1 }, { type: PieceType.Rook, color: 'white' });
    board.setPiece({ x: 0, y: 1, z: 1 }, { type: PieceType.Rook, color: 'white' });
    board.setPiece({ x: 1, y: 1, z: 1 }, { type: PieceType.Rook, color: 'white' });
    board.setPiece({ x: 0, y: 4, z: 0 }, { type: PieceType.Rook, color: 'white' }); // the check
    return board;
  };

  it('the box position is mate on its own', () => {
    expect(matedCorner().isCheckmate('black')).toBe(true);
  });

  it('is refuted when the checking piece can be captured', () => {
    const board = matedCorner();
    // A black bishop on (2,2,0) reaches the checking rook via (1,3,0).
    const bishop: Coord = { x: 2, y: 2, z: 0 };
    board.setPiece(bishop, { type: PieceType.Bishop, color: 'black' });
    expect(board.inCheck('black')).toBe(true);
    expect(board.isCheckmate('black')).toBe(false);
    expect(board.generateAllLegalMoves('black')).toEqual([
      { from: bishop, to: { x: 0, y: 4, z: 0 }, promotion: undefined },
    ]);
  });

  it('is refuted when a piece can interpose', () => {
    const board = matedCorner();
    // A black rook on (4,2,0) can slide along y=2 to (0,2,0), blocking the file.
    const rook: Coord = { x: 4, y: 2, z: 0 };
    board.setPiece(rook, { type: PieceType.Rook, color: 'black' });
    expect(board.inCheck('black')).toBe(true);
    expect(board.isCheckmate('black')).toBe(false);
    expect(board.generateAllLegalMoves('black')).toEqual([
      { from: rook, to: { x: 0, y: 2, z: 0 }, promotion: undefined },
    ]);
  });

  it('is refuted when the king can capture an undefended checking piece', () => {
    const board = new Board();
    board.setPiece({ x: 4, y: 4, z: 4 }, { type: PieceType.King, color: 'black' });
    board.setPiece({ x: 4, y: 4, z: 3 }, { type: PieceType.Queen, color: 'white' });
    board.setPiece(CORNER, { type: PieceType.King, color: 'white' });
    expect(board.inCheck('black')).toBe(true);
    expect(board.isCheckmate('black')).toBe(false);
    expect(board.generateLegalMoves({ x: 4, y: 4, z: 4 })).toContainEqual({
      from: { x: 4, y: 4, z: 4 },
      to: { x: 4, y: 4, z: 3 },
      promotion: undefined,
    });
  });
});

describe('Starting position baseline', () => {
  const board = Board.setupStartingPosition();
  const pieces = ALL_CELLS.map((c) => board.getPiece(c)).filter((p) => p !== null);

  it('has 40 pieces, 20 per colour', () => {
    expect(pieces).toHaveLength(40);
    expect(pieces.filter((p) => p.color === 'white')).toHaveLength(20);
    expect(pieces.filter((p) => p.color === 'black')).toHaveLength(20);
  });

  it('has neither side in check', () => {
    expect(board.inCheck('white')).toBe(false);
    expect(board.inCheck('black')).toBe(false);
  });

  // 61, computed once and hand-verified from the rules:
  //   pawns    15  (5 on level A: forward only, up is blocked by the level-B
  //                 pawn; 5 on level B: forward + up)
  //   knights  12  (6 each; the (±2,±1,0) hops onto a2/b2-rank pawns, the
  //                 bishop, and off-board are excluded)
  //   bishops  13  (a-file bishop 6, d-file bishop 7; each includes one
  //                 long-diagonal capture of a black pawn)
  //   unicorns  7  (4 + 3, again with one long-diagonal capture each)
  //   queen    14
  //   king      0, rooks 0  (fully surrounded)
  it('white has 61 legal moves, and black the same by symmetry', () => {
    expect(board.generateAllLegalMoves('white')).toHaveLength(61);
    expect(board.generateAllLegalMoves('black')).toHaveLength(61);
  });
});

describe('isSquareAttacked on arbitrary squares (generateAttackedSquares)', () => {
  const W = 'white' as const;
  const B = 'black' as const;

  it('a pawn attacks its capture squares even when they are empty, never its step squares', () => {
    const board = new Board();
    board.setPiece({ x: 2, y: 2, z: 2 }, { type: PieceType.Pawn, color: W });
    // Quiet steps: forward and up. Empty, so a move exists but no attack.
    expect(board.isSquareAttacked({ x: 2, y: 3, z: 2 }, W)).toBe(false);
    expect(board.isSquareAttacked({ x: 2, y: 2, z: 3 }, W)).toBe(false);
    // All five capture squares are attacked while empty
    for (const [dx, dy, dz] of [
      [0, 1, 1],
      [-1, 1, 0],
      [1, 1, 0],
      [-1, 0, 1],
      [1, 0, 1],
    ]) {
      expect(board.isSquareAttacked({ x: 2 + dx, y: 2 + dy, z: 2 + dz }, W)).toBe(true);
    }
    // Mirrored for black
    board.setPiece({ x: 2, y: 2, z: 2 }, { type: PieceType.Pawn, color: B });
    expect(board.isSquareAttacked({ x: 2, y: 1, z: 2 }, B)).toBe(false);
    expect(board.isSquareAttacked({ x: 2, y: 1, z: 1 }, B)).toBe(true);
    expect(board.isSquareAttacked({ x: 3, y: 2, z: 1 }, B)).toBe(true);
  });

  it('a ray attacks the first piece it hits regardless of colour, and nothing beyond it', () => {
    const board = new Board();
    board.setPiece({ x: 0, y: 0, z: 0 }, { type: PieceType.Rook, color: W });
    board.setPiece({ x: 0, y: 2, z: 0 }, { type: PieceType.Pawn, color: W }); // friendly blocker
    // The friendly pawn's square is defended (attacked) by the rook...
    expect(board.isSquareAttacked({ x: 0, y: 2, z: 0 }, W)).toBe(true);
    // ...but nothing past it is
    expect(board.isSquareAttacked({ x: 0, y: 3, z: 0 }, W)).toBe(false);
    // Empty squares before the blocker are attacked
    expect(board.isSquareAttacked({ x: 0, y: 1, z: 0 }, W)).toBe(true);
  });

  it('agrees with inCheck for the occupied king square', () => {
    const board = new Board();
    board.setPiece({ x: 2, y: 2, z: 2 }, { type: PieceType.King, color: B });
    board.setPiece({ x: 1, y: 1, z: 2 }, { type: PieceType.Pawn, color: W }); // attacks (2,2,2)
    expect(board.inCheck(B)).toBe(true);
    expect(board.isSquareAttacked({ x: 2, y: 2, z: 2 }, W)).toBe(true);
    // A king next to it cannot step into the pawn's other capture square
    board.setPiece({ x: 2, y: 2, z: 2 }, null);
    board.setPiece({ x: 0, y: 3, z: 2 }, { type: PieceType.King, color: B });
    const kingMoves = board.generateLegalMoves({ x: 0, y: 3, z: 2 });
    expect(kingMoves.some((m) => m.to.x === 0 && m.to.y === 2 && m.to.z === 2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rules that were previously untested: black promotion generation, capture
// removal in applyMove, promotion legality filtering, and stalemate vs check.
// ---------------------------------------------------------------------------

const WHITE = 'white' as const;
const BLACK = 'black' as const;

const countPieces = (board: Board) => ALL_CELLS.filter((c) => board.getPiece(c) !== null).length;

describe('Black pawn promotion generation onto (x,0,0)', () => {
  const promotionSquare: Coord = { x: 2, y: 0, z: 0 };

  it('a pawn on (x,1,1) promotes onto (x,0,0) only by capturing along the forward-down diagonal', () => {
    const from: Coord = { x: 2, y: 1, z: 1 };
    const board = lone(PieceType.Pawn, from, BLACK);

    // (2,0,0) is a capture square for this pawn, not a step square: with it
    // empty there is no promotion at all, only the two quiet steps.
    const quiet = board.generatePotentialMoves(from);
    expect(quiet).toHaveLength(2);
    expect(quiet.every((m) => m.promotion === undefined)).toBe(true);
    expect(destinationKeys(quiet)).toEqual(
      new Set([key({ x: 2, y: 0, z: 1 }), key({ x: 2, y: 1, z: 0 })]),
    );

    board.setPiece(promotionSquare, { type: PieceType.Rook, color: WHITE });
    const moves = board.generatePotentialMoves(from);
    const promotions = moves.filter((m) => key(m.to) === key(promotionSquare));
    expect(promotions).toHaveLength(ALL_PROMOTION_TYPES.length);
    expect(new Set(promotions.map((m) => m.promotion))).toEqual(new Set(ALL_PROMOTION_TYPES));
    // The two quiet steps are still there, unpromoted.
    expect(moves).toHaveLength(2 + ALL_PROMOTION_TYPES.length);
    expect(moves.filter((m) => m.promotion === undefined)).toHaveLength(2);
  });

  it('a pawn stepping forward from (x,1,0) or down from (x,0,1) promotes onto (x,0,0)', () => {
    for (const from of [
      { x: 2, y: 1, z: 0 },
      { x: 2, y: 0, z: 1 },
    ]) {
      const moves = lone(PieceType.Pawn, from, BLACK).generatePotentialMoves(from);
      // The other step and every capture square are off the board or empty,
      // so the five promotion steps are the only moves.
      expect(moves).toHaveLength(ALL_PROMOTION_TYPES.length);
      for (const promotion of ALL_PROMOTION_TYPES) {
        expect(moves).toContainEqual({ from, to: promotionSquare, promotion });
      }
    }
  });

  it('a pawn capturing sideways from (x+1,1,0) promotes onto (x,0,0)', () => {
    const from: Coord = { x: 3, y: 1, z: 0 };
    const board = lone(PieceType.Pawn, from, BLACK);
    board.setPiece(promotionSquare, { type: PieceType.Knight, color: WHITE });
    const captures = board
      .generatePotentialMoves(from)
      .filter((m) => key(m.to) === key(promotionSquare));
    expect(captures).toHaveLength(ALL_PROMOTION_TYPES.length);
    expect(new Set(captures.map((m) => m.promotion))).toEqual(new Set(ALL_PROMOTION_TYPES));
  });
});

describe('applyMove captures', () => {
  it('removes the captured piece and leaves the mover on the destination', () => {
    const board = new Board();
    const from: Coord = { x: 0, y: 0, z: 0 };
    const to: Coord = { x: 0, y: 0, z: 3 };
    board.setPiece(from, { type: PieceType.Rook, color: WHITE });
    board.setPiece(to, { type: PieceType.Knight, color: BLACK });
    board.setPiece({ x: 4, y: 4, z: 4 }, { type: PieceType.King, color: WHITE });
    board.setPiece({ x: 4, y: 0, z: 4 }, { type: PieceType.King, color: BLACK });
    expect(countPieces(board)).toBe(4);

    const after = board.applyMove({ from, to });

    expect(countPieces(after)).toBe(3);
    expect(after.getPiece(from)).toBeNull();
    expect(after.getPiece(to)).toEqual({ type: PieceType.Rook, color: WHITE });
    // The captured knight is gone from the board entirely, not just moved.
    const blackKnights = ALL_CELLS.filter((c) => {
      const p = after.getPiece(c);
      return p !== null && p.color === BLACK && p.type === PieceType.Knight;
    });
    expect(blackKnights).toHaveLength(0);
    // applyMove returns a new board; the original still has the knight.
    expect(countPieces(board)).toBe(4);
    expect(board.getPiece(to)).toEqual({ type: PieceType.Knight, color: BLACK });
  });
});

describe('generateLegalMoves filters promotions that leave the king in check', () => {
  // White rook at (0,0,0) checks the black king at (0,0,3) along the level
  // axis. The black pawn at (1,1,0) can either step forward to (1,0,0) --
  // a promotion that does nothing about the check -- or capture the rook on
  // (0,0,0), a promotion that resolves it.
  const pawn: Coord = { x: 1, y: 1, z: 0 };
  const rook: Coord = { x: 0, y: 0, z: 0 };
  const step: Coord = { x: 1, y: 0, z: 0 };

  const position = () => {
    const board = new Board();
    board.setPiece(rook, { type: PieceType.Rook, color: WHITE });
    board.setPiece({ x: 4, y: 4, z: 4 }, { type: PieceType.King, color: WHITE });
    board.setPiece({ x: 0, y: 0, z: 3 }, { type: PieceType.King, color: BLACK });
    board.setPiece(pawn, { type: PieceType.Pawn, color: BLACK });
    return board;
  };

  it('generates both promotion sets as potential moves', () => {
    const potential = position().generatePotentialMoves(pawn);
    expect(potential).toHaveLength(2 * ALL_PROMOTION_TYPES.length);
    expect(potential.filter((m) => key(m.to) === key(step))).toHaveLength(
      ALL_PROMOTION_TYPES.length,
    );
    expect(potential.filter((m) => key(m.to) === key(rook))).toHaveLength(
      ALL_PROMOTION_TYPES.length,
    );
  });

  it('keeps every promotion that captures the checking rook and drops every quiet promotion', () => {
    const board = position();
    expect(board.inCheck(BLACK)).toBe(true);

    const legal = board.generateLegalMoves(pawn);
    expect(legal).toHaveLength(ALL_PROMOTION_TYPES.length);
    expect(legal.every((m) => key(m.to) === key(rook))).toBe(true);
    expect(new Set(legal.map((m) => m.promotion))).toEqual(new Set(ALL_PROMOTION_TYPES));
    for (const promotion of ALL_PROMOTION_TYPES) {
      expect(legal).not.toContainEqual({ from: pawn, to: step, promotion });
      // Sanity: the filtered step really does leave black in check, and the
      // kept capture really does not.
      expect(board.applyMove({ from: pawn, to: step, promotion }).inCheck(BLACK)).toBe(true);
      expect(board.applyMove({ from: pawn, to: rook, promotion }).inCheck(BLACK)).toBe(false);
    }
  });
});

describe('isStalemate', () => {
  it('is false in a mate position: no legal moves but the side to move is in check', () => {
    const board = new Board();
    board.setPiece({ x: 4, y: 4, z: 3 }, { type: PieceType.Queen, color: WHITE });
    board.setPiece({ x: 4, y: 4, z: 2 }, { type: PieceType.Rook, color: WHITE });
    board.setPiece({ x: 0, y: 0, z: 0 }, { type: PieceType.King, color: WHITE });
    board.setPiece({ x: 4, y: 4, z: 4 }, { type: PieceType.King, color: BLACK });

    expect(board.generateAllLegalMoves(BLACK)).toHaveLength(0);
    expect(board.inCheck(BLACK)).toBe(true);
    expect(board.isCheckmate(BLACK)).toBe(true);
    expect(board.isStalemate(BLACK)).toBe(false);
  });

  it('is false when the side to move is not in check but still has a legal move', () => {
    // The stalemate box from above, plus one black pawn with a free step down.
    const board = new Board();
    board.setPiece({ x: 0, y: 0, z: 0 }, { type: PieceType.King, color: BLACK });
    board.setPiece({ x: 4, y: 4, z: 4 }, { type: PieceType.King, color: WHITE });
    board.setPiece({ x: 1, y: 1, z: 0 }, { type: PieceType.Rook, color: WHITE });
    board.setPiece({ x: 1, y: 0, z: 1 }, { type: PieceType.Rook, color: WHITE });
    board.setPiece({ x: 0, y: 1, z: 1 }, { type: PieceType.Rook, color: WHITE });
    board.setPiece({ x: 1, y: 1, z: 1 }, { type: PieceType.Rook, color: WHITE });
    expect(board.isStalemate(BLACK)).toBe(true);

    const pawn: Coord = { x: 4, y: 0, z: 4 };
    board.setPiece(pawn, { type: PieceType.Pawn, color: BLACK });

    expect(board.inCheck(BLACK)).toBe(false);
    expect(board.generateAllLegalMoves(BLACK)).toEqual([
      { from: pawn, to: { x: 4, y: 0, z: 3 }, promotion: undefined },
    ]);
    expect(board.isStalemate(BLACK)).toBe(false);
    expect(board.isCheckmate(BLACK)).toBe(false);
  });
});
