// The computer's move: a search at its level (levels.ts), then a choice
// among the moves its player would consider, the way a person chooses: not
// always the very best, now and then a misjudgement, and never the same
// game twice. Everything random comes from `seed`, so a choice can be
// repeated exactly (the tests do).

import { LEVELS, OPENING_PLIES } from './levels';
import type { Difficulty, Level, MoveFeel } from './levels';
import {
  CX,
  CY,
  CZ,
  KNIGHT,
  PAWN,
  KING,
  Position,
  moveCaptured,
  moveFrom,
  movePiece,
  moveTo,
} from './position';
import type { WireMove } from './position';
import { MATE_BOUND, Searcher } from './search';
import type { RootScore } from './search';

export interface ComputerMove extends MoveFeel {
  move: WireMove;
  /** What the search made of the position, in centipawns for the computer. */
  score: number;
  /** How deep the search went, and how many positions it looked at. */
  depth: number;
  nodes: number;
}

export interface ChooseOptions {
  /** Overrides for the level (tests, the strength script). */
  level?: Partial<Level>;
  /** The search's clock. */
  now?: () => number;
  /** Stop the search after this many positions instead of by the clock. */
  maxNodes?: number;
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

/** A standard normal from two uniforms (Box-Muller). */
const gaussian = (u: number, v: number) =>
  Math.sqrt(-2 * Math.log(1 - u)) * Math.cos(2 * Math.PI * v);

/**
 * The computer's move after `records` (the game so far, as on the wire) at
 * `difficulty`; null if it has no legal move.
 */
export function chooseMove(
  records: readonly WireMove[],
  difficulty: Difficulty,
  seed: number,
  options: ChooseOptions = {},
): ComputerMove | null {
  const pos = Position.fromRecords(records);
  const ply = records.length;
  const opening = ply < OPENING_PLIES;
  const level: Level = { ...LEVELS[difficulty], ...options.level };
  // Freer in the opening, so no two games begin alike
  const margin = opening ? Math.max(level.margin, 40) : level.margin;
  const temperature = opening ? Math.max(level.temperature, 14) : level.temperature;
  const random = seeded(seed);
  const turnSeed = Math.floor(random() * 2 ** 31);
  const blindness = level.blindness;
  const hidden =
    blindness > 0 ? (m: number) => hardToSee(m) && hash01(m, turnSeed) < blindness : undefined;

  const result = new Searcher(pos).search({
    maxDepth: level.maxDepth,
    timeMs: level.timeMs,
    maxNodes: options.maxNodes,
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
      if (level.noise > 0)
        s += level.noise * gaussian(hash01(move, turnSeed ^ 0x5bd1e995), random());
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
export const ASSESS_MS = 400;

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
  const { maxDepth, quiescence } = LEVELS.hard;
  return new Searcher(Position.fromRecords(records)).search({
    maxDepth,
    timeMs: ASSESS_MS,
    maxNodes: options.maxNodes,
    margin: 0,
    quiescence,
    now: options.now,
  }).score;
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
