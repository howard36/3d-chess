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
 * A position the game ended in, which needs no search: the side to move
 * mated (`mate` 0) or a draw. A game ended by the players (a resignation, a
 * draw agreed) ended in a position like any other, to be searched (null).
 */
export function endedAnalysis(gameOver: GameOver): PositionAnalysis | null {
  switch (gameOver.result) {
    case 'checkmate':
      return { best: null, score: 0, mate: 0 };
    case 'stalemate':
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
 * Every move's grade, as far as the positions analysed reach: `analyses[n]`
 * is the position after `n` moves (missing while it is still to come), and
 * the grade of move `n` (1 on) is at index `n - 1`, undefined until both its
 * positions are in.
 */
export function gradeMoves(
  records: readonly Pick<MoveRecord, 'from' | 'to' | 'promotion'>[],
  analyses: readonly (PositionAnalysis | undefined)[],
): (Grade | null | undefined)[] {
  return records.map((played, i) => {
    const before = analyses[i];
    const after = analyses[i + 1];
    return before && after ? gradeMove(before, played, after) : undefined;
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
 * marked: the best move in the position before it. Null for an unmarked
 * move, or the start.
 */
export function betterMove(
  grades: readonly (Grade | null | undefined)[],
  analyses: readonly (PositionAnalysis | undefined)[],
  ply: number,
): PositionAnalysis['best'] {
  const grade = grades[ply - 1];
  if (ply < 1 || !grade || grade === 'brilliant') return null;
  return analyses[ply - 1]?.best ?? null;
}
