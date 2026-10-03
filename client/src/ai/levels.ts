// The computer's three levels, and how long it takes over a move. Kept apart
// from the search (choose.ts) so the page can read them without loading it:
// the search runs in a worker of its own.

export type Difficulty = 'easy' | 'medium' | 'hard';

export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];

export const DIFFICULTY_NAME: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

export const isDifficulty = (value: unknown): value is Difficulty =>
  value === 'easy' || value === 'medium' || value === 'hard';

export interface Level {
  /** The deepest it looks, in plies, and for how long (milliseconds). */
  maxDepth: number;
  timeMs: number;
  /** How long a line of captures it follows to the end, in plies. */
  quiescence: number;
  /** Moves within this many centipawns of the best are the ones it considers. */
  margin: number;
  /** How readily it plays the second-best of those over the best (centipawns; 0 never). */
  temperature: number;
  /** How far off its judgement of each move may be (centipawns, one standard deviation). */
  noise: number;
  /**
   * The chance it overlooks a move that is hard to see on this board: a long
   * move across levels, a unicorn's, a knight's jump to another level. A move
   * overlooked is overlooked for the whole of that turn's thinking, whoever
   * would play it.
   */
  blindness: number;
}

/**
 * Easy sees its own move and the reply, misjudges freely and misses half of
 * what comes at it from another level: it hangs pieces, and takes them. Medium
 * looks a move further, judges better and misses a little. Hard thinks for
 * up to two seconds as deep as that goes, sees everything, and varies only
 * among moves as good as each other.
 */
export const LEVELS: Record<Difficulty, Level> = {
  easy: {
    maxDepth: 2,
    timeMs: 400,
    quiescence: 2,
    margin: 260,
    temperature: 70,
    noise: 45,
    blindness: 0.5,
  },
  medium: {
    maxDepth: 3,
    timeMs: 800,
    quiescence: 8,
    margin: 90,
    temperature: 22,
    noise: 18,
    blindness: 0.18,
  },
  hard: {
    maxDepth: 40,
    timeMs: 1800,
    quiescence: 64,
    margin: 16,
    temperature: 6,
    noise: 0,
    blindness: 0,
  },
};

/** The first plies of a game, played a little more freely (and faster) by every level, for variety. */
export const OPENING_PLIES = 8;

/** What the search said about the move it chose: how long a player would think over it. */
export interface MoveFeel {
  /** The only legal move. */
  forced: boolean;
  /** It stands out: a recapture, or far better than anything else. */
  obvious: boolean;
  /** Plies played before it. */
  ply: number;
}

/**
 * How long the computer takes over a move, start to finish (milliseconds),
 * from `random` in [0, 1): a forced move at once, an obvious one quickly,
 * the opening's moves briskly, and the rest after a moment's thought,
 * longer the stronger the level.
 */
export function thinkTime(difficulty: Difficulty, feel: MoveFeel, random: number): number {
  if (feel.forced) return 450 + 200 * random;
  if (feel.obvious) return 550 + 400 * random;
  const base = { easy: 1000, medium: 1400, hard: 1700 }[difficulty];
  const opening = feel.ply < OPENING_PLIES ? 0.55 : 1;
  return Math.round(base * opening * (0.65 + 0.7 * random));
}
