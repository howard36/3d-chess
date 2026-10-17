// The computer player's board: the rules of engine/board.ts again, built for
// searching millions of positions rather than for the UI. One byte per cell,
// moves packed into integers, and a move played and taken back in place
// (make/unmake) instead of copying the board. Cells are numbered as the
// engine numbers them (z * 25 + x * 5 + y), so move lists come out in the
// engine's order; position.test.ts checks every move list against the engine.

import { fromZXY, toZXY } from '../engine/coords';
import { BISHOP_VECTORS, KNIGHT_VECTORS, QUEEN_VECTORS, ROOK_VECTORS } from '../engine/pieces';
import { REPETITIONS } from '../engine/draws';
import type { MoveRecord, Promotion } from '../types/messages';

/** A move as the wire writes it, without its side. */
export type WireMove = Pick<MoveRecord, 'from' | 'to' | 'promotion'>;

// Piece codes: the type in the low three bits, BLACK set for Black's pieces
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const UNICORN = 5;
export const QUEEN = 6;
export const KING = 7;
export const BLACK = 8;

export const WHITE_SIDE = 0;
export const BLACK_SIDE = 1;

export const SIZE = 5;
export const CELLS = SIZE * SIZE * SIZE;
export const cellOf = (x: number, y: number, z: number) => z * 25 + x * 5 + y;

/** Each cell's file, rank and level. */
export const CX = new Int8Array(CELLS);
export const CY = new Int8Array(CELLS);
export const CZ = new Int8Array(CELLS);
for (let c = 0; c < CELLS; c++) {
  CZ[c] = Math.floor(c / 25);
  CX[c] = Math.floor(c / 5) % 5;
  CY[c] = c % 5;
}

const inBoard = (x: number, y: number, z: number) =>
  x >= 0 && x < SIZE && y >= 0 && y < SIZE && z >= 0 && z < SIZE;

// --- Precomputed reach -------------------------------------------------------

const DIRS = QUEEN_VECTORS.length; // 26: rook 0-5, bishop 6-17, unicorn 18-25
const ROOK_END = ROOK_VECTORS.length;
const BISHOP_END = ROOK_END + BISHOP_VECTORS.length;
/** The slider (besides the queen) that moves along each direction. */
const SLIDER_OF = new Int8Array(DIRS).map((_, d) =>
  d < ROOK_END ? ROOK : d < BISHOP_END ? BISHOP : UNICORN,
);
/** RAY[(cell * 26 + d) * 4 + n]: the n-th cell along direction d; RAY_LEN its length. */
const RAY = new Int8Array(CELLS * DIRS * 4);
const RAY_LEN = new Uint8Array(CELLS * DIRS);
/** KNIGHT_TO[cell * 24 + i]: the knight's squares, KNIGHT_LEN[cell] of them. */
const KNIGHT_TO = new Int8Array(CELLS * 24);
const KNIGHT_LEN = new Uint8Array(CELLS);
/** A pawn's forward and up steps per side (or -1 off the board). */
const PAWN_FORWARD = [new Int8Array(CELLS), new Int8Array(CELLS)];
const PAWN_UP = [new Int8Array(CELLS), new Int8Array(CELLS)];
/** A pawn's capture squares per side, and the squares a pawn attacks a cell from. */
const PAWN_CAP = [new Int8Array(CELLS * 5), new Int8Array(CELLS * 5)];
const PAWN_CAP_LEN = [new Uint8Array(CELLS), new Uint8Array(CELLS)];
const PAWN_FROM = [new Int8Array(CELLS * 5), new Int8Array(CELLS * 5)];
const PAWN_FROM_LEN = [new Uint8Array(CELLS), new Uint8Array(CELLS)];

// The knight's jumps as [dx, dy, dz], in the engine's order (engine/pieces.ts
// lists them [dz, dx, dy]), so move lists match it exactly
const KNIGHT_DELTAS = KNIGHT_VECTORS.map(([dz, dx, dy]) => [dx, dy, dz]);

for (let c = 0; c < CELLS; c++) {
  const x = CX[c];
  const y = CY[c];
  const z = CZ[c];
  QUEEN_VECTORS.forEach(([dz, dx, dy], d) => {
    let n = 0;
    while (n < 4 && inBoard(x + dx * (n + 1), y + dy * (n + 1), z + dz * (n + 1))) {
      RAY[(c * DIRS + d) * 4 + n] = cellOf(x + dx * (n + 1), y + dy * (n + 1), z + dz * (n + 1));
      n++;
    }
    RAY_LEN[c * DIRS + d] = n;
  });
  for (const [dx, dy, dz] of KNIGHT_DELTAS) {
    if (inBoard(x + dx, y + dy, z + dz))
      KNIGHT_TO[c * 24 + KNIGHT_LEN[c]++] = cellOf(x + dx, y + dy, z + dz);
  }
  for (const side of [WHITE_SIDE, BLACK_SIDE]) {
    const dir = side === WHITE_SIDE ? 1 : -1;
    PAWN_FORWARD[side][c] = inBoard(x, y + dir, z) ? cellOf(x, y + dir, z) : -1;
    PAWN_UP[side][c] = inBoard(x, y, z + dir) ? cellOf(x, y, z + dir) : -1;
    // Forwards-up, forwards-left, forwards-right, up-left, up-right
    for (const [dx, dy, dz] of [
      [0, dir, dir],
      [-1, dir, 0],
      [1, dir, 0],
      [-1, 0, dir],
      [1, 0, dir],
    ]) {
      if (inBoard(x + dx, y + dy, z + dz))
        PAWN_CAP[side][c * 5 + PAWN_CAP_LEN[side][c]++] = cellOf(x + dx, y + dy, z + dz);
      if (inBoard(x - dx, y - dy, z - dz))
        PAWN_FROM[side][c * 5 + PAWN_FROM_LEN[side][c]++] = cellOf(x - dx, y - dy, z - dz);
    }
  }
}

/** LINE[king * 125 + cell]: the direction from `king` along which `cell` lies (-1 if none). */
const LINE = new Int8Array(CELLS * CELLS).fill(-1);
for (let c = 0; c < CELLS; c++) {
  for (let d = 0; d < DIRS; d++) {
    for (let n = 0; n < RAY_LEN[c * DIRS + d]; n++)
      LINE[c * CELLS + RAY[(c * DIRS + d) * 4 + n]] = d;
  }
}

/** Where `side`'s pawns promote: rank 5 of level E for White, rank 1 of level A for Black. */
export const promotes = (cell: number, side: number) =>
  side === WHITE_SIDE ? CY[cell] === 4 && CZ[cell] === 4 : CY[cell] === 0 && CZ[cell] === 0;

// --- What evaluate() adds up ---------------------------------------------------
//
// The judgement's sums over the pieces (evaluate.ts): their values, the
// piece-square tables and how near each cell is to a king. The board keeps
// these sums as each move is played (Position.terms), so a position is
// judged without visiting its pieces. Here, beside the board, so its hot
// loops read them as its own.
//
// Material at the engine's own values (queen 9.8, knight 3.2, bishop 2.95,
// rook 2.45, unicorn 1.4; game/material.ts's "+N" measures its own). On top of it,
// what a club player looks for: pieces brought out towards the middle of the
// cube, pawns pushed on towards their last square (counted more as the board
// empties), the king kept home behind its pawns while queens and knights are
// about and brought out once they are gone.

export const VALUE = new Int16Array(8);
VALUE[PAWN] = 100;
VALUE[KNIGHT] = 320;
VALUE[BISHOP] = 295;
VALUE[ROOK] = 245;
VALUE[UNICORN] = 140;
VALUE[QUEEN] = 980;
VALUE[KING] = 0;

/** Each piece's weight in the game's phase: the opening's 24 down to the endgame's 0. */
export const PHASE = [0, 0, 1, 1, 1, 1, 4, 0];
export const PHASE_MAX = 24;

/** From the middle of the cube (0) to a corner (6), in steps along the axes. */
export const CENTRE = new Int8Array(CELLS);
/** Chebyshev distance between two cells. */
export const DIST = new Uint8Array(CELLS * CELLS);
/** How near a piece on one cell is to a king on another: 4 less the distance, or 0. */
export const NEAR = new Uint8Array(CELLS * CELLS);
for (let c = 0; c < CELLS; c++) {
  CENTRE[c] = Math.abs(CX[c] - 2) + Math.abs(CY[c] - 2) + Math.abs(CZ[c] - 2);
  for (let d = 0; d < CELLS; d++) {
    DIST[c * CELLS + d] = Math.max(
      Math.abs(CX[c] - CX[d]),
      Math.abs(CY[c] - CY[d]),
      Math.abs(CZ[c] - CZ[d]),
    );
    NEAR[c * CELLS + d] = Math.max(0, 4 - DIST[c * CELLS + d]);
  }
}

/** A pawn's worth for how far along it is (rank + level, 0..8; 8 is its last square). */
const PAWN_STEP_MG = [0, 0, 6, 14, 24, 36, 52, 75, 0];
const PAWN_STEP_EG = [0, 0, 10, 24, 42, 66, 100, 150, 0];

// Piece-square tables, material included, from White's side: middlegame and
// endgame, per piece code and cell. Black's are White's turned through the
// centre of the cube.
export const MG = new Int16Array(16 * CELLS);
export const EG = new Int16Array(16 * CELLS);
const mirror = (c: number) => CELLS - 1 - c; // (x, y, z) -> (4 - x, 4 - y, 4 - z)
for (let c = 0; c < CELLS; c++) {
  const centre = CENTRE[c];
  const x = CX[c];
  const y = CY[c];
  const z = CZ[c];
  // White's home is rank 1 and level A: how far out a piece has come
  const out = y + z;
  const set = (type: number, mg: number, eg: number) => {
    MG[type * CELLS + c] = VALUE[type] + mg;
    EG[type * CELLS + c] = VALUE[type] + eg;
    MG[(type | BLACK) * CELLS + mirror(c)] = -(VALUE[type] + mg);
    EG[(type | BLACK) * CELLS + mirror(c)] = -(VALUE[type] + eg);
  };
  const fileBonus = x === 2 ? 6 : x === 1 || x === 3 ? 3 : 0;
  set(PAWN, PAWN_STEP_MG[out] + fileBonus, PAWN_STEP_EG[out]);
  // Developed: off the home rank and level
  const home = y === 0 && z === 0 ? -14 : 0;
  set(KNIGHT, 28 - 8 * centre + home, 18 - 6 * centre);
  set(BISHOP, 16 - 4 * centre + home, 10 - 3 * centre);
  set(UNICORN, 12 - 3 * centre + (y <= 1 && z === 0 ? -8 : 0), 8 - 2 * centre);
  set(ROOK, 6 - centre, 4 - centre);
  // The queen wants the middle, but not too soon (the knights and bishops first)
  set(QUEEN, 6 - 2 * centre, 10 - 3 * centre);
  // Home and behind its pawns while there is an attack to fear; to the middle after
  set(KING, -14 * out - 4 * Math.abs(x - 2), 24 - 8 * centre);
}

/** How much a piece near the enemy king threatens it (pawns and kings: nothing). */
export const TROPISM_WEIGHT = [0, 0, 3, 2, 1, 2, 6, 0];

// --- Moves -------------------------------------------------------------------

// A move is one integer: from (7 bits), to (7), the promotion's type (3), the
// piece taken (4) and the piece moved (4)
export const moveFrom = (m: number) => m & 127;
export const moveTo = (m: number) => (m >> 7) & 127;
export const movePromotion = (m: number) => (m >> 14) & 7;
export const moveCaptured = (m: number) => (m >> 17) & 15;
export const movePiece = (m: number) => (m >> 21) & 15;
const encode = (from: number, to: number, promo: number, captured: number, piece: number) =>
  from | (to << 7) | (promo << 14) | (captured << 17) | (piece << 21);

/** What a pawn may become, best first (the engine lists them Q, R, B, N, U). */
const PROMOTIONS = [QUEEN, KNIGHT, ROOK, BISHOP, UNICORN];

/** Writes a pawn's move to `to` (each promotion, on its last square) at `n`; returns the end. */
const pawnMove = (
  out: Int32Array,
  n: number,
  from: number,
  to: number,
  captured: number,
  piece: number,
  side: number,
) => {
  if (!promotes(to, side)) {
    out[n] = encode(from, to, 0, captured, piece);
    return n + 1;
  }
  for (let i = 0; i < PROMOTIONS.length; i++)
    out[n++] = encode(from, to, PROMOTIONS[i], captured, piece);
  return n;
};

const PROMO_LETTER: Record<number, Promotion> = {
  [QUEEN]: 'Q',
  [ROOK]: 'R',
  [BISHOP]: 'B',
  [KNIGHT]: 'N',
  [UNICORN]: 'U',
};
const LETTER_PROMO: Record<Promotion, number> = {
  Q: QUEEN,
  R: ROOK,
  B: BISHOP,
  N: KNIGHT,
  U: UNICORN,
};

// --- Hashing -----------------------------------------------------------------

// Zobrist keys, two 32-bit halves per piece and cell, from a fixed seed so a
// position hashes the same in every run
const ZOBRIST_LO = new Int32Array(16 * CELLS);
const ZOBRIST_HI = new Int32Array(16 * CELLS);
let zSeed = 0x9e3779b9;
const nextZ = () => {
  // xorshift32
  zSeed ^= zSeed << 13;
  zSeed ^= zSeed >>> 17;
  zSeed ^= zSeed << 5;
  return zSeed | 0;
};
for (let i = 0; i < 16 * CELLS; i++) {
  ZOBRIST_LO[i] = nextZ();
  ZOBRIST_HI[i] = nextZ();
}
const SIDE_LO = nextZ();
const SIDE_HI = nextZ();

/**
 * What evaluate() adds up over the pieces, kept per ply as moves are played
 * (Position.terms, TERMS numbers a ply): the piece-square sums (middlegame,
 * endgame), the phase, and per side (White's, then Black's) its material,
 * its pieces' value (no pawns or kings), its bishops, and its pieces'
 * pressure on the enemy king.
 */
export const T_MG = 0;
export const T_EG = 1;
export const T_PHASE = 2;
export const T_MATERIAL = 3;
export const T_PIECES = 5;
export const T_BISHOPS = 7;
export const T_PRESSURE = 9;
export const TERMS = 11;

/** Plies of history kept at first; the record grows as a game goes on. */
const HISTORY_PLIES = 256;

export class Position {
  /** The piece code on each cell (0 for empty). */
  readonly board = new Uint8Array(CELLS);
  /** WHITE_SIDE or BLACK_SIDE: the side to move. */
  side = WHITE_SIDE;
  /** Each side's king's cell (-1 without one). */
  readonly king = new Int16Array([-1, -1]);
  /**
   * Which cells hold each side's pieces: four 32-bit words a side (White's
   * 0-3, Black's 4-7), cell c at bit c & 31 of word c >> 5. Loops over the
   * pieces walk the set bits instead of all 125 cells.
   */
  readonly occ = new Int32Array(8);
  hashLo = 0;
  hashHi = 0;
  /** The hashes of the positions played through, two halves a ply, for spotting a repetition. */
  private history = new Int32Array(HISTORY_PLIES * 2);
  /**
   * clocks[ply]: the plies since the last capture or pawn move at each
   * position played through (the fifty-move count, engine/draws.ts). No
   * position before the last of those can stand again.
   */
  private clocks = new Int16Array(HISTORY_PLIES);
  /** The sums evaluate() reads, TERMS a ply (T_MG and on): see TERMS. */
  terms = new Int32Array(HISTORY_PLIES * TERMS);
  /** checks[ply]: whether the side to move is in check there (1, 0, or -1 not yet known). */
  private checks = new Int8Array(HISTORY_PLIES);
  /** The index of the current position in `history` (moves played since reset). */
  ply = 0;

  /** The starting position (engine/board.ts setupStartingPosition). */
  static start(): Position {
    const pos = new Position();
    const first = [ROOK, KNIGHT, KING, KNIGHT, ROOK];
    const second = [BISHOP, UNICORN, QUEEN, BISHOP, UNICORN];
    for (let x = 0; x < 5; x++) {
      const place = (y: number, z: number, type: number) => {
        pos.board[cellOf(x, y, z)] = type;
        pos.board[cellOf(4 - x, 4 - y, 4 - z)] = type | BLACK;
      };
      place(0, 0, first[x]);
      place(1, 0, second[x]);
      place(0, 1, PAWN);
      place(1, 1, PAWN);
    }
    pos.reset(WHITE_SIDE);
    return pos;
  }

  /** The starting position with `records` (wire moves) played; throws on an illegal one. */
  static fromRecords(records: readonly WireMove[]): Position {
    const pos = Position.start();
    for (const record of records) {
      const move = pos.findMove(record);
      if (move === 0) throw new Error(`Illegal move ${record.from}-${record.to}`);
      pos.make(move);
    }
    return pos;
  }

  /**
   * Recomputes the kings and the hash after the board was set up directly,
   * with `halfmoves` already played towards the fifty-move draw.
   */
  reset(side: number, halfmoves = 0): void {
    this.side = side;
    this.king[0] = -1;
    this.king[1] = -1;
    let lo = side === BLACK_SIDE ? SIDE_LO : 0;
    let hi = side === BLACK_SIDE ? SIDE_HI : 0;
    this.occ.fill(0);
    for (let c = 0; c < CELLS; c++) {
      const p = this.board[c];
      if (!p) continue;
      this.occ[((p >> 3) << 2) | (c >> 5)] |= 1 << (c & 31);
      lo ^= ZOBRIST_LO[p * CELLS + c];
      hi ^= ZOBRIST_HI[p * CELLS + c];
      // The first king in cell order, as the engine finds it
      if ((p & 7) === KING && this.king[p >> 3] < 0) this.king[p >> 3] = c;
    }
    this.hashLo = lo;
    this.hashHi = hi;
    this.ply = 0;
    this.history[0] = lo;
    this.history[1] = hi;
    this.clocks[0] = halfmoves;
    this.checks[0] = -1;
    const t = this.terms;
    t.fill(0, 0, TERMS);
    for (let c = 0; c < CELLS; c++) {
      const p = this.board[c];
      if (!p) continue;
      const type = p & 7;
      const s = p >> 3;
      t[T_MG] += MG[p * CELLS + c];
      t[T_EG] += EG[p * CELLS + c];
      t[T_PHASE] += PHASE[type];
      t[T_MATERIAL + s] += VALUE[type];
      if (type !== PAWN && type !== KING) t[T_PIECES + s] += VALUE[type];
      if (type === BISHOP) t[T_BISHOPS + s]++;
    }
    t[T_PRESSURE] = this.pressure(WHITE_SIDE);
    t[T_PRESSURE + 1] = this.pressure(BLACK_SIDE);
  }

  /** `side`'s pieces' pressure on the other side's king (TROPISM_WEIGHT by nearness). */
  private pressure(side: number): number {
    const king = this.king[side ^ 1];
    if (king < 0) return 0;
    const board = this.board;
    let sum = 0;
    for (let w = side << 2; w < (side << 2) + 4; w++) {
      let bits = this.occ[w];
      while (bits !== 0) {
        const low = bits & -bits;
        bits ^= low;
        const c = ((w & 3) << 5) | (31 - Math.clz32(low));
        sum += NEAR[c * CELLS + king] * TROPISM_WEIGHT[board[c] & 7];
      }
    }
    return sum;
  }

  /** The plies played since the last capture or pawn move (a hundred draw). */
  get halfmoves(): number {
    return this.clocks[this.ply];
  }

  /** Records the position just reached, at the next ply, with its fifty-move count. */
  private push(clock: number): void {
    const ply = ++this.ply;
    if (ply >= this.clocks.length) {
      const history = new Int32Array(this.history.length * 2);
      history.set(this.history);
      this.history = history;
      const clocks = new Int16Array(this.clocks.length * 2);
      clocks.set(this.clocks);
      this.clocks = clocks;
      const terms = new Int32Array(this.terms.length * 2);
      terms.set(this.terms);
      this.terms = terms;
      const checks = new Int8Array(this.checks.length * 2);
      checks.set(this.checks);
      this.checks = checks;
    }
    this.history[ply * 2] = this.hashLo;
    this.history[ply * 2 + 1] = this.hashHi;
    this.clocks[ply] = clock;
    this.checks[ply] = -1;
    const t = this.terms;
    t.copyWithin(ply * TERMS, (ply - 1) * TERMS, ply * TERMS);
  }

  /** The legal move matching a wire move, or 0. */
  findMove(record: WireMove): number {
    const from = fromZXY(record.from);
    const to = fromZXY(record.to);
    const f = cellOf(from.x, from.y, from.z);
    const t = cellOf(to.x, to.y, to.z);
    const promo = record.promotion ? LETTER_PROMO[record.promotion] : 0;
    const moves = new Int32Array(256);
    const n = this.legalMoves(moves);
    for (let i = 0; i < n; i++) {
      const m = moves[i];
      if (moveFrom(m) === f && moveTo(m) === t && movePromotion(m) === promo) return m;
    }
    return 0;
  }

  /** A move as the wire writes it. */
  static record(move: number): WireMove {
    const from = moveFrom(move);
    const to = moveTo(move);
    const promo = movePromotion(move);
    const record: WireMove = {
      from: toZXY({ x: CX[from], y: CY[from], z: CZ[from] }),
      to: toZXY({ x: CX[to], y: CY[to], z: CZ[to] }),
    };
    if (promo) record.promotion = PROMO_LETTER[promo];
    return record;
  }

  /** Whether any piece of `by` attacks `target` (as the engine counts attacks). */
  attacked(target: number, by: number): boolean {
    const board = this.board;
    const colour = by === BLACK_SIDE ? BLACK : 0;
    const rays = target * DIRS;
    for (let d = 0; d < DIRS; d++) {
      const len = RAY_LEN[rays + d];
      const base = (rays + d) * 4;
      for (let n = 0; n < len; n++) {
        const p = board[RAY[base + n]];
        if (!p) continue;
        if ((p & BLACK) === colour) {
          const t = p & 7;
          if (t === QUEEN || t === SLIDER_OF[d] || (n === 0 && t === KING)) return true;
        }
        break;
      }
    }
    const kn = target * 24;
    for (let i = 0, len = KNIGHT_LEN[target]; i < len; i++) {
      if (board[KNIGHT_TO[kn + i]] === (KNIGHT | colour)) return true;
    }
    const from = PAWN_FROM[by];
    for (let i = 0, len = PAWN_FROM_LEN[by][target]; i < len; i++) {
      if (board[from[target * 5 + i]] === (PAWN | colour)) return true;
    }
    return false;
  }

  /** Whether `side`'s king is attacked. */
  inCheck(side: number = this.side): boolean {
    if (side !== this.side) {
      const k = this.king[side];
      return k >= 0 && this.attacked(k, side ^ 1);
    }
    let known = this.checks[this.ply];
    if (known < 0) {
      const k = this.king[side];
      known = this.checks[this.ply] = k >= 0 && this.attacked(k, side ^ 1) ? 1 : 0;
    }
    return known === 1;
  }

  /**
   * Whether `from`, just emptied, opened a line from `king` (of `side`, not in
   * check before) to an enemy slider: the only way a move other than the
   * king's can leave it in check.
   */
  private exposed(king: number, from: number, side: number): boolean {
    const d = LINE[king * CELLS + from];
    if (d < 0) return false;
    const board = this.board;
    const colour = side === BLACK_SIDE ? 0 : BLACK;
    const base = (king * DIRS + d) * 4;
    for (let n = 0, len = RAY_LEN[king * DIRS + d]; n < len; n++) {
      const p = board[RAY[base + n]];
      if (!p) continue;
      if ((p & BLACK) !== colour) return false;
      const t = p & 7;
      return t === QUEEN || t === SLIDER_OF[d] || (n === 0 && t === KING);
    }
    return false;
  }

  /**
   * Writes the side to move's moves into `out` from `start` (every move the
   * rules allow but for leaving the king in check, which make() leaves to the
   * caller); only captures and promotions with `noisy`. Returns the end.
   */
  generate(out: Int32Array, start: number, noisy = false): number {
    const board = this.board;
    const side = this.side;
    const own = side === BLACK_SIDE ? BLACK : 0;
    let n = start;
    const occ = this.occ;
    for (let w = side << 2; w < (side << 2) + 4; w++) {
      let bits = occ[w];
      while (bits !== 0) {
        const low = bits & -bits;
        bits ^= low;
        const c = ((w & 3) << 5) | (31 - Math.clz32(low));
        const p = board[c];
        const type = p & 7;
        if (type === PAWN) {
          const fwd = PAWN_FORWARD[side][c];
          if (fwd >= 0 && !board[fwd] && (!noisy || promotes(fwd, side)))
            n = pawnMove(out, n, c, fwd, 0, p, side);
          const up = PAWN_UP[side][c];
          if (up >= 0 && !board[up] && (!noisy || promotes(up, side)))
            n = pawnMove(out, n, c, up, 0, p, side);
          const caps = PAWN_CAP[side];
          for (let i = 0, len = PAWN_CAP_LEN[side][c]; i < len; i++) {
            const to = caps[c * 5 + i];
            const q = board[to];
            if (q && (q & BLACK) !== own) n = pawnMove(out, n, c, to, q, p, side);
          }
          continue;
        }
        if (type === KNIGHT) {
          for (let i = 0, len = KNIGHT_LEN[c]; i < len; i++) {
            const to = KNIGHT_TO[c * 24 + i];
            const q = board[to];
            if (q ? (q & BLACK) !== own : !noisy) out[n++] = encode(c, to, 0, q, p);
          }
          continue;
        }
        const d0 = type === BISHOP ? ROOK_END : type === UNICORN ? BISHOP_END : 0;
        const d1 = type === ROOK ? ROOK_END : type === BISHOP ? BISHOP_END : DIRS;
        const reach = type === KING ? 1 : 4;
        for (let d = d0; d < d1; d++) {
          const len = Math.min(reach, RAY_LEN[c * DIRS + d]);
          const base = (c * DIRS + d) * 4;
          for (let i = 0; i < len; i++) {
            const to = RAY[base + i];
            const q = board[to];
            if (!q) {
              if (!noisy) out[n++] = encode(c, to, 0, 0, p);
              continue;
            }
            if ((q & BLACK) !== own) out[n++] = encode(c, to, 0, q, p);
            break;
          }
        }
      }
    }
    return n;
  }

  /** Plays `move` (from generate()); returns false if it left the mover's king in check (still played). */
  make(move: number): boolean {
    const board = this.board;
    const from = moveFrom(move);
    const to = moveTo(move);
    const piece = movePiece(move);
    const captured = moveCaptured(move);
    const promo = movePromotion(move);
    const side = this.side;
    const type = piece & 7;
    // Not in check, a move but the king's can only expose it along one line
    const safe = type !== KING && this.king[side] >= 0 && !this.inCheck();
    const placed = promo ? promo | (piece & BLACK) : piece;
    let lo = this.hashLo ^ ZOBRIST_LO[piece * CELLS + from] ^ ZOBRIST_LO[placed * CELLS + to];
    let hi = this.hashHi ^ ZOBRIST_HI[piece * CELLS + from] ^ ZOBRIST_HI[placed * CELLS + to];
    if (captured) {
      lo ^= ZOBRIST_LO[captured * CELLS + to];
      hi ^= ZOBRIST_HI[captured * CELLS + to];
      if ((captured & 7) === KING) this.king[captured >> 3] = -1;
    }
    board[from] = 0;
    board[to] = placed;
    const occ = this.occ;
    occ[(side << 2) | (from >> 5)] ^= 1 << (from & 31);
    occ[(side << 2) | (to >> 5)] ^= 1 << (to & 31);
    if (captured) occ[((side ^ 1) << 2) | (to >> 5)] ^= 1 << (to & 31);
    if (type === KING) this.king[side] = to;
    this.side = side ^ 1;
    this.hashLo = lo ^ SIDE_LO;
    this.hashHi = hi ^ SIDE_HI;
    this.push(captured || type === PAWN ? 0 : this.clocks[this.ply] + 1);

    // The sums evaluate() reads, the move's change to them
    const t = this.terms;
    const o = this.ply * TERMS;
    const enemy = side ^ 1;
    t[o + T_MG] += MG[placed * CELLS + to] - MG[piece * CELLS + from];
    t[o + T_EG] += EG[placed * CELLS + to] - EG[piece * CELLS + from];
    if (promo) {
      t[o + T_PHASE] += PHASE[promo];
      t[o + T_MATERIAL + side] += VALUE[promo] - VALUE[PAWN];
      t[o + T_PIECES + side] += VALUE[promo];
      if (promo === BISHOP) t[o + T_BISHOPS + side]++;
    }
    const enemyKing = this.king[enemy];
    if (captured) {
      const ct = captured & 7;
      t[o + T_MG] -= MG[captured * CELLS + to];
      t[o + T_EG] -= EG[captured * CELLS + to];
      t[o + T_PHASE] -= PHASE[ct];
      t[o + T_MATERIAL + enemy] -= VALUE[ct];
      if (ct !== PAWN && ct !== KING) t[o + T_PIECES + enemy] -= VALUE[ct];
      if (ct === BISHOP) t[o + T_BISHOPS + enemy]--;
      if (ct === KING) t[o + T_PRESSURE + side] = 0;
      else if (type !== KING && this.king[side] >= 0)
        t[o + T_PRESSURE + enemy] -= NEAR[to * CELLS + this.king[side]] * TROPISM_WEIGHT[ct];
    }
    if (enemyKing >= 0)
      t[o + T_PRESSURE + side] +=
        NEAR[to * CELLS + enemyKing] * TROPISM_WEIGHT[placed & 7] -
        NEAR[from * CELLS + enemyKing] * TROPISM_WEIGHT[type];
    // The king moved: every enemy piece is nearer it or farther
    if (type === KING) t[o + T_PRESSURE + enemy] = this.pressure(enemy);

    const k = this.king[side];
    if (k < 0) return true;
    return safe ? !this.exposed(k, from, side) : !this.attacked(k, enemy);
  }

  /** Takes back `move`, the last move made. */
  unmake(move: number): void {
    const board = this.board;
    const from = moveFrom(move);
    const to = moveTo(move);
    const piece = movePiece(move);
    const captured = moveCaptured(move);
    const side = (this.side ^= 1);
    board[from] = piece;
    board[to] = captured;
    const occ = this.occ;
    occ[(side << 2) | (from >> 5)] ^= 1 << (from & 31);
    occ[(side << 2) | (to >> 5)] ^= 1 << (to & 31);
    if (captured) occ[((side ^ 1) << 2) | (to >> 5)] ^= 1 << (to & 31);
    if ((piece & 7) === KING) this.king[this.side] = from;
    if (captured && (captured & 7) === KING) this.king[captured >> 3] = to;
    this.ply--;
    this.hashLo = this.history[this.ply * 2];
    this.hashHi = this.history[this.ply * 2 + 1];
  }

  /**
   * Passes the move (null-move pruning): the other side moves next. No line
   * through a pass is a real game, so it counts as a capture would: nothing
   * before it repeats, and the fifty moves start again.
   */
  makeNull(): void {
    this.side ^= 1;
    this.hashLo ^= SIDE_LO;
    this.hashHi ^= SIDE_HI;
    this.push(0);
  }

  unmakeNull(): void {
    this.side ^= 1;
    this.ply--;
    this.hashLo = this.history[this.ply * 2];
    this.hashHi = this.history[this.ply * 2 + 1];
  }

  /**
   * Whether this position is a draw by repetition for a search from the
   * position at ply `root`: standing for the third time (twice before, with
   * the same side to move), or for the second time inside the line searched,
   * which can always be repeated once more. Only positions since the last
   * capture or pawn move can match.
   */
  repeated(root: number = this.ply): boolean {
    const lo = this.hashLo;
    const hi = this.hashHi;
    const oldest = Math.max(0, this.ply - this.clocks[this.ply]);
    let before = 0;
    for (let p = this.ply - 2; p >= oldest; p -= 2) {
      if (this.history[p * 2] !== lo || this.history[p * 2 + 1] !== hi) continue;
      if (p > root || ++before >= REPETITIONS - 1) return true;
    }
    return false;
  }

  /**
   * The squares each piece could move to (its own pieces aside), weighted by
   * `weights[type]`: White's less Black's. Kings and pawns are not counted.
   */
  mobility(weights: readonly number[]): number {
    const board = this.board;
    let score = 0;
    const occ = this.occ;
    for (let word = 0; word < 8; word++) {
      let bits = occ[word];
      while (bits !== 0) {
        const low = bits & -bits;
        bits ^= low;
        const c = ((word & 3) << 5) | (31 - Math.clz32(low));
        const p = board[c];
        const type = p & 7;
        const w = weights[type];
        if (!w) continue;
        const own = p & BLACK;
        let count = 0;
        if (type === KNIGHT) {
          for (let i = 0, len = KNIGHT_LEN[c]; i < len; i++) {
            const q = board[KNIGHT_TO[c * 24 + i]];
            if (!q || (q & BLACK) !== own) count++;
          }
        } else {
          const d0 = type === BISHOP ? ROOK_END : type === UNICORN ? BISHOP_END : 0;
          const d1 = type === ROOK ? ROOK_END : type === BISHOP ? BISHOP_END : DIRS;
          for (let d = d0; d < d1; d++) {
            const len = RAY_LEN[c * DIRS + d];
            const base = (c * DIRS + d) * 4;
            for (let i = 0; i < len; i++) {
              const q = board[RAY[base + i]];
              if (!q) {
                count++;
                continue;
              }
              if ((q & BLACK) !== own) count++;
              break;
            }
          }
        }
        score += own ? -w * count : w * count;
      }
    }
    return score;
  }

  /** Writes the side to move's legal moves into `out`; returns how many. */
  legalMoves(out: Int32Array): number {
    const scratch = new Int32Array(512);
    const end = this.generate(scratch, 0);
    let n = 0;
    for (let i = 0; i < end; i++) {
      const m = scratch[i];
      if (this.make(m)) out[n++] = m;
      this.unmake(m);
    }
    return n;
  }
}
