import { Board, Move } from './board';
import { PieceType } from './pieces';
import { Coord } from './coords';

const ALL_PROMOTION_TYPES = [
  PieceType.Queen,
  PieceType.Rook,
  PieceType.Bishop,
  PieceType.Knight,
  PieceType.Unicorn,
];

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

    // Ensure non-promoting moves to other squares (if any) are not included in this check, or are handled separately
    // For this specific setup, only the forward move to (2,4,4) and up-move to (2,3,4) are possible non-captures
    const nonCaptureNonPromotionUpMove: Coord = { x: 2, y: 3, z: 4 };
    if (board.getPiece(nonCaptureNonPromotionUpMove) === null) {
      expect(moves).toContainEqual({
        from,
        to: nonCaptureNonPromotionUpMove,
        promotion: undefined,
      });
    }
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
    board.applyMove({ from, to, promotion: PieceType.Queen });
    expect(board.getPiece(to)).toEqual({ type: PieceType.Queen, color: 'white' });

    // Test non-promotion move
    const from2: Coord = { x: 1, y: 3, z: 3 };
    board.setPiece(from2, { type: PieceType.Pawn, color: 'white' });
    const to2: Coord = { x: 1, y: 4, z: 3 }; // Not a full promotion square (z is not 4)
    board.applyMove({ from: from2, to: to2, promotion: PieceType.Queen }); // Promotion should be ignored
    expect(board.getPiece(to2)).toEqual({ type: PieceType.Pawn, color: 'white' });
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
    board.applyMove({ from, to, promotion: PieceType.Unicorn });
    expect(board.getPiece(to)).toEqual({ type: PieceType.Unicorn, color: 'black' });
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
    clone.applyMove({ from, to });
    // The original board should still have the pawn at 'from' and not at 'to'
    expect(board.getPiece(from)).toEqual({ type: PieceType.Pawn, color: 'white' });
    expect(board.getPiece(to)).toBeNull();
    // The clone should have the pawn at 'to' and not at 'from'
    expect(clone.getPiece(from)).toBeNull();
    expect(clone.getPiece(to)).toEqual({ type: PieceType.Pawn, color: 'white' });
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

describe('generateAllLegalMoves', () => {
  it('excludes illegal moves for a pinned piece (rook can only move along pin line) - aggregated', () => {
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
      (m: Move) => m.from.x === blackRook.x && m.from.y === blackRook.y && m.from.z === blackRook.z,
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

  it('black king in corner has only one legal move due to two white rooks defending each other - aggregated', () => {
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
