// The computer player's search (client/src/ai), timed on fixed work: each
// case searches a position to a fixed number of positions (nodes) rather
// than for a fixed time, so a faster search shows as less time for the same
// nodes. The app searches by the clock (400, 800 and 1,800 ms by level,
// ai/levels.ts), so here speed is strength: every node the search saves is
// one more it looks at in the same wait.

import { bench, describe } from 'vitest';
import { chooseMove } from '../src/ai/choose';
import type { ComputerMove } from '../src/ai/choose';
import type { MoveRecord } from '../src/types/messages';
import { QUICK, inRounds, sharedGames } from './fixtures';
import { duration, emit } from './report';

export let sink: unknown;

const NODES = QUICK ? 2_000 : 20_000;
const SEED = 1;

/**
 * What each search must come out as: within its nodes, the depth it completed
 * and the move it chose, and the nodes it takes to complete that depth (a
 * search to that depth alone). A faster search keeps all three; one made
 * cheaper per node by searching worse (ordering moves worse, pruning less)
 * needs more nodes for the same depth, and the timed row would read it as a
 * win. A change to how it searches updates these on purpose, and is judged
 * by self-play for strength (CLAUDE.md), not by this row.
 */
const EXPECTED_SEARCH: Record<string, { depth: number; move: string; nodes: number }> = QUICK
  ? {
      opening: { depth: 1, move: 'Ab1-Bb3', nodes: 2817 },
      middlegame: { depth: 1, move: 'Ae2-Cd2', nodes: 172 },
      'late middlegame': { depth: 1, move: 'Ab2-Bb2', nodes: 1601 },
    }
  : {
      opening: { depth: 1, move: 'Ab1-Bb3', nodes: 2817 },
      middlegame: { depth: 3, move: 'Ca1-Ca5', nodes: 12099 },
      'late middlegame': { depth: 3, move: 'Ab2-Bb2', nodes: 9062 },
    };

const { decisive } = sharedGames();
const cases: { name: string; about: string; records: MoveRecord[] }[] = [
  { name: 'opening', about: 'The starting position: 61 legal moves.', records: [] },
  {
    name: 'middlegame',
    about: 'Ply 40 of the decisive game (bench/fixtures.ts).',
    records: decisive.records.slice(0, 40),
  },
  {
    name: 'late middlegame',
    about: 'Ply 80 of the decisive game, after many captures.',
    records: decisive.records.slice(0, 80),
  },
];

/** The hard level's search, stopped after NODES positions instead of by the clock. */
const think = (records: MoveRecord[]): ComputerMove | null =>
  chooseMove(records, 'hard', SEED, { maxNodes: NODES, level: { timeMs: 1e9 } });

// One search of each up front: what it reached, for the workload table, and
// a warm JIT for the timings
const reached = cases.map((c) => {
  const t0 = performance.now();
  const r = think(c.records);
  const ms = performance.now() - t0;
  if (!r) throw new Error(`the ${c.name} position has no legal move`);
  const want = EXPECTED_SEARCH[c.name];
  const move = `${r.move.from}-${r.move.to}${r.move.promotion ?? ''}`;
  const toDepth = chooseMove(c.records, 'hard', SEED, {
    level: { timeMs: 1e9, maxDepth: r.depth },
  });
  const got = { depth: r.depth, move, nodes: toDepth?.nodes };
  if (!want || got.depth !== want.depth || got.move !== want.move || got.nodes !== want.nodes) {
    throw new Error(
      `Benchmark check failed: the ${c.name} search came out as ${JSON.stringify(got)}, expected ` +
        `${JSON.stringify(want)}. The search now does different work, so its time is not ` +
        'comparable. If that is meant (a change to how it searches), judge its strength by ' +
        'self-play and update EXPECTED_SEARCH in client/bench/ai.bench.ts.',
    );
  }
  return { ...c, nodes: r.nodes, depth: r.depth, ms };
});

const GROUP = 'A1 · The computer thinks (hard level, fixed nodes)';

emit('ai', {
  intros: {
    [GROUP]:
      `\`chooseMove\` at the hard level, stopped after ${NODES.toLocaleString('en-US')} positions ` +
      'instead of by the clock, in the positions below: the same search work every run, so the ' +
      'time is the search’s speed. In the app the search has a fixed time (by level) in a worker, ' +
      'so a faster search looks deeper in the same wait; the browser tier times the wait itself.',
  },
  workloads: {
    [GROUP]: {
      title: 'Positions',
      intro: 'Depth is the deepest iteration the search completed within its nodes.',
      columns: ['Case', 'Position', 'Nodes', 'Depth', 'First search (cold)'],
      align: ['l', 'l', 'r', 'r', 'r'],
      rows: reached.map((r) => [
        r.name,
        r.about,
        r.nodes.toLocaleString('en-US'),
        String(r.depth),
        duration(r.ms),
      ]),
    },
  },
});

inRounds(({ heavy }) => {
  describe(GROUP, () => {
    for (const c of reached) {
      bench(
        c.name,
        () => {
          sink = think(c.records);
        },
        heavy,
      );
    }
  });
});
