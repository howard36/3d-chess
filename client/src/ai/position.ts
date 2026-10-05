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
const inBoard = (x: number, y: number, z: number) =>
  x >= 0 && x < SIZE && y >= 0 && y < SIZE && z >= 0 && z < SIZE;

/** Each cell's file, rank and level. */
export const CX = new Int8Array(CELLS);
export const CY = new Int8Array(CELLS);
export const CZ = new Int8Array(CELLS);
for (let c = 0; c < CELLS; c++) {
  CZ[c] = Math.floor(c / 25);
  CX[c] = Math.floor(c / 5) % 5;
  CY[c] = c % 5;
}

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

/** Where `side`'s pawns promote: rank 5 of level E for White, rank 1 of level A for Black. */
export const promotes = (cell: number, side: number) =>
  side === WHITE_SIDE ? CY[cell] === 4 && CZ[cell] === 4 : CY[cell] === 0 && CZ[cell] === 0;

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
   * pieces walk the set bits instead of all 125 cells (see forEachBit).
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
    }
    this.history[ply * 2] = this.hashLo;
    this.history[ply * 2 + 1] = this.hashHi;
    this.clocks[ply] = clock;
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
    const k = this.king[side];
    return k >= 0 && this.attacked(k, side ^ 1);
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
    if ((piece & 7) === KING) this.king[side] = to;
    this.side = side ^ 1;
    this.hashLo = lo ^ SIDE_LO;
    this.hashHi = hi ^ SIDE_HI;
    this.push(captured || (piece & 7) === PAWN ? 0 : this.clocks[this.ply] + 1);
    const k = this.king[side];
    return k < 0 || !this.attacked(k, side ^ 1);
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
