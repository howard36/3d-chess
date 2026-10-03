// The computer's look-ahead: iterative deepening alpha-beta (principal
// variation search) with a transposition table, a quiescence search over
// captures, null-move pruning, late-move reductions, check extensions and
// killer and history move ordering.
//
// Unlike a pure engine, the root gives an exact score to every move within
// `margin` of the best, not just the best one: the levels (levels.ts) choose
// among the moves a player would consider, not always the top one. A level
// can also hide moves from the search (`hidden`): the moves its player would
// not notice, the opponent's long lines across levels.

import { LAZY, VALUE, evaluate, mobilityScore } from './evaluate';
import { KING, PAWN, QUEEN, moveCaptured, movePiece, movePromotion, moveTo } from './position';
import type { Position } from './position';

export const INF = 32000;
export const MATE = 31000;
/** Scores beyond this are mates (MATE less the moves to it). */
export const MATE_BOUND = MATE - 512;

const MAX_PLY = 64;
const MOVES_PER_PLY = 512;

export interface SearchLimits {
  /** The deepest iteration, in plies. */
  maxDepth: number;
  /** Stop after this long (milliseconds); the first iteration always completes. */
  timeMs: number;
  /** Stop after this many nodes (for repeatable tests). */
  maxNodes?: number;
  /** Root moves scoring within this of the best get an exact score. */
  margin: number;
  /** The quiescence search's deepest line of captures, in plies. */
  quiescence?: number;
  /** Moves the side searching does not see below the root (they are not searched). */
  hidden?: (move: number) => boolean;
  /** The clock (performance.now by default). */
  now?: () => number;
}

export interface RootScore {
  move: number;
  /** Exact when within `margin` of the best; otherwise at most this. */
  score: number;
}

export interface SearchResult {
  /** The best move found (0 if there is no legal move). */
  move: number;
  score: number;
  /** The deepest iteration completed. */
  depth: number;
  nodes: number;
  /** The root moves within `margin` of the best, best first, exactly scored. */
  candidates: RootScore[];
  /** Every legal root move with its score (exact or an upper bound). */
  scores: RootScore[];
}

// Transposition table: 2^18 entries, the key's low half picking the slot and
// its high half checking it
const TT_BITS = 18;
const TT_SIZE = 1 << TT_BITS;
const TT_MASK = TT_SIZE - 1;
const EXACT = 1;
const LOWER = 2;
const UPPER = 3;

/**
 * Captures first, the most valuable victim by the least valuable attacker:
 * each attacker's rank (pawn, unicorn, rook, knight, bishop, queen, king).
 */
const ATTACKER_ORDER = [0, 0, 3, 3, 2, 1, 4, 5];

export class Searcher {
  private readonly ttCheck = new Int32Array(TT_SIZE);
  private readonly ttMove = new Int32Array(TT_SIZE);
  private readonly ttScore = new Int16Array(TT_SIZE);
  private readonly ttDepth = new Int8Array(TT_SIZE);
  private readonly ttFlag = new Uint8Array(TT_SIZE);
  private readonly moves = new Int32Array(MAX_PLY * MOVES_PER_PLY);
  private readonly order = new Int32Array(MAX_PLY * MOVES_PER_PLY);
  private readonly killers = new Int32Array(MAX_PLY * 2);
  /** history[piece * 125 + to]: how often a quiet move there has cut off. */
  private readonly history = new Int32Array(16 * 125);
  private nodes = 0;
  private stopped = false;
  private deadline = 0;
  private maxNodes = Infinity;
  private qLimit = 64;
  private hidden: ((move: number) => boolean) | undefined;
  private now: () => number = () => performance.now();
  private canStop = false;

  constructor(private readonly pos: Position) {}

  search(limits: SearchLimits): SearchResult {
    const pos = this.pos;
    this.nodes = 0;
    this.stopped = false;
    this.canStop = false;
    this.now = limits.now ?? (() => performance.now());
    this.deadline = this.now() + limits.timeMs;
    this.maxNodes = limits.maxNodes ?? Infinity;
    this.qLimit = limits.quiescence ?? 64;
    this.hidden = limits.hidden;
    this.killers.fill(0);
    this.history.fill(0);
    this.ttFlag.fill(0);
    const margin = limits.margin;

    // The legal root moves, in move-ordering order to begin with
    const root: number[] = [];
    const end = pos.generate(this.moves, 0);
    for (let i = 0; i < end; i++) {
      const m = this.moves[i];
      if (pos.make(m)) root.push(m);
      pos.unmake(m);
    }
    const result: SearchResult = {
      move: 0,
      score: pos.inCheck() ? -MATE : 0,
      depth: 0,
      nodes: 0,
      candidates: [],
      scores: [],
    };
    if (root.length === 0) return result;
    const rootScore = new Map<number, number>(root.map((m) => [m, -INF]));
    // Whether each root move's score is exact, or only a bound it falls below
    const rootExact = new Set<number>();
    root.sort((a, b) => this.staticOrder(b) - this.staticOrder(a));

    for (let depth = 1; depth <= limits.maxDepth; depth++) {
      let best = -INF;
      let bestMove = 0;
      const scores = new Map<number, number>();
      const exact = new Set<number>();
      for (let i = 0; i < root.length; i++) {
        const m = root[i];
        pos.make(m);
        let s: number;
        const floor = margin >= INF ? -INF : best - margin;
        if (i === 0 || floor <= -INF) {
          s = -this.negamax(depth - 1, -INF, INF, 1, true);
          exact.add(m);
        } else {
          // A null window first: most moves fall short of the floor, and
          // their score is then only a bound (at most the floor)
          s = -this.negamax(depth - 1, -floor - 1, -floor, 1, true);
          if (s > floor && !this.stopped) {
            s = -this.negamax(depth - 1, -INF, -floor, 1, true);
            if (s > floor) exact.add(m);
          }
        }
        pos.unmake(m);
        if (this.stopped) break;
        scores.set(m, s);
        if (s > best) {
          best = s;
          bestMove = m;
        }
      }
      if (this.stopped && depth > 1) break;
      for (const [m, s] of scores) rootScore.set(m, s);
      rootExact.clear();
      for (const m of exact) rootExact.add(m);
      result.move = bestMove;
      result.score = best;
      result.depth = depth;
      // The best first next time, then the rest by this iteration's scores
      root.sort((a, b) => rootScore.get(b)! - rootScore.get(a)!);
      this.canStop = true;
      if (root.length === 1) break;
      // A mate found is not bettered by looking deeper
      if (Math.abs(best) >= MATE_BOUND && depth >= MATE - Math.abs(best)) break;
      // An iteration takes several times the last: don't start one that can't finish
      if (this.now() > this.deadline - limits.timeMs * 0.55) break;
      if (this.nodes >= this.maxNodes) break;
    }

    result.nodes = this.nodes;
    const floor = margin >= INF ? -INF : result.score - margin;
    result.scores = root.map((move) => ({ move, score: rootScore.get(move)! }));
    result.candidates = result.scores.filter(
      (r) => r.move === result.move || (rootExact.has(r.move) && r.score >= floor),
    );
    return result;
  }

  /** Root ordering before any search: captures by value, then promotions. */
  private staticOrder(m: number): number {
    const captured = moveCaptured(m);
    let s = captured ? 1000 + VALUE[captured & 7] - ATTACKER_ORDER[movePiece(m) & 7] : 0;
    if (movePromotion(m) === QUEEN) s += 900;
    return s;
  }

  private checkTime(): void {
    if (!this.canStop) return;
    if ((this.nodes & 1023) === 0 && this.now() > this.deadline) this.stopped = true;
    if (this.nodes >= this.maxNodes) this.stopped = true;
  }

  private negamax(
    depth: number,
    alpha: number,
    beta: number,
    ply: number,
    allowNull: boolean,
  ): number {
    const pos = this.pos;
    if (ply > 0 && pos.repeated()) return 0;
    const inCheck = pos.inCheck();
    if (inCheck && ply < MAX_PLY - 8) depth++;
    if (depth <= 0) return this.quiesce(alpha, beta, ply, 0);
    this.nodes++;
    this.checkTime();
    if (this.stopped) return 0;
    if (ply >= MAX_PLY - 2) return evaluate(pos);

    // Mate distance: no line from here beats a mate already found nearer the root
    const mateHere = MATE - ply;
    if (mateHere < beta) {
      beta = mateHere;
      if (alpha >= beta) return beta;
    }

    const pv = beta - alpha > 1;
    const slot = pos.hashLo & TT_MASK;
    let ttMove = 0;
    if (this.ttFlag[slot] && this.ttCheck[slot] === pos.hashHi) {
      ttMove = this.ttMove[slot];
      if (!pv && this.ttDepth[slot] >= depth) {
        const s = fromTT(this.ttScore[slot], ply);
        const flag = this.ttFlag[slot];
        if (flag === EXACT || (flag === LOWER && s >= beta) || (flag === UPPER && s <= alpha))
          return s;
      }
    }

    const staticEval = inCheck ? -INF : evaluate(pos);
    if (!pv && !inCheck) {
      // Far above beta with little depth left: nothing will bring it down
      if (depth <= 2 && staticEval - 160 * depth >= beta && Math.abs(beta) < MATE_BOUND)
        return staticEval;
      // Even passing the move holds beta (not with only pawns: zugzwang)
      if (allowNull && depth >= 3 && staticEval >= beta && this.hasPieces()) {
        const r = depth > 6 ? 3 : 2;
        pos.makeNull();
        const s = -this.negamax(depth - 1 - r, -beta, -beta + 1, ply + 1, false);
        pos.unmakeNull();
        if (this.stopped) return 0;
        if (s >= beta) return s >= MATE_BOUND ? beta : s;
      }
    }

    const base = ply * MOVES_PER_PLY;
    const end = pos.generate(this.moves, base);
    this.scoreMoves(base, end, ttMove, ply);
    let best = -INF;
    let bestMove = 0;
    let legal = 0;
    let seen = 0;
    const startAlpha = alpha;
    const futile = !pv && !inCheck && depth === 1 && staticEval + 220 <= alpha;
    for (let i = base; i < end; i++) {
      const m = this.pickNext(i, end);
      const quiet = !moveCaptured(m) && !movePromotion(m);
      if (!pos.make(m)) {
        pos.unmake(m);
        continue;
      }
      legal++;
      if (!inCheck && this.hidden?.(m)) {
        pos.unmake(m);
        continue;
      }
      if (futile && quiet && seen > 0 && !pos.inCheck()) {
        pos.unmake(m);
        continue;
      }
      seen++;
      let s: number;
      if (seen === 1) {
        s = -this.negamax(depth - 1, -beta, -alpha, ply + 1, true);
      } else {
        // Late quiet moves first get a shallower look
        let r = 0;
        if (depth >= 3 && seen > 3 && quiet && !inCheck && !pos.inCheck()) {
          r = seen > 10 && depth >= 5 ? 2 : 1;
        }
        s = -this.negamax(depth - 1 - r, -alpha - 1, -alpha, ply + 1, true);
        if (s > alpha && r > 0) s = -this.negamax(depth - 1, -alpha - 1, -alpha, ply + 1, true);
        if (s > alpha && s < beta) s = -this.negamax(depth - 1, -beta, -alpha, ply + 1, true);
      }
      pos.unmake(m);
      if (this.stopped) return 0;
      if (s > best) {
        best = s;
        bestMove = m;
        if (s > alpha) {
          alpha = s;
          if (s >= beta) {
            if (quiet) {
              const k = ply * 2;
              if (this.killers[k] !== m) {
                this.killers[k + 1] = this.killers[k];
                this.killers[k] = m;
              }
              const h = movePiece(m) * 125 + moveTo(m);
              this.history[h] += depth * depth;
              if (this.history[h] > 1 << 20)
                for (let j = 0; j < this.history.length; j++) this.history[j] >>= 1;
            }
            break;
          }
        }
      }
    }

    if (legal === 0) return inCheck ? -(MATE - ply) : 0;
    // Every legal move hidden (or pruned): the position as it stands
    if (seen === 0) return inCheck ? -(MATE - ply) : staticEval;

    const flag = best >= beta ? LOWER : best > startAlpha ? EXACT : UPPER;
    if (
      this.ttFlag[slot] === 0 ||
      this.ttCheck[slot] !== pos.hashHi ||
      depth >= this.ttDepth[slot]
    ) {
      this.ttCheck[slot] = pos.hashHi;
      this.ttMove[slot] = bestMove;
      this.ttScore[slot] = toTT(best, ply);
      this.ttDepth[slot] = depth;
      this.ttFlag[slot] = flag;
    }
    return best;
  }

  /** Captures and promotions only, until the position is quiet. */
  private quiesce(alpha: number, beta: number, ply: number, qply: number): number {
    const pos = this.pos;
    this.nodes++;
    this.checkTime();
    if (this.stopped) return 0;
    // Mobility only where it could matter: not far above beta or below alpha
    const rough = evaluate(pos, false);
    if (rough - LAZY >= beta) return rough;
    const stand = rough + LAZY <= alpha ? rough : rough + mobilityScore(pos);
    if (stand >= beta) return stand;
    if (ply >= MAX_PLY - 1 || qply >= this.qLimit) return stand;
    if (stand > alpha) alpha = stand;
    let best = stand;
    const base = ply * MOVES_PER_PLY;
    const end = pos.generate(this.moves, base, true);
    this.scoreMoves(base, end, 0, ply);
    for (let i = base; i < end; i++) {
      const m = this.pickNext(i, end);
      const captured = moveCaptured(m);
      // Even winning this piece outright cannot reach alpha
      if (!movePromotion(m) && stand + VALUE[captured & 7] + 200 <= alpha) continue;
      if (!pos.make(m)) {
        pos.unmake(m);
        continue;
      }
      if (this.hidden?.(m)) {
        pos.unmake(m);
        continue;
      }
      const s = -this.quiesce(-beta, -alpha, ply + 1, qply + 1);
      pos.unmake(m);
      if (this.stopped) return 0;
      if (s > best) {
        best = s;
        if (s > alpha) {
          alpha = s;
          if (s >= beta) break;
        }
      }
    }
    return best;
  }

  /** Whether the side to move has a piece besides pawns and its king. */
  private hasPieces(): boolean {
    const { board, occ, side } = this.pos;
    for (let w = side << 2; w < (side << 2) + 4; w++) {
      let bits = occ[w];
      while (bits !== 0) {
        const low = bits & -bits;
        bits ^= low;
        const type = board[((w & 3) << 5) | (31 - Math.clz32(low))] & 7;
        if (type !== PAWN && type !== KING) return true;
      }
    }
    return false;
  }

  private scoreMoves(base: number, end: number, ttMove: number, ply: number): void {
    const k0 = this.killers[ply * 2];
    const k1 = this.killers[ply * 2 + 1];
    for (let i = base; i < end; i++) {
      const m = this.moves[i];
      let s: number;
      if (m === ttMove) s = 1 << 30;
      else {
        const captured = moveCaptured(m);
        const promo = movePromotion(m);
        if (captured || promo) {
          s =
            (1 << 28) +
            (captured ? VALUE[captured & 7] * 16 - ATTACKER_ORDER[movePiece(m) & 7] : 0) +
            (promo === QUEEN ? 9000 : promo ? -1000 : 0);
        } else if (m === k0) s = (1 << 27) + 1;
        else if (m === k1) s = 1 << 27;
        else s = this.history[movePiece(m) * 125 + moveTo(m)];
      }
      this.order[i] = s;
    }
  }

  /** Swaps the best-ordered move left in [i, end) into place i and returns it. */
  private pickNext(i: number, end: number): number {
    const order = this.order;
    const moves = this.moves;
    let bi = i;
    let bs = order[i];
    for (let j = i + 1; j < end; j++) {
      if (order[j] > bs) {
        bs = order[j];
        bi = j;
      }
    }
    if (bi !== i) {
      const m = moves[i];
      moves[i] = moves[bi];
      moves[bi] = m;
      order[bi] = order[i];
      order[i] = bs;
    }
    return moves[i];
  }
}

// Mate scores are stored relative to the node, so a mate found through
// another path keeps its distance right
const toTT = (s: number, ply: number) =>
  s >= MATE_BOUND ? s + ply : s <= -MATE_BOUND ? s - ply : s;
const fromTT = (s: number, ply: number) =>
  s >= MATE_BOUND ? s - ply : s <= -MATE_BOUND ? s + ply : s;
