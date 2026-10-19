// Players beside the game's own (LEVELS): the levels as they were, kept as
// references, and the candidates the new ones were tuned from (README, "The
// levels as people play"), each a level to start from and what it changes. A
// match names them as it names the game's (match.ts); `{...}` after a name
// overrides more of it, as JSON. results.txt's rounds 2 to 5 name these; its
// round 1 (`_r1`) came before the levels chose as freely as the position is
// tense, and its last rounds name the final levels with what they changed.
import { LEVELS } from '../../client/src/ai/levels';
import type { Level, Player } from '../../client/src/ai/levels';

export const CANDIDATES: Record<string, { base: Player; level: Partial<Level> }> = {
  // The levels as they were (results.txt's first matches): the hand-set
  // numbers, and a flat chance of overlooking a move across levels
  easy0: {
    base: 'easy',
    level: {
      knows: 'handset',
      maxDepth: 2,
      timeMs: 400,
      quiescence: 2,
      margin: 260,
      temperature: 70,
      noise: 45,
      blindness: 0.5,
      sight: undefined,
      style: 0,
    },
  },
  // Hard as it was: the engine on the clock (levels.ts, ENGINE), `hard0:d1` its
  // search to one ply
  hard0: { base: 'hardFixed', level: { nodes: undefined } },
  medium0: {
    base: 'medium',
    level: {
      knows: 'handset',
      maxDepth: 3,
      timeMs: 800,
      nodes: undefined,
      quiescence: 8,
      margin: 90,
      temperature: 22,
      noise: 18,
      blindness: 0.18,
      sight: undefined,
      style: 0,
    },
  },
  // Medium as its owner tied with it, the player the scale is standardised on
  // (1500): three plies, on the clock (0.8 s), choosing at temperature 19
  medium1500: {
    base: 'medium',
    level: {
      maxDepth: 3,
      timeMs: 800,
      nodes: undefined,
      temperature: 19,
      noise: 11,
    },
  },
  // A beginner: the beginner's numbers, its move and the reply, short captures
  easyB: {
    base: 'easy',
    level: {
      knows: 'beginner',
      maxDepth: 2,
      quiescence: 4,
      margin: 60,
      temperature: 20,
      noise: 10,
      blindness: 0,
      sight: { ease: 0.1, miss: 0.9 },
      style: 0.3,
    },
  },
  // An advanced player: the advanced numbers, three plies
  medA: {
    base: 'medium',
    level: {
      knows: 'advanced',
      maxDepth: 3,
      timeMs: 800,
      nodes: undefined,
      quiescence: 8,
      margin: 40,
      temperature: 14,
      noise: 6,
      blindness: 0,
      sight: { ease: 0.25, miss: 0.7 },
      style: 0.25,
    },
  },
  // An expert: the expert's numbers on a small budget of positions
  hardE: {
    base: 'hard',
    level: {
      knows: 'expert',
      nodes: 15_000,
      quiescence: 16,
      margin: 40,
      temperature: 14,
      noise: 0,
      blindness: 0,
      sight: { ease: 0.45, miss: 0.5 },
      style: 0.2,
    },
  },
};

/**
 * A player named as match.ts names one: a level or a candidate, optionally
 * `@nodes` (a budget of positions) or `:dN` (a depth, whatever the time), then
 * `{...}`, more of its level as JSON.
 */
export const parsePlayer = (spec: string) => {
  const brace = spec.indexOf('{');
  const extra = brace >= 0 ? JSON.parse(spec.slice(brace)) : {};
  const [name, budget] = (brace >= 0 ? spec.slice(0, brace) : spec).split(/[@:]/);
  const candidate = CANDIDATES[name];
  if (!candidate && !(name in LEVELS)) throw new Error(`no player ${name}`);
  const level = !budget
    ? {}
    : budget.startsWith('d')
      ? { maxDepth: Number(budget.slice(1)), timeMs: 1e9, nodes: undefined }
      : { nodes: Number(budget) };
  return {
    name: (candidate?.base ?? name) as Player,
    level: { ...candidate?.level, ...level, ...extra },
  };
};
