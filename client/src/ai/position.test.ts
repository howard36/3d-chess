import { Board } from '../engine/board';
import { fromZXY, toZXY } from '../engine/coords';
import { moveFromMessage } from '../engine/protocol';
import { PieceType } from '../engine/pieces';
import type { Piece } from '../engine/pieces';
import {
  BLACK,
  BLACK_SIDE,
  CELLS,
  CX,
  CY,
  CZ,
  KING,
  PAWN,
  Position,
  QUEEN,
  WHITE_SIDE,
  cellOf,
  moveCaptured,
  movePromotion,
} from './position';
import type { WireMove } from './position';

// The search's board must play by exactly the engine's rules: compared with
// the engine on every position of many random games, move lists as sets.

const TYPE_CODE: Record<PieceType, number> = {
  [PieceType.Pawn]: 1,
  [PieceType.Knight]: 2,
  [PieceType.Bishop]: 3,
  [PieceType.Rook]: 4,
  [PieceType.Unicorn]: 5,
  [PieceType.Queen]: 6,
  [PieceType.King]: 7,
};

const engineMoves = (board: Board, color: 'white' | 'black') =>
  board
    .generateAllLegalMoves(color)
    .map(
      (m) => `${toZXY(m.from)}-${toZXY(m.to)}${m.promotion ? '=' + m.promotion.slice(0, 2) : ''}`,
    )
    .sort();

const PROMO_NAME: Record<number, string> = {
  2: 'Kn',
  3: 'Bi',
  4: 'Ro',
  5: 'Un',
  6: 'Qu',
};
const positionMoves = (pos: Position) => {
  const out = new Int32Array(256);
  const n = pos.legalMoves(out);
  return [...out.subarray(0, n)]
    .map((m) => {
      const r = Position.record(m);
      const promo = movePromotion(m);
      return `${r.from}-${r.to}${promo ? '=' + PROMO_NAME[promo] : ''}`;
    })
    .sort();
};

/** A seeded generator, so a failure reproduces. */
const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

it('agrees with the engine on every position of random games', () => {
  const random = rng(7);
  let positions = 0;
  for (let game = 0; game < 40; game++) {
    let board = Board.setupStartingPosition();
    const pos = Position.start();
    const records: WireMove[] = [];
    for (let ply = 0; ply < 120; ply++) {
      const color = ply % 2 === 0 ? 'white' : 'black';
      expect(pos.side).toBe(ply % 2 === 0 ? WHITE_SIDE : BLACK_SIDE);
      const expected = engineMoves(board, color);
      expect(positionMoves(pos)).toEqual(expected);
      expect(pos.inCheck()).toBe(board.inCheck(color));
      positions++;
      if (expected.length === 0) break;
      // Prefer captures now and then, so games reach thin endgames
      const out = new Int32Array(256);
      const n = pos.legalMoves(out);
      const captures = [...out.subarray(0, n)].filter((m) => moveCaptured(m));
      const pool = captures.length && random() < 0.4 ? captures : [...out.subarray(0, n)];
      const move = pool[Math.floor(random() * pool.length)];
      const record = Position.record(move);
      records.push(record);
      board = board.applyMove(moveFromMessage({ by: color, ...record }));
      pos.make(move);
    }
    // Replaying the record lands on the same position
    const replayed = Position.fromRecords(records);
    expect(replayed.hashLo).toBe(pos.hashLo);
    expect([...replayed.board]).toEqual([...pos.board]);
  }
  expect(positions).toBeGreaterThan(2000);
});

it('takes back every move exactly, hash included', () => {
  const pos = Position.fromRecords([
    { from: 'Bc2', to: 'Cc2' },
    { from: 'Dc4', to: 'Cc4' },
  ]);
  const before = { board: [...pos.board], lo: pos.hashLo, hi: pos.hashHi, king: [...pos.king] };
  const out = new Int32Array(256);
  const n = pos.generate(out, 0);
  for (let i = 0; i < n; i++) {
    pos.make(out[i]);
    pos.unmake(out[i]);
    expect([...pos.board]).toEqual(before.board);
    expect([pos.hashLo, pos.hashHi]).toEqual([before.lo, before.hi]);
    expect([...pos.king]).toEqual(before.king);
  }
  pos.makeNull();
  expect(pos.side).toBe(BLACK_SIDE);
  pos.unmakeNull();
  expect([pos.hashLo, pos.side]).toEqual([before.lo, WHITE_SIDE]);
});

const shuffle: WireMove[] = [
  { from: 'Ab1', to: 'Cc1' },
  { from: 'Ed5', to: 'Cc5' },
  { from: 'Cc1', to: 'Ab1' },
  { from: 'Cc5', to: 'Ed5' },
];

it('hashes a position the same however it was reached', () => {
  const a = Position.fromRecords(shuffle);
  const start = Position.start();
  expect([a.hashLo, a.hashHi]).toEqual([start.hashLo, start.hashHi]);
});

it('calls a position drawn the third time it stands, or the second inside a search', () => {
  // The position after the first move, standing for the second time
  const twice = Position.fromRecords([...shuffle, shuffle[0]]);
  // In the game: not yet a draw...
  expect(twice.repeated()).toBe(false);
  // ...but it is for a search from before its first time (it can be repeated
  // once more); from that first time on, it is only the game's second
  expect(twice.repeated(0)).toBe(true);
  expect(twice.repeated(1)).toBe(false);
  const thrice = Position.fromRecords([...shuffle, ...shuffle]);
  expect(thrice.repeated()).toBe(true);
  expect(Position.start().repeated()).toBe(false);
});

it('counts the plies since a capture or a pawn move, and forgets the positions before', () => {
  const pos = Position.fromRecords(shuffle.slice(0, 3));
  expect(pos.halfmoves).toBe(3);
  // A pawn move starts the count again: the start can never stand again
  pos.make(pos.findMove({ from: 'Dd4', to: 'Cd4' }));
  expect(pos.halfmoves).toBe(0);
  for (const m of [
    { from: 'Ab1', to: 'Cc1' },
    { from: 'Cc5', to: 'Ed5' },
    { from: 'Cc1', to: 'Ab1' },
    { from: 'Ed5', to: 'Cc5' },
  ]) {
    const move = pos.findMove(m);
    expect(move).not.toBe(0);
    pos.make(move);
  }
  expect(pos.halfmoves).toBe(4);
  // Back where the pawn move left it: a repeat for a search from before then
  expect(pos.repeated(3)).toBe(true);
  expect(pos.repeated(4)).toBe(false);
  pos.makeNull();
  expect(pos.halfmoves).toBe(0);
  pos.unmakeNull();
  expect(pos.halfmoves).toBe(4);
  // Set up directly, part way to the fifty moves
  const set = Position.start();
  set.reset(WHITE_SIDE, 99);
  expect(set.halfmoves).toBe(99);
  set.make(set.findMove({ from: 'Ab1', to: 'Cc1' }));
  expect(set.halfmoves).toBe(100);
});

it('keeps the record of a game of any length', () => {
  // Far more plies than the record holds at first
  const pos = Position.start();
  const played: number[] = [];
  for (let i = 0; i < 300; i++) {
    played.push(pos.findMove(shuffle[i % 4]));
    pos.make(played[i]);
  }
  expect(pos.ply).toBe(300);
  expect(pos.halfmoves).toBe(300);
  expect(pos.repeated()).toBe(true);
  for (let i = 299; i >= 0; i--) pos.unmake(played[i]);
  expect([pos.ply, pos.hashLo, pos.halfmoves]).toEqual([0, Position.start().hashLo, 0]);
});

it('promotes to every piece, the queen first, and names promotions on the wire', () => {
  const pos = new Position();
  pos.board[cellOf(0, 0, 0)] = KING;
  pos.board[cellOf(4, 0, 4)] = KING | BLACK;
  pos.board[cellOf(2, 4, 3)] = PAWN;
  pos.reset(WHITE_SIDE);
  const out = new Int32Array(64);
  const n = pos.legalMoves(out);
  const promotions = [...out.subarray(0, n)].filter((m) => movePromotion(m));
  expect(promotions.map((m) => movePromotion(m))[0]).toBe(QUEEN);
  expect(promotions.map((m) => Position.record(m).promotion).sort()).toEqual([
    'B',
    'N',
    'Q',
    'R',
    'U',
  ]);
  const queen = pos.findMove({ from: 'Dc5', to: 'Ec5', promotion: 'Q' });
  expect(queen).not.toBe(0);
  pos.make(queen);
  expect(pos.board[cellOf(2, 4, 4)]).toBe(QUEEN);
  expect(pos.findMove({ from: 'Aa1', to: 'Ea1' })).toBe(0);
});

it('throws on a record it cannot play', () => {
  expect(() => Position.fromRecords([{ from: 'Aa1', to: 'Ea1' }])).toThrow(/Illegal/);
});

it('numbers cells as the engine does', () => {
  for (let c = 0; c < CELLS; c++) {
    expect(cellOf(CX[c], CY[c], CZ[c])).toBe(c);
  }
  const coord = fromZXY('Cb4');
  expect(cellOf(coord.x, coord.y, coord.z)).toBe(2 * 25 + 1 * 5 + 3);
  // Codes line up with the engine's pieces
  const piece: Piece = { type: PieceType.King, color: 'white' };
  expect(TYPE_CODE[piece.type]).toBe(KING);
});
