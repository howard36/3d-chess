// The computer's three levels, and how long it takes over a move. Kept apart
// from the search (choose.ts) so the page can read them without loading it:
// the search runs in a worker of its own.

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

export type Difficulty = (typeof DIFFICULTIES)[number];

export const DIFFICULTY_NAME: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

export const isDifficulty = (value: unknown): value is Difficulty =>
  DIFFICULTIES.includes(value as Difficulty);

/** The levels, and the players the game does not offer (LEVELS). */
export type Player = Difficulty | 'hardFixed' | 'expert';

export interface Level {
  /** The deepest it looks, in plies, and for how long (milliseconds). */
  maxDepth: number;
  timeMs: number;
  /** How long a line of captures it follows to the end, in plies. */
  quiescence: number;
  /**
   * Moves within this many centipawns of the best are the ones it considers.
   * With `sight`, this, `temperature` and `noise` are for a position of
   * middling tension (choose.ts, tension): less in a quiet one, where it plays
   * the best move, more in a fight.
   */
  margin: number;
  /** How readily it plays the second-best of those over the best (centipawns; 0 never). */
  temperature: number;
  /** How far off its judgement of each move may be (centipawns, one standard deviation). */
  noise: number;
  /**
   * Instead of `sight`, a flat chance of overlooking a move that is hard to
   * see on this board: a long move across levels, a unicorn's, a knight's jump
   * to another level, for the whole of that turn's thinking, whoever would
   * play it (the levels before they saw by `sight`, which research/levels/
   * still plays as references).
   */
  blindness?: number;
  /**
   * A budget of positions instead of time: the search stops where it would at
   * `timeMs` on a machine searching this many in that time, so the level plays
   * the same on any device (and takes longer on a slower one).
   */
  nodes?: number;
  /** What it knows of the game: the numbers it judges a position by (the hand-set by default). */
  knows?: Knowledge;
  /**
   * How well it sees (instead of `blindness`): a move harder to see than
   * `ease` (hardness, choose.ts: 0 a short move on one level, about 1 a long
   * quiet sacrifice across levels) is overlooked more often the harder it is,
   * up to `miss` of the time at hardness 1, and more in a tense position than
   * a quiet one. What it overlooks is a piece's harder moves, for a few moves
   * running, until that piece moves.
   */
  sight?: { ease: number; miss: number };
  /**
   * Its style, drawn afresh each game: how far each of its positional
   * judgements (the middle of the cube, development, pawns going forward, the
   * king's safety, pressure on the enemy king) may be weighted up or down, a
   * fraction (0.3: by up to 30%), and a liking for one kind of piece.
   */
  style?: number;
  /** Knows king and pawn against king exactly, as an expert does (kpk.ts). */
  endgames?: boolean;
}

/**
 * What a player knows: which numbers it judges by (numbers.ts), a beginner's,
 * an advanced player's, the expert's, or the hand-set ones.
 */
export type Knowledge = 'handset' | 'beginner' | 'advanced' | 'expert';

/**
 * The engine at full stretch: up to 1.8 s as deep as that goes, every line of
 * captures to its end, the best move or one as good. The players the game
 * does not offer play it, and it weighs up a draw offered to the computer.
 */
export const ENGINE: Level = {
  maxDepth: 40,
  timeMs: 1800,
  quiescence: 64,
  margin: 16,
  temperature: 6,
  noise: 0,
  blindness: 0,
};

/**
 * The engine's positions a second, as measured in a Chromium worker: the
 * budget of positions that plays its moves in its time there.
 */
const ENGINE_RATE = 1_000_000;

/**
 * The levels play as people do at three stages: Easy as a beginner, Medium
 * as an advanced player, Hard as an expert, each knowing as much of the game
 * (`knows`), looking as far ahead and seeing as much of what is hard to see
 * on five levels (`sight`) as one would, and choosing more loosely in a
 * fight than in a quiet position; each game in a style of its own. Their
 * strengths, measured by self-play (research/levels/), with Medium at 1500:
 * Easy about 620 Elo below it, Hard about 550 above. Each plays to a depth or
 * on a budget of positions, so the same on any device (but for Medium's
 * longest searches, about one move in 200 on a fast machine, which its time
 * cuts short on a slow one). Besides them, two players the game
 * does not offer: the engine at full stretch (`hardFixed`, the old Hard on a
 * budget of positions) and the expert, the strongest it plays.
 */
export const LEVELS: Record<Player, Level> = {
  easy: {
    knows: 'beginner',
    maxDepth: 1,
    timeMs: 400,
    quiescence: 4,
    margin: 60,
    temperature: 30,
    noise: 10,
    sight: { ease: 0, miss: 1 },
    style: 0.3,
  },
  medium: {
    knows: 'advanced',
    maxDepth: 3,
    timeMs: 800,
    quiescence: 8,
    margin: 53,
    temperature: 19,
    noise: 11,
    sight: { ease: 0.05, miss: 1 },
    style: 0.25,
  },
  // The expert's judgement on a small budget of positions: it wins by knowing
  // more, not by looking further, and overlooks only the hardest moves
  hard: {
    knows: 'expert',
    maxDepth: 40,
    timeMs: 1800,
    nodes: 30_000,
    quiescence: 16,
    margin: 40,
    temperature: 28,
    noise: 0,
    sight: { ease: 0.45, miss: 0.5 },
    style: 0.2,
    endgames: true,
  },
  // The engine on a budget of positions: its moves at a million positions a
  // second, the same strength on any device
  hardFixed: { ...ENGINE, nodes: (ENGINE.timeMs / 1000) * ENGINE_RATE },
  // The strongest it plays: the engine's search and choice, on the same
  // budget, by the expert's numbers
  expert: { ...ENGINE, nodes: (ENGINE.timeMs / 1000) * ENGINE_RATE, knows: 'expert' },
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
  /**
   * How tense the position was (choose.ts, tension): 0.4 with nothing to take
   * and nothing attacked, up to 1.4 in a fight.
   */
  tension: number;
}

/** The longest the computer takes over a move, however much there is to weigh (milliseconds). */
export const MAX_THINK_MS = 3000;

/**
 * How long the computer takes over a move, start to finish (milliseconds),
 * from `random` in [0, 1): a forced move at once, an obvious one quickly,
 * the opening's moves briskly, and the rest after a moment's thought, longer
 * the stronger the level and the more there is to weigh (half the level's
 * time in a quiet position, half as much again in a fight), never more than
 * MAX_THINK_MS. Only how long the move takes to appear: the move is the same.
 */
export function thinkTime(difficulty: Difficulty, feel: MoveFeel, random: number): number {
  if (feel.forced) return 450 + 200 * random;
  if (feel.obvious) return 550 + 400 * random;
  const base = { easy: 1000, medium: 1400, hard: 1700 }[difficulty];
  const opening = feel.ply < OPENING_PLIES ? 0.55 : 1;
  const weigh = 0.5 + (feel.tension - 0.4);
  return Math.round(Math.min(MAX_THINK_MS, base * opening * weigh * (0.8 + 0.4 * random)));
}
