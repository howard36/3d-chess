// One-time startup work, timed by hand: building the Staunton set's
// geometry and baking its ambient occlusion (client/src/three/pieces,
// three/scene/occlusion.ts). The game does each piece type as its own task
// in an idle callback (preloadPieceSet, preloadBakedSet: build the king,
// bake the king, build the queen, ...), so each is a main-thread task the
// player can feel if it lands while they act. A page load pays them once,
// cold, so cold is measured in fresh processes; warm (JIT-compiled) numbers
// come from fresh module instances in this one.
//
//   npx vite-node bench/startup.ts [--quick]
//
// Both caches (the set per quality, the baked set) live in module state, so
// a fresh instance of the module (imported under a unique query) starts
// with empty caches while everything it imports stays shared.

import { spawnSync } from 'node:child_process';
import { PieceType } from '../src/engine';
import { pieceSet } from '../src/three/pieces';
import type { PieceQuality } from '../src/three/pieces';
import { duration, emit, summarize } from './report';
import type { Table } from './report';

type SetModule = typeof import('../src/three/pieces/set');
type OcclusionModule = typeof import('../src/three/scene/occlusion');

const TYPES = Object.values(PieceType);
const QUICK = process.argv.includes('--quick') || process.env.BENCH_QUICK === '1';
let fresh = 0;
const freshSet = (): Promise<SetModule> =>
  import(/* @vite-ignore */ `/src/three/pieces/set.ts?instance=${fresh++}`);
const freshOcclusion = (): Promise<OcclusionModule> =>
  import(/* @vite-ignore */ `/src/three/scene/occlusion.ts?instance=${fresh++}`);

const time = (fn: () => unknown) => {
  const start = performance.now();
  fn();
  return performance.now() - start;
};

/** The app's cold sequence, first call of everything in this process: build, then bake, per type. */
async function coldSequence() {
  const occlusion = await freshOcclusion();
  const set = pieceSet('medium');
  const out: Record<string, { build: number; bake: number }> = {};
  for (const type of TYPES) {
    const build = time(() => set[type]);
    const bake = time(() => occlusion.bakedSet()[type]);
    out[type] = { build, bake };
  }
  return out;
}

if (process.env.BENCH_STARTUP_CHILD === '1') {
  process.stdout.write(`@@${JSON.stringify(await coldSequence())}@@`);
  process.exit(0);
}

// --- Cold: each run in a fresh process --------------------------------------------

const coldRuns = QUICK ? 1 : 3;
const cold: Record<string, { build: number[]; bake: number[] }> = Object.fromEntries(
  TYPES.map((t) => [t, { build: [], bake: [] }]),
);
for (let run = 0; run < coldRuns; run++) {
  // (node on vite-node's entry directly: npx would add a second or so per run)
  const child = spawnSync(
    process.execPath,
    ['node_modules/vite-node/vite-node.mjs', 'bench/startup.ts'],
    {
      env: { ...process.env, BENCH_STARTUP_CHILD: '1' },
      encoding: 'utf8',
      timeout: 120_000,
    },
  );
  const match = /@@(.*)@@/s.exec(child.stdout ?? '');
  if (!match) throw new Error(`cold run failed: ${child.stderr}`);
  const result = JSON.parse(match[1]) as Record<string, { build: number; bake: number }>;
  for (const t of TYPES) {
    cold[t].build.push(result[t].build);
    cold[t].bake.push(result[t].bake);
  }
}

// --- Warm: fresh module instances in this (by now JIT-compiled) process ----------

const reps = QUICK ? 2 : 5; // the first is discarded as warm-up
const warmBuild: Record<PieceQuality, Record<string, number[]>> = {
  low: {},
  medium: {},
  high: {},
};
for (const quality of ['low', 'medium', 'high'] as const) {
  for (const t of TYPES) warmBuild[quality][t] = [];
  for (let rep = 0; rep < reps; rep++) {
    const set = (await freshSet()).pieceSet(quality);
    for (const t of TYPES) {
      const ms = time(() => set[t]);
      if (rep > 0) warmBuild[quality][t].push(ms);
    }
  }
}
const warmBake: Record<string, number[]> = Object.fromEntries(TYPES.map((t) => [t, []]));
for (const t of TYPES) void pieceSet('medium')[t]; // the shared source set, built once
for (let rep = 0; rep < reps; rep++) {
  const baked = (await freshOcclusion()).bakedSet();
  for (const t of TYPES) {
    const ms = time(() => baked[t]);
    if (rep > 0) warmBake[t].push(ms);
  }
}

// --- Report -----------------------------------------------------------------------

const med = (xs: number[]) => summarize(xs).median;
const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);
const name = (t: string) => t.toLowerCase();

const perType: Table = {
  title: 'S1 · First visit: build and bake each piece (medium quality, as drawn)',
  intro:
    'Each piece type is built (`pieceSet`, turned shells, the knight sculpted from a signed ' +
    'distance field and decimated) and then its ambient occlusion baked (`bakedSet`: voxelize, ' +
    'then rays from every vertex), each as its own idle-callback task. *Cold* is the first call ' +
    `in a fresh process (median of ${coldRuns}), what a page load pays; *warm* is JIT-compiled ` +
    `(median of ${reps - 1}). Tasks over 50 ms are long tasks by the browser’s definition.`,
  columns: ['Piece', 'Build, cold', 'Build, warm', 'Bake, cold', 'Bake, warm', 'Worst cold task'],
  align: ['l', 'r', 'r', 'r', 'r', 'r'],
  rows: TYPES.map((t) => {
    const worst = Math.max(...cold[t].build, ...cold[t].bake);
    return [
      name(t),
      duration(med(cold[t].build)),
      duration(med(warmBuild.medium[t])),
      duration(med(cold[t].bake)),
      duration(med(warmBake[t])),
      duration(worst),
    ];
  }),
};
// Compared across runs by the warm build + bake (the cold numbers carry the
// machine's startup noise)
perType.metrics = TYPES.map((t) => ({
  value: med(warmBuild.medium[t]) + med(warmBake[t]),
  unit: 'ms' as const,
  better: 'lower' as const,
}));
const coldTotals = Array.from({ length: coldRuns }, (_, run) =>
  sum(TYPES.map((t) => cold[t].build[run] + cold[t].bake[run])),
);
perType.rows.push([
  '**whole set**',
  duration(sum(TYPES.map((t) => med(cold[t].build)))),
  duration(sum(TYPES.map((t) => med(warmBuild.medium[t])))),
  duration(sum(TYPES.map((t) => med(cold[t].bake)))),
  duration(sum(TYPES.map((t) => med(warmBake[t])))),
  `total ${duration(med(coldTotals))}`,
]);
perType.metrics.push({
  value: sum(TYPES.map((t) => med(warmBuild.medium[t]) + med(warmBake[t]))),
  unit: 'ms',
  better: 'lower',
});

const qualities: Table = {
  title: 'S2 · Piece geometry by quality (warm)',
  intro:
    'The set is built at one of three qualities (`PieceQuality`); the game draws `medium`. ' +
    'The sculpted knight dominates at every quality.',
  columns: ['Quality', 'Whole set', 'Knight', 'Everything else', 'Knight, max'],
  align: ['l', 'r', 'r', 'r', 'r'],
  rows: (['low', 'medium', 'high'] as const).map((q) => {
    const knight = warmBuild[q][PieceType.Knight];
    const rest = sum(TYPES.filter((t) => t !== PieceType.Knight).map((t) => med(warmBuild[q][t])));
    return [
      q,
      duration(med(knight) + rest),
      duration(med(knight)),
      duration(rest),
      duration(Math.max(...knight)),
    ];
  }),
};

emit('startup', {
  tables: [perType, qualities],
  facts: {
    'cold first-visit total (ms)': Number(med(coldTotals).toFixed(1)),
    'cold knight build (ms)': Number(med(cold[PieceType.Knight].build).toFixed(1)),
    'warm high-quality knight (ms)': Number(med(warmBuild.high[PieceType.Knight]).toFixed(1)),
  },
});
console.log(
  JSON.stringify({ coldTotals, perType: perType.rows, qualities: qualities.rows }, null, 1),
);
