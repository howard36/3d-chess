// The computer's move: a search at its level (levels.ts), then a choice
// among the moves its player would consider, the way a person chooses: not
// always the very best, now and then a misjudgement, and never the same
// game twice. Everything random comes from `seed`, so a choice can be
// repeated exactly (the tests do).

import { ENGINE, LEVELS, OPENING_PLIES } from './levels';
import type { Knowledge, Level, MoveFeel, Player } from './levels';
import { NUMBERS } from './numbers';
import type { EvalNumbers } from './numbers';
import {
  BLACK,
  CELLS,
  CX,
  CY,
  CZ,
  DIST,
  KNIGHT,
  PAWN,
  KING,
  Position,
  UNICORN,
  WEIGHTS,
  moveCaptured,
  moveFrom,
  movePiece,
  moveTo,
  weigh,
} from './position';
import type { Weights } from './position';
import type { WireMove } from './position';
import { MATE, MATE_BOUND, Searcher } from './search';
import type { RootScore } from './search';

export interface ComputerMove extends MoveFeel {
  move: WireMove;
  /** What the search made of the position, in centipawns for the computer. */
  score: number;
  /** How deep the search went, and how many positions it looked at. */
  depth: number;
  nodes: number;
}

interface ChooseOptions {
  /** Overrides for the level (tests, the strength script). */
  level?: Partial<Level>;
  /** The search's clock. */
  now?: () => number;
  /** Stop the search after this many positions instead of by the clock. */
  maxNodes?: number;
  /**
   * The game's own seed, the same for every move of it: its style, and what
   * it overlooks staying overlooked from one move to the next. Without it each
   * move draws its own.
   */
  game?: number;
}

/** A small seeded generator (mulberry32): uniform in [0, 1). */
export const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** A number in [0, 1) fixed by a move and the turn's seed: the same move, the same answer. */
const hash01 = (move: number, seed: number) => {
  let h = Math.imul(move ^ seed, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca77);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
};

/**
 * A move that is easy to miss on a board of five levels: a knight's jump to
 * another level, or a long move (two squares or more) that changes level.
 */
export function hardToSee(move: number): boolean {
  const type = movePiece(move) & 7;
  if (type === PAWN || type === KING) return false;
  const from = moveFrom(move);
  const to = moveTo(move);
  if (CZ[from] === CZ[to]) return false;
  if (type === KNIGHT) return true;
  const dist = Math.max(
    Math.abs(CX[from] - CX[to]),
    Math.abs(CY[from] - CY[to]),
    Math.abs(CZ[from] - CZ[to]),
  );
  return dist >= 2;
}

/**
 * How hard a move is to see, from the board as it stands after it and the
 * move before it: 0 for what anyone sees (a pawn's or the king's move, a
 * short move on one level, taking the piece that just moved), more for a move
 * that changes level, the longer the more, a knight's jump to another level,
 * a unicorn's, a move back towards its own side, far from where the last move
 * was, or onto a square the enemy attacks for less than it risks (a
 * sacrifice); a capture or a check is seen more readily. A move that could
 * not be harder than `floor` comes back as 0 without looking at the board.
 */
export function hardness(pos: Position, move: number, prev: number, floor = -1): number {
  const shape = lookOf(move, prev);
  if (shape <= 0) return 0;
  const seen = moveCaptured(move) ? 0.6 : 1;
  // Past here only the board can make it harder: a sacrifice. Not worth the
  // look if even that would leave it at or under `floor`
  if ((shape + SACRIFICE) * seen <= floor) return 0;
  let h = (shape + (sacrifice(pos, move) ? SACRIFICE : 0)) * seen;
  if (h > floor && pos.inCheck()) h *= 0.7;
  return h;
}

/** What a sacrifice adds to how hard a move is to see. */
const SACRIFICE = 0.25;

/** How hard a move is to see by its shape alone: its piece, how it moves, and where. */
function lookOf(move: number, prev: number): number {
  const piece = movePiece(move);
  const type = piece & 7;
  if (type === PAWN || type === KING) return 0;
  const from = moveFrom(move);
  const to = moveTo(move);
  if (prev !== 0 && to === moveTo(prev)) return 0;
  const levels = Math.abs(CZ[to] - CZ[from]);
  const dist = DIST[from * CELLS + to];
  let h: number;
  if (levels === 0) h = dist <= 1 ? 0 : dist === 2 ? 0.05 : 0.1;
  else if (type === KNIGHT) h = 0.5;
  else h = 0.2 + 0.1 * dist + (levels >= 2 ? 0.1 : 0);
  if (type === UNICORN) h += 0.1;
  const ahead = (c: number) => (piece & BLACK ? -1 : 1) * (CY[c] + CZ[c]);
  if (ahead(to) < ahead(from)) h += 0.15;
  if (prev !== 0 && DIST[moveTo(prev) * CELLS + to] >= 3) h += 0.1;
  return h;
}

/**
 * Whether a move (made: the board as it stands after it) puts a piece where
 * the enemy attacks it, for less than the piece is worth: a sacrifice, at a
 * first look.
 */
export function sacrifice(pos: Position, move: number): boolean {
  const piece = movePiece(move);
  const type = piece & 7;
  if (type === KING) return false;
  const value = pos.w.value;
  return (
    value[type] > value[moveCaptured(move) & 7] + 50 &&
    pos.attacked(moveTo(move), piece & BLACK ? 0 : 1)
  );
}

/**
 * How tense a position is, from 0.4 (nothing to take, nothing attacked) up to
 * 1.4: the captures the side to move has, and its pieces the enemy attacks.
 * What a player overlooks grows with it.
 */
export function tension(pos: Position): number {
  const moves = new Int32Array(512);
  const captures = pos.generate(moves, 0, true);
  const side = pos.side;
  let attacked = 0;
  for (let c = 0; c < CELLS; c++) {
    const q = pos.board[c];
    if (q === 0 || (q & 7) === PAWN || (q & 7) === KING || (q & BLACK ? 1 : 0) !== side) continue;
    if (pos.attacked(c, side ^ 1)) attacked++;
  }
  return Math.min(1.4, 0.4 + 0.1 * (captures + attacked));
}

/** Plies a blind spot lasts (unless its piece moves). */
const BLIND_PLIES = 8;

/**
 * A level's numbers in a style of its own (`amount`, Level.style), the same
 * all game (`seed`): each positional judgement weighted up or down by up to
 * `amount`, and one kind of piece liked a little more.
 */
export function stylise(n: EvalNumbers, amount: number, seed: number): EvalNumbers {
  const random = seeded(seed ^ 0x2545f491);
  const k = () => 1 + amount * (2 * random() - 1);
  const centre = k();
  const home = k();
  const pawns = k();
  const king = k();
  const pressure = k();
  const liked = Math.floor(random() * 5);
  const like = 1 + amount / 10;
  const piece = (p: EvalNumbers['knight'], i: number) => ({
    mg: p.mg * (i === liked ? like : 1),
    mgCentre: p.mgCentre * centre,
    home: p.home * home,
    eg: p.eg * (i === liked ? like : 1),
    egCentre: p.egCentre * centre,
  });
  const advance = (t: readonly number[]) =>
    t.map((v, i) => (i === 0 || i === 8 ? v : t[1] + (v - t[1]) * pawns));
  return {
    ...n,
    pawnMg: advance(n.pawnMg),
    pawnEg: advance(n.pawnEg),
    knight: piece(n.knight, 0),
    bishop: piece(n.bishop, 1),
    unicorn: piece(n.unicorn, 2),
    rook: piece(n.rook, 3),
    queen: piece(n.queen, 4),
    king: { ...n.king, out: n.king.out * king, file: n.king.file * king },
    tropism: n.tropism.map((t) => t * pressure) as unknown as EvalNumbers['tropism'],
  };
}

const styled = new Map<string, Weights>();
/** The tables a player judges by: its knowledge, in this game's style. */
function weightsFor(knows: Knowledge, style: number, game: number | undefined): Weights {
  if (!style || game === undefined) return WEIGHTS[knows];
  const key = `${knows} ${style} ${game}`;
  let w = styled.get(key);
  if (!w) {
    if (styled.size >= 8) styled.clear();
    w = weigh(stylise(NUMBERS[knows], style, game));
    styled.set(key, w);
  }
  return w;
}

/** A standard normal from two uniforms (Box-Muller). */
const gaussian = (u: number, v: number) =>
  Math.sqrt(-2 * Math.log(1 - u)) * Math.cos(2 * Math.PI * v);

/**
 * The computer's move after `records` (the game so far, as on the wire) as
 * `player` (a level, or a player the game does not offer); null if it has no
 * legal move.
 */
export function chooseMove(
  records: readonly WireMove[],
  player: Player,
  seed: number,
  options: ChooseOptions = {},
): ComputerMove | null {
  const level: Level = { ...LEVELS[player], ...options.level };
  const pos = Position.fromRecords(
    records,
    weightsFor(level.knows ?? 'handset', level.style ?? 0, options.game),
  );
  const ply = records.length;
  const opening = ply < OPENING_PLIES;
  const sight = level.sight;
  // A player who sees by how hard moves are to see also chooses as freely as
  // the position is tense: the best move in a quiet one, now and then less
  // in a fight, as a person under pressure
  const tense = sight ? tension(pos) : 1;
  // Freer in the opening, so no two games begin alike
  const margin = Math.round(opening ? Math.max(level.margin, 40) : level.margin * tense);
  const temperature = opening ? Math.max(level.temperature, 14) : level.temperature * tense;
  const noise = level.noise * tense;
  const random = seeded(seed);
  const turnSeed = Math.floor(random() * 2 ** 31);
  const blindness = level.blindness ?? 0;
  let hidden: ((m: number, prev: number) => boolean) | undefined =
    blindness > 0 ? (m: number) => hardToSee(m) && hash01(m, turnSeed) < blindness : undefined;
  if (sight) {
    // A piece overlooked stays overlooked for a few moves, while it stands where it is
    const blind =
      (options.game ?? turnSeed) ^ Math.imul(Math.floor(ply / BLIND_PLIES) + 1, 0x9e3779b1);
    hidden = (m, prev) => {
      const h = hardness(pos, m, prev, sight.ease);
      if (h <= sight.ease) return false;
      const p = Math.min(1, (sight.miss * (h - sight.ease)) / (1 - sight.ease)) * tense;
      return hash01((movePiece(m) << 7) | moveFrom(m), blind) < p;
    };
  }

  const result = new Searcher(pos).search({
    maxDepth: level.maxDepth,
    timeMs: level.timeMs,
    maxNodes: options.maxNodes,
    nodes: level.nodes,
    margin,
    quiescence: level.quiescence,
    hidden,
    now: options.now,
  });
  if (!result.move) return null;

  // How the computer sees each move it considers: the search's score, off by
  // its level's noise, and a little less for taking a piece straight back to
  // where it just came from (a person rarely shuffles)
  const lastOwn = ply >= 2 ? records[ply - 2] : null;
  const judged = result.candidates.map(({ move, score }) => {
    let s = score;
    if (Math.abs(score) < MATE_BOUND) {
      if (noise > 0) s += noise * gaussian(hash01(move, turnSeed ^ 0x5bd1e995), random());
      if (lastOwn) {
        const r = Position.record(move);
        if (r.from === lastOwn.to && r.to === lastOwn.from) s -= 25;
      }
    }
    return { move, score: s };
  });
  const pick = pickMove(judged, margin, temperature, random());

  const scores = result.scores;
  const second = scores
    .filter((r) => r.move !== result.move)
    .reduce((a, r) => Math.max(a, r.score), -Infinity);
  const last = ply > 0 ? records[ply - 1] : null;
  const recapture =
    !!last && moveCaptured(pick.move) !== 0 && Position.record(pick.move).to === last.to;
  return {
    move: Position.record(pick.move),
    score:
      pick.move === result.move
        ? result.score
        : (result.candidates.find((c) => c.move === pick.move)?.score ?? result.score),
    depth: result.depth,
    nodes: result.nodes,
    forced: scores.length === 1,
    obvious: recapture || (pick.move === result.move && result.score - second >= 250),
    ply,
  };
}

/** How long the computer weighs up a position (a draw offered to it), at most. */
const ASSESS_MS = 400;

/**
 * What the search makes of the position after `records`, in centipawns for
 * the side to move: a plain look at it, as Hard would see it in a moment,
 * without any level's misjudgements or blind spots (the computer weighing up
 * a draw offered to it).
 */
export function assessPosition(
  records: readonly WireMove[],
  options: Pick<ChooseOptions, 'now' | 'maxNodes'> = {},
): number {
  const { maxDepth, quiescence } = ENGINE;
  return new Searcher(Position.fromRecords(records)).search({
    maxDepth,
    timeMs: ASSESS_MS,
    maxNodes: options.maxNodes,
    margin: 0,
    quiescence,
    now: options.now,
  }).score;
}

/** What a review of the game makes of one of its positions (analysePosition). */
export interface PositionAnalysis {
  /** The best move, as on the wire; null with no legal move. */
  best: WireMove | null;
  /** Centipawns for the side to move (past ±MATE_BOUND a mate: see `mate`). */
  score: number;
  /**
   * A forced mate found: the plies to it, positive when the side to move
   * mates, negative when it is mated.
   */
  mate?: number;
  /** The move that led here: how hard it was to see (hardness), and whether it was a sacrifice. */
  played?: { hardness: number; sacrifice: boolean };
}

/**
 * How many positions a review looks at for each position of the game: the
 * same answer on every machine, in about a third of a second in the browser.
 */
export const ANALYSIS_NODES = 120_000;
/** A review's limit on a position should the machine be slow (milliseconds). */
export const ANALYSIS_MS = 1500;

/**
 * The best move after `records` and what it is worth, for a review of the
 * game: the expert's numbers, as deep as it gets and every line of captures
 * to its end, but bounded by positions searched (ANALYSIS_NODES) rather than
 * time, so it comes out the same everywhere, and looking past a forced move
 * as past any other; and how hard the move that led here was to see.
 */
export function analysePosition(
  records: readonly WireMove[],
  options: Pick<ChooseOptions, 'now' | 'maxNodes'> = {},
): PositionAnalysis {
  const { maxDepth, quiescence } = ENGINE;
  const result = new Searcher(Position.fromRecords(records, WEIGHTS.expert)).search({
    maxDepth,
    timeMs: ANALYSIS_MS,
    maxNodes: options.maxNodes ?? ANALYSIS_NODES,
    margin: 0,
    quiescence,
    deepenForced: true,
    now: options.now,
  });
  const analysis: PositionAnalysis = {
    best: result.move ? Position.record(result.move) : null,
    score: result.score,
  };
  if (result.move && Math.abs(result.score) >= MATE_BOUND) {
    analysis.mate = result.score > 0 ? MATE - result.score : -(MATE + result.score);
  }
  const ply = records.length;
  if (ply > 0) {
    const before = Position.fromRecords(records.slice(0, -1));
    const move = before.findMove(records[ply - 1]);
    const prev =
      ply > 1 ? Position.fromRecords(records.slice(0, -2)).findMove(records[ply - 2]) : 0;
    before.make(move);
    analysis.played = {
      hardness: hardness(before, move, prev),
      sacrifice: sacrifice(before, move),
    };
  }
  return analysis;
}

/**
 * Picks among the moves judged within `margin` of the best, each weighted by
 * how far it falls short (a softmax at `temperature`), from `u` in [0, 1).
 * A mate is always taken, and a move into a mate never chosen while there is
 * another.
 */
export function pickMove(
  judged: RootScore[],
  margin: number,
  temperature: number,
  u: number,
): RootScore {
  const best = judged.reduce((a, b) => (b.score > a.score ? b : a));
  if (best.score >= MATE_BOUND || temperature <= 0) return best;
  const pool = judged.filter((j) => j.score >= best.score - margin && j.score > -MATE_BOUND);
  if (pool.length <= 1) return best;
  const weights = pool.map((j) => Math.exp((j.score - best.score) / temperature));
  const total = weights.reduce((a, b) => a + b, 0);
  let x = u * total;
  for (let i = 0; i < pool.length; i++) {
    x -= weights[i];
    if (x < 0) return pool[i];
  }
  return pool[pool.length - 1];
}
