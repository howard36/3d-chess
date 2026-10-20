// A finished game's review: each move judged by what the engine makes of the
// position before it and after it (ai/choose.ts, analysePosition), the way
// lichess judges one. What a move cost its player is counted in winning
// chances, not centipawns, so a pawn thrown away while a queen ahead counts
// for little and one thrown away in a level game for a lot.

import type { PositionAnalysis } from '../ai/computer';
import type { MoveRecord } from '../types/messages';
import type { GameOver, Turn } from './history';

export type { PositionAnalysis };

/** How bad a move was, from the least to the worst. */
export type Fault = 'inaccuracy' | 'mistake' | 'blunder';
/** A move's mark: brilliant, or one of the faults. */
export type Grade = 'brilliant' | Fault;

export const FAULTS: readonly Fault[] = ['inaccuracy', 'mistake', 'blunder'];
export const GRADES: readonly Grade[] = ['brilliant', ...FAULTS];

/** How each grade is written after its move, as in chess. */
export const GRADE_GLYPH: Record<Grade, string> = {
  brilliant: '!!',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
};

/**
 * The winning chances a move may give away before it is marked, on a scale
 * of -1 (lost) to 1 (won): lichess's thresholds, which also fit this engine's
 * games (measured by self-play, see ARCHITECTURE.md "Playing the computer").
 */
export const GRADE_LOSS: Record<Fault, number> = {
  inaccuracy: 0.1,
  mistake: 0.2,
  blunder: 0.3,
};

/** How fast winning chances grow with the score: lichess's, fitted to its players' games. */
const CHANCE_SLOPE = 0.00368208;

/**
 * The side to move's winning chances, -1 (lost) to 1 (won), from what the
 * engine makes of the position: a mate either way is all or nothing.
 */
export function winningChances(e: PositionAnalysis): number {
  if (e.mate !== undefined) return e.mate > 0 ? 1 : -1;
  return 2 / (1 + Math.exp(-CHANCE_SLOPE * e.score)) - 1;
}

/**
 * What the engine makes of a position from White's side, as the review shows
 * it: centipawns, or a forced mate, and White's winning chances (-1 to 1).
 */
export interface Evaluation {
  score: number;
  /** Plies to a forced mate: positive when White mates; 0 in the mate itself. */
  mate?: number;
  chances: number;
}

/** The position after `ply` moves, as the engine makes it (for the side to move), from White's side. */
export function whiteEvaluation(e: PositionAnalysis, ply: number): Evaluation {
  const sign = ply % 2 === 0 ? 1 : -1;
  const chances = sign * winningChances(e);
  // `|| 0`: a mate given (0) stays 0, never -0
  return e.mate === undefined
    ? { score: sign * e.score, chances }
    : { score: 0, mate: sign * e.mate || 0, chances };
}

const MINUS = '−';

/**
 * An evaluation as chess sites write it, from White's side: pawns to one
 * decimal (+1.4, −2.9, 0.0), a forced mate in the mating side's moves, the
 * mating move included (M3, −M3: chess.com's way; # is the record's mark for
 * the mate itself), and the mate
 * itself as the result (1–0, 0–1).
 */
export function evaluationText({ score, mate, chances }: Evaluation): string {
  if (mate !== undefined) {
    if (mate === 0) return chances > 0 ? '1–0' : '0–1';
    // `mate` counts plies; the mating side moves on every other one, the last
    // its mate: 1 or 2 plies away is mate in 1, 3 or 4 mate in 2
    return `${mate < 0 ? MINUS : ''}M${Math.ceil(Math.abs(mate) / 2)}`;
  }
  const pawns = Math.round(score / 10) / 10;
  if (pawns === 0) return '0.0';
  return `${pawns > 0 ? '+' : MINUS}${Math.abs(pawns).toFixed(1)}`;
}

/** An evaluation in words, for a screen reader: "Black ahead by 2.9", "White mates in 3". */
export function evaluationWords(e: Evaluation): string {
  const side = (white: boolean) => (white ? 'White' : 'Black');
  if (e.mate !== undefined) {
    if (e.mate === 0) return `${side(e.chances > 0)} won`;
    return `${side(e.mate > 0)} mates in ${Math.ceil(Math.abs(e.mate) / 2)}`;
  }
  const text = evaluationText(e);
  return text === '0.0' ? 'Even' : `${side(e.score > 0)} ahead by ${text.slice(1)}`;
}

/**
 * A position the game ended in, which needs no search: the side to move
 * mated (`mate` 0) or a draw. A game ended by the players (a resignation, a
 * draw agreed) ended in a position like any other, to be searched (null).
 */
export function endedAnalysis(gameOver: GameOver): PositionAnalysis | null {
  switch (gameOver.result) {
    case 'checkmate':
      return { best: null, score: 0, mate: 0 };
    case 'stalemate':
    case 'insufficient-material':
    case 'repetition':
    case 'fifty-moves':
      return { best: null, score: 0 };
    default:
      return null;
  }
}

const sameMove = (a: Pick<MoveRecord, 'from' | 'to' | 'promotion'>, b: typeof a) =>
  a.from === b.from && a.to === b.to && (a.promotion ?? null) === (b.promotion ?? null);

/**
 * A forced mate walked into or let go, graded by how far ahead the player
 * stands without it (centipawns), as lichess grades one.
 */
const mateGrade = (score: number): Grade =>
  score > 999 ? 'inaccuracy' : score > 700 ? 'mistake' : 'blunder';

/**
 * The grade of `played`, the move between the positions `before` and
 * `after`, or null for a move that gave nothing away. The best move is never
 * marked a fault, but may be brilliant (below). Walking into a forced mate is a blunder, and so is letting one go,
 * unless the player stood (or still stands) so far ahead or behind that it
 * hardly changes the result: then a mistake past seven pawns, an inaccuracy
 * past ten.
 */
export function gradeMove(
  before: PositionAnalysis,
  played: Pick<MoveRecord, 'from' | 'to' | 'promotion'>,
  after: PositionAnalysis,
): Grade | null {
  if (before.best && sameMove(before.best, played))
    return brilliant(before, after, 0) ? 'brilliant' : null;
  // Mates as the mover sees them: before, its own; after, the opponent's
  const hadMate = before.mate !== undefined && before.mate > 0;
  const wasMated = before.mate !== undefined && before.mate < 0;
  const allowsMate = after.mate !== undefined && after.mate > 0;
  const keepsMate = after.mate !== undefined && after.mate <= 0;
  if (allowsMate && !wasMated) return hadMate ? 'blunder' : mateGrade(-before.score);
  if (hadMate && !keepsMate) return mateGrade(-after.score);
  // Once mated or mating, a longer way there is no mark
  if ((wasMated && allowsMate) || (hadMate && keepsMate)) return null;
  const loss = winningChances(before) + winningChances(after);
  for (let i = FAULTS.length - 1; i >= 0; i--) {
    if (loss >= GRADE_LOSS[FAULTS[i]]) return FAULTS[i];
  }
  return brilliant(before, after, loss) ? 'brilliant' : null;
}

/**
 * How hard to see a brilliant move is, at least (ai/choose.ts, hardness: a
 * sacrifice across levels, or a long move back, far from the last).
 */
export const BRILLIANT_HARDNESS = 0.7;

/**
 * A brilliant move, as chess sites mark one: a sacrifice, hard to see,
 * that gives nothing away, played by a side not already winning without it
 * and not losing after it.
 */
function brilliant(before: PositionAnalysis, after: PositionAnalysis, loss: number): boolean {
  const move = after.played;
  if (!move?.sacrifice || move.hardness < BRILLIANT_HARDNESS || loss > BRILLIANT_LOSS) return false;
  if (before.mate !== undefined || after.mate !== undefined) return false;
  return winningChances(before) < 0.5 && -winningChances(after) > -0.2;
}

/** The winning chances a brilliant move may give away: next to none. */
const BRILLIANT_LOSS = 0.02;

/**
 * Plies a recheck searches past the mate seen on the move's other side: one
 * for the position before the move, a ply farther from the mate, and one for
 * the search's own pruning.
 */
const RECHECK_PAST = 2;

/** Which of a move's two positions to search again, and how many plies deep. */
export interface Recheck {
  side: 'before' | 'after';
  depth: number;
}

/**
 * A move whose two positions disagree on a forced mate, seen on one side of
 * it only: the other side searched again, deep enough to see the mate too if
 * it is there (ai/choose.ts, recheckPosition). A mate lies a ply nearer the
 * position after a move than the one before it, so the search can find it
 * after and not before (a move judged to walk into a mate when every move
 * did), or, after the mover played a slower mate than the best, before and
 * not after (judged to let the mate go). Null where they agree, or where the
 * position after needs no search (the game ended in it).
 */
export function recheckOf(before: PositionAnalysis, after: PositionAnalysis): Recheck | null {
  // The opponent mates after the move, and the mover was mated or not before
  if (before.mate === undefined && after.mate !== undefined && after.mate > 0) {
    return { side: 'before', depth: after.mate + RECHECK_PAST };
  }
  // The mover mated before the move, and after it nothing is seen either way
  if (before.mate !== undefined && before.mate > 0 && after.mate === undefined && after.best) {
    return { side: 'after', depth: before.mate + RECHECK_PAST };
  }
  return null;
}

/**
 * The positions move `n` (0 on) is graded between: `analyses[n]` and
 * `analyses[n + 1]`, the one recheckOf names replaced by its recheck,
 * `rechecks[n]`; undefined while any of them is still to come.
 */
function gradedBetween(
  analyses: readonly (PositionAnalysis | undefined)[],
  rechecks: readonly (PositionAnalysis | undefined)[],
  n: number,
): [PositionAnalysis, PositionAnalysis] | undefined {
  const before = analyses[n];
  const after = analyses[n + 1];
  if (!before || !after) return undefined;
  const recheck = recheckOf(before, after);
  if (!recheck) return [before, after];
  const again = rechecks[n];
  if (!again) return undefined;
  return recheck.side === 'before' ? [again, after] : [before, again];
}

/**
 * Every move's grade, as far as the positions analysed reach: `analyses[n]`
 * is the position after `n` moves (missing while it is still to come), and
 * the grade of move `n` (1 on) is at index `n - 1`, undefined until both its
 * positions are in, and its recheck where it needs one (`rechecks[n - 1]`,
 * see recheckOf).
 */
export function gradeMoves(
  records: readonly Pick<MoveRecord, 'from' | 'to' | 'promotion'>[],
  analyses: readonly (PositionAnalysis | undefined)[],
  rechecks: readonly (PositionAnalysis | undefined)[] = [],
): (Grade | null | undefined)[] {
  return records.map((played, i) => {
    const between = gradedBetween(analyses, rechecks, i);
    return between ? gradeMove(between[0], played, between[1]) : undefined;
  });
}

/** How many moves of each grade each side made. */
export type GradeCounts = Record<Turn, Record<Grade, number>>;

/** Counts each side's marks (White's moves are the odd plies, from move 1). */
export function countGrades(grades: readonly (Grade | null | undefined)[]): GradeCounts {
  const counts: GradeCounts = {
    white: { brilliant: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
    black: { brilliant: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
  };
  grades.forEach((g, i) => {
    if (g) counts[i % 2 === 0 ? 'white' : 'black'][g]++;
  });
  return counts;
}

/**
 * The better move where move `ply` was played (1 on), when that move is
 * marked: the best move in the position before it (as rechecked, where it
 * was). Null for an unmarked move, or the start.
 */
export function betterMove(
  grades: readonly (Grade | null | undefined)[],
  analyses: readonly (PositionAnalysis | undefined)[],
  ply: number,
  rechecks: readonly (PositionAnalysis | undefined)[] = [],
): PositionAnalysis['best'] {
  const grade = grades[ply - 1];
  if (ply < 1 || !grade || grade === 'brilliant') return null;
  return gradedBetween(analyses, rechecks, ply - 1)?.[0].best ?? null;
}
