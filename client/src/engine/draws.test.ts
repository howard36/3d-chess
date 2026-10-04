import { Board } from './board';
import { hashAfter, positionHash } from './draws';
import { fromZXY } from './coords';
import { PieceType } from './pieces';

/** A seeded generator, so a failure reproduces. */
const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

it('a move changes the hash just as hashing the new position afresh would', () => {
  const random = rng(11);
  let checked = 0;
  for (let game = 0; game < 20; game++) {
    let board = Board.setupStartingPosition();
    let hash = positionHash(board, 'white');
    for (let ply = 0; ply < 80; ply++) {
      const color = ply % 2 ? 'black' : 'white';
      const moves = board.generateAllLegalMoves(color);
      if (moves.length === 0) break;
      const captures = moves.filter((m) => board.getPiece(m.to));
      const pool = captures.length && random() < 0.5 ? captures : moves;
      const move = pool[Math.floor(random() * pool.length)];
      const next = board.applyMove(move);
      hash = hashAfter(hash, board, next, move);
      expect(hash).toBe(positionHash(next, color === 'white' ? 'black' : 'white'));
      expect(Number.isSafeInteger(hash)).toBe(true);
      board = next;
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(1000);
});

it('tells positions apart by their pieces and by the side to move', () => {
  const start = Board.setupStartingPosition();
  expect(positionHash(start, 'white')).not.toBe(positionHash(start, 'black'));
  const out = start.applyMove({ from: fromZXY('Ab1'), to: fromZXY('Cc1') });
  expect(positionHash(out, 'black')).not.toBe(positionHash(start, 'black'));
  // Out and back: the same position, the same hash
  const back = out.applyMove({ from: fromZXY('Cc1'), to: fromZXY('Ab1') });
  expect(positionHash(back, 'white')).toBe(positionHash(start, 'white'));
  // The same square, a different piece
  const swapped = start.clone();
  swapped.setPiece(fromZXY('Ab1'), { type: PieceType.Unicorn, color: 'white' });
  expect(positionHash(swapped, 'white')).not.toBe(positionHash(start, 'white'));
});

it('counts a promoted pawn as the piece it became', () => {
  const board = new Board();
  board.setPiece(fromZXY('Aa1'), { type: PieceType.King, color: 'white' });
  board.setPiece(fromZXY('Ee1'), { type: PieceType.King, color: 'black' });
  board.setPiece(fromZXY('Dc5'), { type: PieceType.Pawn, color: 'white' });
  const move = { from: fromZXY('Dc5'), to: fromZXY('Ec5'), promotion: PieceType.Knight };
  const after = board.applyMove(move);
  expect(hashAfter(positionHash(board, 'white'), board, after, move)).toBe(
    positionHash(after, 'black'),
  );
});
