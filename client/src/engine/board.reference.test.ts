import { ALL_PROMOTION_TYPES, Board } from './board';
import type { Move } from './board';
import type { Coord } from './coords';
import {
  BISHOP_VECTORS,
  KING_VECTORS,
  KNIGHT_VECTORS,
  PieceType,
  QUEEN_VECTORS,
  ROOK_VECTORS,
  UNICORN_VECTORS,
} from './pieces';
import type { Piece } from './pieces';

// The rules written the slow, obvious way, through Board's public accessors
// only: every piece's attacks listed out, and every candidate move tried on
// a fresh copy of the board. The engine keeps its own faster bookkeeping, so
// it is compared with this on many positions, move lists in order.

type Color = 'white' | 'black';
const N = 5;
const inside = (c: Coord) => c.x >= 0 && c.x < N && c.y >= 0 && c.y < N && c.z >= 0 && c.z < N;
const squares: Coord[] = [];
for (let z = 0; z < N; z++)
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) squares.push({ x, y, z });

const VECTORS: Record<Exclude<PieceType, PieceType.Pawn>, [readonly number[][], boolean]> = {
  [PieceType.Rook]: [ROOK_VECTORS, true],
  [PieceType.Bishop]: [BISHOP_VECTORS, true],
  [PieceType.Unicorn]: [UNICORN_VECTORS, true],
  [PieceType.Queen]: [QUEEN_VECTORS, true],
  [PieceType.King]: [KING_VECTORS, false],
  [PieceType.Knight]: [KNIGHT_VECTORS, false],
};
const pawnCaptures = (dir: number) => [
  [0, dir, dir],
  [-1, dir, 0],
  [1, dir, 0],
  [-1, 0, dir],
  [1, 0, dir],
];
const promotes = (c: Coord, color: Color) =>
  color === 'white' ? c.y === N - 1 && c.z === N - 1 : c.y === 0 && c.z === 0;

const copy = (b: Board) => {
  const out = new Board();
  for (const s of squares) out.setPiece(s, b.getPiece(s));
  return out;
};

const attacks = (b: Board, from: Coord): Coord[] => {
  const p = b.getPiece(from)!;
  const out: Coord[] = [];
  if (p.type === PieceType.Pawn) {
    for (const [dx, dy, dz] of pawnCaptures(p.color === 'white' ? 1 : -1)) {
      const to = { x: from.x + dx, y: from.y + dy, z: from.z + dz };
      if (inside(to)) out.push(to);
    }
    return out;
  }
  const [vectors, sliding] = VECTORS[p.type];
  for (const [dz, dx, dy] of vectors) {
    for (let n = 1; ; n++) {
      const to = { x: from.x + dx * n, y: from.y + dy * n, z: from.z + dz * n };
      if (!inside(to)) break;
      out.push(to);
      if (b.getPiece(to) || !sliding) break;
    }
  }
  return out;
};

const attacked = (b: Board, t: Coord, by: Color) =>
  squares.some(
    (s) =>
      b.getPiece(s)?.color === by &&
      attacks(b, s).some((a) => a.x === t.x && a.y === t.y && a.z === t.z),
  );

const kingOf = (b: Board, color: Color) => {
  const k = squares.find((s) => {
    const p = b.getPiece(s);
    return p?.type === PieceType.King && p.color === color;
  });
  if (!k) throw new Error(`King of color ${color} not found`);
  return k;
};

const inCheck = (b: Board, color: Color) =>
  attacked(b, kingOf(b, color), color === 'white' ? 'black' : 'white');

const potential = (b: Board, from: Coord): Move[] => {
  const p = b.getPiece(from)!;
  const out: Move[] = [];
  if (p.type === PieceType.Pawn) {
    const dir = p.color === 'white' ? 1 : -1;
    const add = (to: Coord, capture: boolean) => {
      if (!inside(to)) return;
      const t = b.getPiece(to);
      if (capture ? !t || t.color === p.color : t) return;
      if (promotes(to, p.color))
        for (const promotion of ALL_PROMOTION_TYPES) out.push({ from, to, promotion });
      else out.push({ from, to, promotion: undefined });
    };
    add({ x: from.x, y: from.y + dir, z: from.z }, false);
    add({ x: from.x, y: from.y, z: from.z + dir }, false);
    for (const [dx, dy, dz] of pawnCaptures(dir))
      add({ x: from.x + dx, y: from.y + dy, z: from.z + dz }, true);
    return out;
  }
  const [vectors, sliding] = VECTORS[p.type];
  for (const [dz, dx, dy] of vectors) {
    for (let n = 1; ; n++) {
      const to = { x: from.x + dx * n, y: from.y + dy * n, z: from.z + dz * n };
      if (!inside(to)) break;
      const t = b.getPiece(to);
      if (!t || t.color !== p.color) out.push({ from, to, promotion: undefined });
      if (t || !sliding) break;
    }
  }
  return out;
};

const legal = (b: Board, from: Coord): Move[] => {
  const color = b.getPiece(from)!.color;
  return potential(b, from).filter((m) => {
    const next = copy(b);
    const p = next.getPiece(m.from)!;
    next.setPiece(m.from, null);
    next.setPiece(m.to, m.promotion ? { type: m.promotion, color } : p);
    return !inCheck(next, color);
  });
};

const allLegal = (b: Board, color: Color) =>
  squares.filter((s) => b.getPiece(s)?.color === color).flatMap((s) => legal(b, s));

// Deterministic pseudo-random numbers (mulberry32), so a failure replays.
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const TYPES = Object.values(PieceType);

/** A sparse random position with one king a side (maybe in check, maybe both). */
const randomPosition = (random: () => number): Board => {
  const b = new Board();
  const free = [...squares];
  const take = () => free.splice(Math.floor(random() * free.length), 1)[0];
  b.setPiece(take(), { type: PieceType.King, color: 'white' });
  b.setPiece(take(), { type: PieceType.King, color: 'black' });
  const count = 2 + Math.floor(random() * 18);
  for (let i = 0; i < count; i++) {
    const type = TYPES[Math.floor(random() * TYPES.length)];
    if (type === PieceType.King) continue;
    const piece: Piece = { type, color: random() < 0.5 ? 'white' : 'black' };
    b.setPiece(take(), piece);
  }
  return b;
};

const expectSameRules = (b: Board) => {
  for (const color of ['white', 'black'] as const) {
    expect(b.generateAllLegalMoves(color)).toEqual(allLegal(b, color));
    expect(b.inCheck(color)).toBe(inCheck(b, color));
    const none = allLegal(b, color).length === 0;
    expect(b.isCheckmate(color)).toBe(none && inCheck(b, color));
    expect(b.isStalemate(color)).toBe(none && !inCheck(b, color));
  }
};

describe('the engine agrees with the rules written out naively', () => {
  it('along random games', () => {
    for (const seed of [11, 12, 13]) {
      const random = rng(seed);
      let b = Board.setupStartingPosition();
      let color: Color = 'white';
      for (let ply = 0; ply < 60; ply++) {
        if (ply % 5 === 0) expectSameRules(b);
        const moves = b.generateAllLegalMoves(color);
        if (moves.length === 0) break;
        b = b.applyMove(moves[Math.floor(random() * moves.length)]);
        color = color === 'white' ? 'black' : 'white';
      }
      expectSameRules(b);
    }
  });

  it('in random sparse positions, attacks on every square included', () => {
    const random = rng(7);
    for (let i = 0; i < 80; i++) {
      const b = randomPosition(random);
      expectSameRules(b);
      for (const s of squares) {
        expect(b.isSquareAttacked(s, 'white')).toBe(attacked(b, s, 'white'));
        expect(b.isSquareAttacked(s, 'black')).toBe(attacked(b, s, 'black'));
      }
    }
  });

  it('never lets a king step back along the line that checks it', () => {
    // King mid-board, checked by a rook, a bishop and a unicorn in turn: the
    // square behind the king on the checking line stays attacked once the
    // king has left it
    for (const [checker, at, behind] of [
      [PieceType.Rook, { x: 2, y: 2, z: 0 }, { x: 2, y: 2, z: 3 }],
      [PieceType.Bishop, { x: 0, y: 2, z: 0 }, { x: 3, y: 2, z: 3 }],
      [PieceType.Unicorn, { x: 0, y: 0, z: 0 }, { x: 3, y: 3, z: 3 }],
    ] as const) {
      const b = new Board();
      b.setPiece({ x: 2, y: 2, z: 2 }, { type: PieceType.King, color: 'white' });
      b.setPiece({ x: 4, y: 4, z: 4 }, { type: PieceType.King, color: 'black' });
      b.setPiece(at, { type: checker, color: 'black' });
      expect(b.inCheck('white')).toBe(true);
      const tos = b.generateLegalMoves({ x: 2, y: 2, z: 2 }).map((m) => m.to);
      expect(tos).not.toContainEqual(behind);
      expect(b.generateLegalMoves({ x: 2, y: 2, z: 2 })).toEqual(legal(b, { x: 2, y: 2, z: 2 }));
    }
  });

  it('asks for the mover’s king only when a move has to be tried', () => {
    const b = new Board();
    b.setPiece({ x: 0, y: 0, z: 0 }, { type: PieceType.Rook, color: 'white' });
    expect(() => b.generateLegalMoves({ x: 0, y: 0, z: 0 })).toThrow(
      'King of color white not found',
    );
    // Hemmed in: no candidate, so no king is looked for
    const shut = new Board();
    shut.setPiece({ x: 0, y: 0, z: 0 }, { type: PieceType.Pawn, color: 'white' });
    shut.setPiece({ x: 0, y: 1, z: 0 }, { type: PieceType.Pawn, color: 'white' });
    shut.setPiece({ x: 0, y: 0, z: 1 }, { type: PieceType.Pawn, color: 'white' });
    expect(shut.generateLegalMoves({ x: 0, y: 0, z: 0 })).toEqual([]);
  });

  it('leaves the board as it found it after trying moves', () => {
    const b = Board.setupStartingPosition();
    const before = squares.map((s) => b.getPiece(s));
    b.generateAllLegalMoves('white');
    b.isCheckmate('black');
    b.isStalemate('white');
    expect(squares.map((s) => b.getPiece(s))).toEqual(before);
    squares.forEach((s, i) => expect(b.getPiece(s)).toBe(before[i]));
  });
});
