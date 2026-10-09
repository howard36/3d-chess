#!/usr/bin/env node
// Runs the benchmark suite and writes its report as Markdown.
//
//   node bench/run.mjs [--quick] [--only client,server,browser] [--out bench/RESULTS.md]
//                      [--compare <dir>] [--from <dir>] [--rounds N]
//                      [--repeat N] [--files engine,game] [--grep <case name pattern>]
//                      [--base <git ref> [--pairs N]] [--server-sections a,b] [--browser-sections a,b]
//
// Three tiers, run one after another so none times the others' load:
//
//   client   the rules engine, the event-sourced game state, the board's
//            pointer/frame math (vitest bench, client/bench/*.bench.ts) and
//            the piece geometry's startup cost (client/bench/startup.ts)
//   server   the WebSocket relay, in process and over real sockets
//            (server/bench/bench_server.py)
//   browser  the production build in headless Chromium, end to end
//            (client/scripts/bench-browser.mjs; needs Chromium, see ARCHITECTURE.md)
//
// Needs client/node_modules (npm ci) and the server's test extra
// (uv sync --extra test in server/). Raw JSON goes to bench/out/ (ignored by
// git); the report is the only file meant to be committed. --quick takes a
// few samples of everything, to check the suite runs, not to measure.
//
// --compare <dir> adds a "vs baseline" column and a summary of what got
// better or worse, against the raw output of an earlier run: copy bench/out
// somewhere (cp -r bench/out /tmp/base) before changing the code, then run
// with --compare /tmp/base. A change inside the noise band is shown but not
// called better or worse.
//
// The client benches run in --rounds rounds (default 3; 1 with --quick):
// every case, then every case again, each round sampling its share of the
// same time budget. Each case reports the median of its rounds and their
// spread, so a hiccup of a shared machine spoils one round, not the result,
// and --compare judges each case against its own measured noise.
// --repeat N runs the server and browser tiers N times (default once: they
// take minutes) and keeps each row's median and spread, as the rounds do.
// --files and --grep narrow the client tier to some bench files or cases
// (vitest's file filter and -t), for iterating on one thing quickly.
//
// --base <ref> is the way to measure a change: it checks <ref> out into a
// temporary worktree, copies this checkout's benchmark code over it (so only
// the app differs), runs the selected tiers on both, interleaved over --pairs
// pairs (base then head, then head then base, ...), and writes an A/B report
// (bench/out/AB.md unless --out) judging each change by pairs of runs made
// next to each other. A/A tests on a shared VM showed its speed drifting by
// 50-100% over minutes, which fools any comparison of runs made apart.
//
// --from <dir> runs nothing: it renders the report from a run's raw output
// already on disk (bench/out, or a copy), e.g. to compare two saved runs.

import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = join(ROOT, 'client');
const OUT_DIR = join(ROOT, 'bench', 'out');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const QUICK = flag('--quick');
const ONLY = option('--only', 'client,server,browser').split(',');
const REPORT = resolve(option('--out', join(ROOT, 'bench', 'RESULTS.md')));
const COMPARE = option('--compare', null);
const FROM = option('--from', null);
const ROUNDS = Math.max(1, Number(option('--rounds', QUICK ? '1' : '3')) || 1);
const FILES = option('--files', '')
  .split(',')
  .filter(Boolean)
  .map((f) => `bench/${f}.bench.ts`);
const GREP = option('--grep', null);
const REPEAT = Math.max(1, Number(option('--repeat', '1')) || 1);
const BASE = option('--base', null);
const PAIRS = Math.max(2, Number(option('--pairs', '3')) || 3);
const SERVER_SECTIONS = option('--server-sections', null);
const BROWSER_SECTIONS = option('--browser-sections', null);
const VENV_PYTHON = join(
  ROOT,
  'server',
  '.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
);

/**
 * Where a tier runs and writes: this checkout by default; with --base, also
 * a worktree of the base commit (`python`: run the server bench with the
 * shared venv's interpreter, never `uv run`, which would re-sync that venv
 * against the worktree).
 */
const MAIN = { root: ROOT, out: OUT_DIR, rounds: ROUNDS, repeat: REPEAT, python: null };

// --- Running the tiers ---------------------------------------------------------

const log = (msg) => process.stderr.write(`[bench] ${msg}\n`);

/** Runs a command, streaming its output to stderr; returns { ok, seconds, tail }. */
function run(label, cmd, cmdArgs, opts = {}) {
  log(`${label}: ${cmd} ${cmdArgs.join(' ')}`);
  const start = Date.now();
  const res = spawnSync(cmd, cmdArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...opts,
    env: { ...process.env, ...(opts.env ?? {}) },
  });
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  process.stderr.write(output.split('\n').slice(-15).join('\n') + '\n');
  const seconds = (Date.now() - start) / 1000;
  const ok = res.status === 0;
  log(
    `${label}: ${ok ? 'done' : `FAILED (exit ${res.status ?? res.signal})`} in ${seconds.toFixed(0)} s`,
  );
  return { ok, seconds, tail: output.split('\n').slice(-25).join('\n') };
}

const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);

/** An earlier run's raw output (a copy of bench/out), read before this run overwrites bench/out. */
function loadBaseline(dir) {
  if (!existsSync(dir)) throw new Error(`--compare: no such directory ${dir}`);
  return {
    dir,
    run: readJson(join(dir, 'run.json')),
    client: readJson(join(dir, 'client-vitest.json')),
    startup: readJson(join(dir, 'client-meta', 'startup.json')),
    server: readJson(join(dir, 'server.json')),
    browser: readJson(join(dir, 'browser.json')),
  };
}

const SIDECARS = ['engine', 'game', 'interaction', 'startup'];
const readSidecars = (dir) =>
  Object.fromEntries(SIDECARS.map((k) => [k, readJson(join(dir, 'client-meta', `${k}.json`))]));

/** A run already on disk, as runClient/runServer/runBrowser would have returned it. */
function loadRun(dir) {
  const info = readJson(join(dir, 'run.json'));
  if (!info) throw new Error(`--from: no run.json in ${dir}`);
  const results = {};
  // (Runs written before tier statuses were recorded list only the tiers' names)
  const tiers = Array.isArray(info.tiers)
    ? Object.fromEntries(info.tiers.map((t) => [t, { ok: true, seconds: NaN, tail: '' }]))
    : info.tiers;
  for (const [tier, status] of Object.entries(tiers)) {
    results[tier] =
      tier === 'client'
        ? {
            ...status,
            vitest: readJson(join(dir, 'client-vitest.json')),
            sidecars: readSidecars(dir),
          }
        : { ...status, data: readJson(join(dir, `${tier}.json`)) };
  }
  return { info, results };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * vitest's JSON with each case registered once per round (inRounds in
 * client/bench/fixtures.ts), merged case by case: the median of the rounds'
 * medians (and of their means, p99s, rates and margins), the samples summed,
 * and `spread`, the rounds' range as a percentage of the median.
 */
function mergeRounds(vitest) {
  return {
    ...vitest,
    files: vitest.files.map((file) => {
      const cases = new Map();
      for (const group of file.groups) {
        for (const bench of group.benchmarks) {
          const key = `${group.fullName}\u0000${bench.name}`;
          if (!cases.has(key)) cases.set(key, { fullName: group.fullName, runs: [] });
          cases.get(key).runs.push(bench);
        }
      }
      const groups = new Map();
      for (const { fullName, runs } of cases.values()) {
        const pick = (key) => median(runs.map((b) => b[key]));
        const medians = runs.map((b) => b.median);
        if (!groups.has(fullName)) groups.set(fullName, { fullName, benchmarks: [] });
        groups.get(fullName).benchmarks.push({
          ...runs[0],
          median: pick('median'),
          mean: pick('mean'),
          p99: pick('p99'),
          hz: pick('hz'),
          rme: pick('rme'),
          sampleCount: runs.reduce((n, b) => n + b.sampleCount, 0),
          roundMedians: medians,
          spread:
            medians.length > 1
              ? ((Math.max(...medians) - Math.min(...medians)) / pick('median')) * 100
              : null,
        });
      }
      return { ...file, groups: [...groups.values()] };
    }),
  };
}

function runClient(ctx = MAIN) {
  const client = join(ctx.root, 'client');
  const meta = join(ctx.out, 'client-meta');
  rmSync(meta, { recursive: true, force: true });
  const env = {
    BENCH_META_DIR: meta,
    BENCH_ROUNDS: String(ctx.rounds),
    ...(QUICK ? { BENCH_QUICK: '1' } : {}),
  };
  const vitestJson = join(ctx.out, 'client-vitest.json');
  const rawJson = join(ctx.out, 'client-vitest.rounds.json');
  rmSync(rawJson, { force: true });
  const steps = [
    run(
      `client benches (${ctx.rounds} round${ctx.rounds > 1 ? 's' : ''})`,
      'npx',
      [
        'vitest',
        'bench',
        '--run',
        '--config',
        'vitest.bench.config.ts',
        '--outputJson',
        rawJson,
        ...FILES,
        ...(GREP ? ['-t', GREP] : []),
      ],
      { cwd: client, env },
    ),
  ];
  const raw = readJson(rawJson);
  if (raw) writeFileSync(vitestJson, JSON.stringify(mergeRounds(raw)));
  // The startup script repeats its own measurements (cold processes, warm reps);
  // skipped when the tier is narrowed to some files or cases
  if (!FILES.length && !GREP) {
    steps.push(
      run(
        'client startup',
        process.execPath,
        ['--expose-gc', 'node_modules/vite-node/dist/cli.mjs', 'bench/startup.ts'],
        { cwd: client, env },
      ),
    );
  }
  return {
    ok: steps.every((r) => r.ok),
    seconds: steps.reduce((t, r) => t + r.seconds, 0),
    tail: steps
      .filter((r) => !r.ok)
      .map((r) => r.tail)
      .join('\n'),
    vitest: readJson(vitestJson),
    sidecars: readSidecars(ctx.out),
  };
}

/**
 * Several runs of a tier that reports keyed per-row metrics (server,
 * browser), merged row by row: each row shows the run whose metric is that
 * row's median, and the metric gains `spread`, the runs' range as a
 * percentage of the median. Findings and meta come from the first run.
 */
function mergeRepeats(runs) {
  if (runs.length < 2) return runs[0] ?? null;
  const merged = structuredClone(runs[0]);
  for (const section of merged.sections) {
    const others = runs.map((r) => r.sections.find((s) => s.title === section.title));
    section.metrics?.forEach((metric, i) => {
      if (!metric) return;
      const found = others
        .map((s) => {
          const j = s?.metrics?.findIndex((m) => m?.key === metric.key) ?? -1;
          return j >= 0 ? { row: s.rows[j], metric: s.metrics[j] } : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.metric.value - b.metric.value);
      const mid = found[(found.length - 1) >> 1];
      const values = found.map((f) => f.metric.value);
      const value = median(values);
      section.rows[i] = mid.row;
      section.metrics[i] = {
        ...mid.metric,
        value,
        spread: value ? ((Math.max(...values) - Math.min(...values)) / Math.abs(value)) * 100 : 0,
      };
    });
  }
  merged.raw = { ...merged.raw, repeats: runs.length };
  return merged;
}

/** Runs a tier REPEAT times into `<name>.json` (merged), keeping each run's output beside it. */
function runRepeated(tier, cmd, argsFor, cwd, ctx) {
  const out = join(ctx.out, `${tier}.json`);
  rmSync(out, { force: true });
  const steps = [];
  const datas = [];
  for (let i = 1; i <= ctx.repeat; i++) {
    const each = ctx.repeat > 1 ? join(ctx.out, `${tier}.run${i}.json`) : out;
    rmSync(each, { force: true });
    const label = ctx.repeat > 1 ? `${tier}, run ${i} of ${ctx.repeat}` : tier;
    steps.push(run(label, cmd, argsFor(each), { cwd }));
    const data = readJson(each);
    if (data) datas.push(data);
  }
  const data = mergeRepeats(datas);
  if (data && ctx.repeat > 1) writeFileSync(out, JSON.stringify(data, null, 2));
  return {
    ok: steps.every((r) => r.ok),
    seconds: steps.reduce((t, r) => t + r.seconds, 0),
    tail: steps
      .filter((r) => !r.ok)
      .map((r) => r.tail)
      .join('\n'),
    data,
  };
}

function runServer(ctx = MAIN) {
  const script = join(ctx.root, 'server', 'bench', 'bench_server.py');
  const extra = [
    ...(QUICK ? ['--quick'] : []),
    ...(SERVER_SECTIONS ? ['--only', SERVER_SECTIONS] : []),
  ];
  return ctx.python
    ? runRepeated('server', ctx.python, (out) => [script, '--out', out, ...extra], ctx.root, ctx)
    : runRepeated(
        'server',
        'uv',
        (out) => ['run', '--project', 'server', 'python', script, '--out', out, ...extra],
        ctx.root,
        ctx,
      );
}

function runBrowser(ctx = MAIN) {
  return runRepeated(
    'browser',
    'node',
    (out) => [
      'scripts/bench-browser.mjs',
      '--out',
      out,
      ...(QUICK ? ['--quick'] : []),
      ...(BROWSER_SECTIONS ? ['--only', BROWSER_SECTIONS] : []),
    ],
    join(ctx.root, 'client'),
    ctx,
  );
}

// --- Formatting ------------------------------------------------------------------

/** 3 significant figures with a unit picked by size (ms in). */
function duration(ms) {
  if (!Number.isFinite(ms)) return String(ms);
  const sig = (v) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
  if (ms < 1e-3) return `${sig(ms * 1e6)} ns`;
  if (ms < 1) return `${sig(ms * 1e3)} µs`;
  if (ms < 1000) return `${sig(ms)} ms`;
  return `${sig(ms / 1000)} s`;
}

function rate(hz) {
  if (hz >= 1e6) return `${(hz / 1e6).toFixed(hz >= 1e7 ? 0 : 1)}M/s`;
  if (hz >= 1e3) return `${(hz / 1e3).toFixed(hz >= 1e4 ? 0 : 1)}k/s`;
  return `${hz >= 10 ? hz.toFixed(0) : hz.toFixed(1)}/s`;
}

const cell = (v) =>
  String(v ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ');

function table({ columns, rows, align }) {
  const a = columns.map((_, i) => ({ l: ':--', r: '--:', c: ':-:' })[align?.[i] ?? 'l']);
  return [
    `| ${columns.map(cell).join(' | ')} |`,
    `| ${a.join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n');
}

function section(level, { title, intro, notes, ...t }) {
  const parts = [`${'#'.repeat(level)} ${title}`];
  if (intro) parts.push(intro);
  if (t.rows?.length) parts.push(table(t));
  if (notes?.length) parts.push(notes.map((n) => `- ${n}`).join('\n'));
  return parts.join('\n\n');
}

// --- Comparing with a baseline --------------------------------------------------------

/** Everything that moved beyond its noise band, for the summary. */
const changes = [];

/**
 * A metric's change against the baseline, judged in the direction that
 * matters (`better`: 'lower' for times, 'higher' for rates). Within `band`
 * percent it is shown but not called better or worse.
 */
function compareMetric(now, then, better, band) {
  if (!Number.isFinite(now) || !Number.isFinite(then) || then === 0) return null;
  const change = ((now - then) / Math.abs(then)) * 100;
  const improved = better === 'higher' ? change > 0 : change < 0;
  const significant = Math.abs(change) > band;
  const pct = `${change > 0 ? '+' : '−'}${Math.abs(change).toFixed(Math.abs(change) >= 10 ? 0 : 1)}%`;
  return {
    change,
    improved,
    significant,
    text: significant ? `**${pct} ${improved ? 'better' : 'worse'}**` : pct,
  };
}

const noted = (tier, where, what, cmp) => {
  if (cmp?.significant) changes.push({ tier, where, what, ...cmp });
  return cmp ? cmp.text : 'new';
};

/**
 * Noise bands (percent) for a single run of the tiers that carry `metrics`,
 * where nothing measured the row's own noise: from A/A tests (identical code
 * run twice) on a shared 4-core VM, whose server and browser rows moved by up
 * to 25-50% at the 95th percentile. With --repeat each row brings its spread.
 */
const BAND = { server: 30, browser: 30, startup: 10 };

/**
 * A pre-formatted section (server, browser, startup tables) with a
 * "vs baseline" column, matched by title and by each row's first two cells,
 * when the section carries per-row `metrics` and a baseline is loaded.
 */
function withBaseline(tier, s, baseSections) {
  if (!baseSections || !s.metrics) return s;
  const base = baseSections.find((b) => b.title === s.title);
  // A row is the same row in both runs by its metric's key, or else by its first cell
  const keyOf = (row, metric) => metric?.key ?? row[0];
  const then = new Map(
    (base?.rows ?? []).map((row, i) => [keyOf(row, base.metrics?.[i]), base.metrics?.[i]]),
  );
  return {
    ...s,
    columns: [...s.columns, 'vs baseline'],
    align: [...(s.align ?? s.columns.map(() => 'l')), 'r'],
    rows: s.rows.map((row, i) => {
      const m = s.metrics[i];
      if (!m) return [...row, ''];
      const key = keyOf(row, m);
      const b = then.get(key);
      if (!b) return [...row, 'new'];
      const band =
        m.spread != null && b.spread != null
          ? Math.max(5, m.spread, b.spread)
          : Math.max(BAND[tier] ?? 10, m.spread ?? 0, b.spread ?? 0);
      return [...row, noted(tier, s.title, key, compareMetric(m.value, b.value, m.better, band))];
    }),
  };
}

// --- The client tier as report sections ----------------------------------------

/** vitest's JSON as [{ file, group, benchmarks }], group being the describe block's name. */
function clientGroups(vitest) {
  if (!vitest) return [];
  return vitest.files.flatMap((f) =>
    f.groups.map((g) => ({
      file: relative(CLIENT, f.filepath),
      group: g.fullName.split(' > ').slice(1).join(' > '),
      benchmarks: g.benchmarks,
    })),
  );
}

function benchSection(g, intro, workload, baseline) {
  const rows = g.benchmarks.map((b) => {
    const row = [
      b.name,
      duration(b.median),
      `${duration(b.mean)} ±${b.rme.toFixed(1)}%`,
      duration(b.p99),
      rate(b.hz),
      String(b.sampleCount),
      b.spread == null ? '' : `${b.spread.toFixed(b.spread >= 10 ? 0 : 1)}%`,
    ];
    if (!baseline) return row;
    const then = baseline.get(`${g.group} > ${b.name}`);
    if (!then) return [...row, 'new'];
    // A change counts only beyond the larger of the two runs' round-to-round
    // spreads, and 5% (an A/A test, identical code twice, flagged about 1% of
    // cases this way on a shared VM). Without rounds nothing measures that
    // noise, and within-run statistics understate it badly: assume 15%.
    const band = Math.max(5, b.spread ?? 15, then.spread ?? 15);
    return [
      ...row,
      noted('client', g.group, b.name, compareMetric(b.median, then.median, 'lower', band)),
    ];
  });
  const parts = [
    section(4, {
      title: g.group,
      intro: intro ?? '',
      columns: [
        'Case',
        'Median',
        'Mean ± RME',
        'p99',
        'Throughput',
        'Samples',
        'Run-to-run',
        ...(baseline ? ['vs baseline'] : []),
      ],
      align: ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
      rows,
    }),
  ];
  if (workload) parts.push(section(5, workload));
  return parts.join('\n\n');
}

/** Looks up a client benchmark by the start of its group and case names. */
function lookup(groups, group, name) {
  const g = groups.find((x) => x.group.startsWith(group));
  return g?.benchmarks.find((b) => b.name.startsWith(name)) ?? null;
}

/** Findings computed from this run's client numbers (each skipped if its data is missing). */
function clientFindings(groups, sidecars) {
  const out = [];
  const b = (group, name) => lookup(groups, group, name);
  const mid = b('E4', 'middlegame');
  const midFast = b('E4', 'what-if, early exit: middlegame');
  const crowded = b('E4', 'crowded');
  if (mid && midFast) {
    out.push(
      `**The end-of-game test dominates every move.** After each move the replay generates *every* ` +
        `legal move of the side to move to rule out mate and stalemate: ${duration(mid.median)} in the ` +
        `middlegame${crowded ? ` (${duration(crowded.median)} on the crowded board)` : ''}, against ` +
        `${duration(midFast.median)} for the same answer stopping at the first legal move ` +
        `(${Math.round(mid.median / midFast.median)}× less; what-if code, not in the app).`,
    );
  }
  const fresh = b('G1', 'new game');
  const m3000 = b('G1', 'marathon ⚠ (3,000');
  if (fresh && m3000) {
    out.push(
      `**Opening a game costs ${duration(fresh.median)} before a single move is replayed** (the ` +
        `game-over test of the starting position); replaying is ~${duration((m3000.median - fresh.median) / 3000)} ` +
        `per ply, so a legal 3,000-ply game (no draw rules stop it) takes ${duration(m3000.median)} to open, ` +
        `and every later move replays it all again.`,
    );
  }
  const whole = b('G4', 'decisive');
  const lastMove = b('G2', 'decisive game, the mating move');
  const move3000 = b('G2', 'marathon ⚠, ply 3,000');
  if (whole && lastMove && move3000) {
    out.push(
      `**Every move replays the whole game from the start:** ${duration(lastMove.median)} when the ` +
        `mating move of a ${whole.name.match(/\d+/)?.[0] ?? ''}-ply game lands, ${duration(move3000.median)} ` +
        `at ply 3,000, on both players' screens. Over that whole game, one client spends ` +
        `${duration(whole.median)} of main-thread time replaying.`,
    );
  }
  const typed = [1000, 4000, 16000]
    .map((n) => [n, b('G6', `move + ${n.toLocaleString('en-US')} spaces`)])
    .filter(([, r]) => r);
  if (typed.length >= 2) {
    const [n0, r0] = typed[0];
    const [n1, r1] = typed[typed.length - 1];
    const exponent = Math.log(r1.median / r0.median) / Math.log(n1 / n0);
    out.push(
      `**The move box's pattern backtracks quadratically** on a legal move followed by a long run of ` +
        `spaces and a stray character: ${typed.map(([n, r]) => `${duration(r.median)} at ${n.toLocaleString('en-US')} spaces`).join(', ')} ` +
        `(time ∝ length^${exponent.toFixed(1)}). A paste of that shape blocks the page's main thread; ` +
        `the field has no length limit.`,
    );
  }
  const flaky = b('G5', 'flaky');
  const live = b('G5', 'decisive');
  if (flaky && live) {
    out.push(
      `**Every message costs more as the log grows, even when nothing changes:** the game screen's ` +
        `per-message work (log copy, selectors, replay memo check, check tests) is ${duration(live.median)} ` +
        `in a normal game and ${duration(flaky.median)} after a flaky opponent's 5,000 reconnects ` +
        `(10k-message log), all of it scans of the whole log.`,
    );
  }
  const storm = b('E1', 'queen storm');
  if (storm) {
    out.push(
      `Selecting a piece stays interactive even when adversarial: the slowest click (a queen among ` +
        `six queens a side) is ${duration(storm.median)}.`,
    );
  }
  const facts = sidecars.startup?.facts;
  if (facts) {
    out.push(
      `**First visit: ~${duration(facts['cold first-visit total (ms)'])} of main-thread geometry work**, ` +
        `in idle-callback tasks one piece type at a time; the sculpted knight alone is ` +
        `${duration(facts['cold knight build (ms)'])} cold, a long task (the high-quality knight: ` +
        `${duration(facts['warm high-quality knight (ms)'])} even warm).`,
    );
  }
  return out;
}

// --- Environment -----------------------------------------------------------------

function sh(cmd, cmdArgs, cwd = ROOT) {
  try {
    return execFileSync(cmd, cmdArgs, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

function environment() {
  const cpus = os.cpus();
  // The report itself and the raw output don't count as changes to what was measured
  const dirty =
    sh('git', ['status', '--porcelain', '--', '.', ':!bench/RESULTS.md', ':!bench/out']) !== '';
  const nodeWanted = existsSync(join(ROOT, '.nvmrc'))
    ? readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim()
    : '?';
  return {
    Commit: `\`${sh('git', ['rev-parse', '--short', 'HEAD'])}\`${dirty ? ' (with uncommitted changes)' : ''}`,
    CPU: `${cpus[0]?.model ?? 'unknown'} × ${cpus.length} (${os.arch()})`,
    Memory: `${(os.totalmem() / 2 ** 30).toFixed(1)} GiB`,
    OS: `${os.type()} ${os.release()}`,
    Node: `${process.version} (the project pins ${nodeWanted} in .nvmrc)`,
    Python: sh('uv', [
      'run',
      '--project',
      'server',
      'python',
      '-c',
      'import sys; print(sys.version.split()[0])',
    ]),
    'Load average at start': os
      .loadavg()
      .map((v) => v.toFixed(2))
      .join(', '),
  };
}

// --- A/B: the base commit and this checkout, interleaved ------------------------------

/** The measuring code: copied from this checkout over the base's, so only the app differs. */
const HARNESS = [
  'client/bench',
  'client/vitest.bench.config.ts',
  'client/scripts/bench-browser.mjs',
  'server/bench',
];

/** A worktree of `ref` with this checkout's harness and installed dependencies. */
function baseWorktree(ref) {
  const sha = sh('git', ['rev-parse', '--verify', `${ref}^{commit}`]);
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`--base: not a commit: ${ref}`);
  const dir = join(mkdtempSync(join(os.tmpdir(), 'bench-base-')), 'tree');
  execFileSync('git', ['worktree', 'add', '--detach', dir, sha], { cwd: ROOT, stdio: 'ignore' });
  for (const path of HARNESS) {
    rmSync(join(dir, path), { recursive: true, force: true });
    cpSync(join(ROOT, path), join(dir, path), { recursive: true });
  }
  symlinkSync(join(CLIENT, 'node_modules'), join(dir, 'client', 'node_modules'), 'dir');
  symlinkSync(join(ROOT, 'server', '.venv'), join(dir, 'server', '.venv'), 'dir');
  return { dir, sha };
}

function removeWorktree(dir) {
  spawnSync('git', ['worktree', 'remove', '--force', dir], { cwd: ROOT, stdio: 'ignore' });
  rmSync(dirname(dir), { recursive: true, force: true });
  spawnSync('git', ['worktree', 'prune'], { cwd: ROOT, stdio: 'ignore' });
}

/** Every measured number of one side's run, by a key that names the same thing in both. */
function flatten(results) {
  const out = new Map();
  const put = (tier, where, what, value, better, unit) => {
    if (Number.isFinite(value))
      out.set(`${tier}\u0000${where}\u0000${what}`, { tier, where, what, value, better, unit });
  };
  for (const g of clientGroups(results.client?.vitest)) {
    for (const b of g.benchmarks) put('client', g.group, b.name, b.median, 'lower', 'ms');
  }
  for (const t of results.client?.sidecars?.startup?.tables ?? []) {
    t.metrics?.forEach(
      (m, i) => m && put('startup', t.title, m.key ?? t.rows[i][0], m.value, m.better, m.unit),
    );
  }
  for (const tier of ['server', 'browser']) {
    for (const s of results[tier]?.data?.sections ?? []) {
      s.metrics?.forEach(
        (m, i) => m && put(tier, s.title, m.key ?? s.rows[i][0], m.value, m.better, m.unit),
      );
    }
  }
  return out;
}

const shown = (value, unit) =>
  unit === 'per_s'
    ? rate(value)
    : unit === 'bytes'
      ? `${(value / 1024).toFixed(1)} KiB`
      : unit === 'fps'
        ? `${value.toFixed(2)} fps`
        : unit === 'count'
          ? String(Number(value.toPrecision(3)))
          : duration(value);

/**
 * The pairs' verdict for one measured thing: each pair's ratio head/base,
 * their geometric mean as the change, and a change called real only when
 * every pair agrees on its direction and it exceeds both 5% and the pairs'
 * own disagreement (their ratios' range).
 */
function verdict(pairs, better) {
  const ratios = pairs.map(([b, h]) => h / b).filter((r) => Number.isFinite(r) && r > 0);
  if (ratios.length < 2) return null;
  const mean = Math.exp(ratios.reduce((s, r) => s + Math.log(r), 0) / ratios.length);
  const change = (mean - 1) * 100;
  const spread = ((Math.max(...ratios) - Math.min(...ratios)) / mean) * 100;
  const agree = ratios.every((r) => r > 1) || ratios.every((r) => r < 1);
  const real = agree && Math.abs(change) > Math.max(5, spread);
  const improved = better === 'higher' ? change > 0 : change < 0;
  return { ratios, change, spread, real, improved };
}

function abMain() {
  const tiers = ONLY.filter((t) => ['client', 'server', 'browser'].includes(t));
  const started = new Date();
  const { dir, sha } = baseWorktree(BASE);
  const headSha = sh('git', ['rev-parse', 'HEAD']);
  const dirty =
    sh('git', ['status', '--porcelain', '--', '.', ':!bench/RESULTS.md', ':!bench/out']) !== '';
  const runs = { base: [], head: [] };
  const failures = [];
  let cleaned = false;
  const clean = () => {
    if (!cleaned) removeWorktree(dir);
    cleaned = true;
  };
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => (clean(), process.exit(130)));
  try {
    for (let pair = 0; pair < PAIRS; pair++) {
      // Base first, then head first, and so on: a drift of the machine over the
      // run weighs on both sides alike
      for (const side of pair % 2 ? ['head', 'base'] : ['base', 'head']) {
        const ctx = {
          root: side === 'base' ? dir : ROOT,
          out: join(OUT_DIR, 'ab', side, String(pair + 1)),
          rounds: 1,
          repeat: 1,
          python: VENV_PYTHON,
        };
        rmSync(ctx.out, { recursive: true, force: true });
        mkdirSync(ctx.out, { recursive: true });
        log(`pair ${pair + 1} of ${PAIRS}: ${side}`);
        const results = {};
        if (tiers.includes('client')) results.client = runClient(ctx);
        if (tiers.includes('server')) results.server = runServer(ctx);
        if (tiers.includes('browser')) results.browser = runBrowser(ctx);
        for (const [tier, r] of Object.entries(results)) {
          if (!r.ok) failures.push({ side, pair: pair + 1, tier, tail: r.tail });
        }
        runs[side].push(flatten(results));
      }
    }
  } finally {
    clean();
  }
  const finished = new Date();

  // Pair each measured thing across the sides
  const keys = [...new Set([...runs.base, ...runs.head].flatMap((m) => [...m.keys()]))];
  const rows = [];
  for (const key of keys) {
    const pairs = runs.base
      .map((b, i) => [b.get(key)?.value, runs.head[i]?.get(key)?.value])
      .filter(([b, h]) => Number.isFinite(b) && Number.isFinite(h));
    const any =
      runs.base.find((m) => m.has(key))?.get(key) ?? runs.head.find((m) => m.has(key)).get(key);
    const v = verdict(pairs, any.better);
    rows.push({ ...any, pairs, v });
  }

  const md = ['# A/B benchmark comparison'];
  md.push(
    `Base \`${BASE}\` (\`${sha.slice(0, 7)}\`) against this checkout (\`${headSha.slice(0, 7)}\`` +
      `${dirty ? ' with uncommitted changes' : ''}), ${PAIRS} interleaved pairs (base then head, then ` +
      `head then base, ...) of ${tiers.join(', ')}; both sides run this checkout’s benchmark code. ` +
      `${Math.round((finished - started) / 60000)} min. Generated by ` +
      `\`node bench/run.mjs ${process.argv.slice(2).join(' ')}\`.`,
  );
  md.push(
    'Each pair’s head/base ratio compares two runs made next to each other in time, so a machine ' +
      'that speeds up or slows down over the run weighs on both. A change is called **better** or ' +
      '**worse** only when every pair agrees on its direction and it exceeds both 5% and the pairs’ ' +
      'own disagreement (the ratios’ range); otherwise it is shown but not called.',
  );
  if (failures.length) {
    md.push(
      `**${failures.length} tier run(s) failed** (a side that does not build or whose API the ` +
        'benchmarks no longer match):\n\n' +
        failures
          .map((f) => `- ${f.side} ${f.tier}, pair ${f.pair}:\n\n\`\`\`\n${f.tail}\n\`\`\``)
          .join('\n'),
    );
  }
  const real = rows.filter((r) => r.v?.real);
  const better = real.filter((r) => r.v.improved);
  md.push('## Summary');
  md.push(
    `${rows.length} measurements compared: **${better.length} better, ${real.length - better.length} ` +
      `worse**, ${rows.length - real.length} unchanged within their noise.`,
  );
  const fmtChange = (v) =>
    v
      ? `${v.change > 0 ? '+' : '−'}${Math.abs(v.change).toFixed(Math.abs(v.change) >= 10 ? 0 : 1)}%`
      : '';
  const line = (r) => [
    r.tier,
    r.where,
    r.what,
    shown(median(r.pairs.map(([b]) => b)), r.unit),
    shown(median(r.pairs.map(([, h]) => h)), r.unit),
    fmtChange(r.v),
    r.v ? r.v.ratios.map((x) => x.toFixed(2)).join(' ') : '',
    !r.v ? 'one side only' : r.v.real ? `**${r.v.improved ? 'better' : 'worse'}**` : '',
  ];
  const columns = [
    'Tier',
    'Where',
    'Case',
    'Base',
    'Head',
    'Change',
    'Pairs (head/base)',
    'Verdict',
  ];
  const align = ['l', 'l', 'l', 'r', 'r', 'r', 'r', 'l'];
  if (real.length) {
    md.push(
      table({
        columns,
        align,
        rows: [...real].sort((a, b) => Math.abs(b.v.change) - Math.abs(a.v.change)).map(line),
      }),
    );
  }
  md.push('## Everything measured');
  md.push(
    '*Base* and *Head* are the medians over the pairs; for throughputs (/s) higher is better, for ' +
      'everything else lower.',
  );
  for (const tier of ['client', 'startup', 'server', 'browser']) {
    const mine = rows.filter((r) => r.tier === tier);
    if (!mine.length) continue;
    md.push(`### ${tier}`);
    md.push(
      table({
        columns: columns.slice(1),
        align: align.slice(1),
        rows: mine.map((r) => line(r).slice(1)),
      }),
    );
  }
  const report = resolve(option('--out', join(OUT_DIR, 'AB.md')));
  mkdirSync(dirname(report), { recursive: true });
  writeFileSync(report, md.join('\n\n') + '\n');
  log(
    `A/B report written to ${report}: ${better.length} better, ${real.length - better.length} worse`,
  );
  process.exit(failures.length ? 1 : 0);
}

// --- Main ----------------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });
if (BASE) abMain();
// Before anything runs: the baseline may be bench/out itself, which this run overwrites
const BASELINE = COMPARE ? loadBaseline(resolve(COMPARE)) : null;
let started, finished, env, quick;
let results = {};
if (FROM) {
  const loaded = loadRun(resolve(FROM));
  ({ env, quick } = loaded.info);
  [started, finished] = [new Date(loaded.info.started), new Date(loaded.info.finished)];
  results = loaded.results;
} else {
  started = new Date();
  env = environment();
  quick = QUICK;
  if (ONLY.includes('client')) results.client = runClient();
  if (ONLY.includes('server')) results.server = runServer();
  if (ONLY.includes('browser')) results.browser = runBrowser();
  finished = new Date();
  const tiers = Object.fromEntries(
    Object.entries(results).map(([tier, r]) => [
      tier,
      { ok: r.ok, seconds: r.seconds, tail: r.tail },
    ]),
  );
  writeFileSync(
    join(OUT_DIR, 'run.json'),
    JSON.stringify({ started, finished, quick, tiers, env }, null, 2),
  );
}
const minutes = (sec) =>
  !Number.isFinite(sec) ? '?' : sec >= 90 ? `${(sec / 60).toFixed(1)} min` : `${sec.toFixed(0)} s`;
env['Run time'] = [
  ...Object.entries(results).map(([tier, r]) => `${tier} ${minutes(r.seconds)}`),
  `total ${minutes((finished - started) / 1000)}`,
].join(' · ');

const md = [];
md.push('# Benchmark results');
md.push(
  `Generated by \`node bench/run.mjs${quick ? ' --quick' : ''}\` on ${started.toISOString().slice(0, 16).replace('T', ' ')} UTC ` +
    `(${Math.round((finished - started) / 60000)} min). ${quick ? '**Quick mode: a smoke run with too few samples to compare.** ' : ''}` +
    'Regenerate with the same command; see [How to run](#how-to-run) and [Method](#method).',
);

// Summary
const findings = [];
const groups = clientGroups(results.client?.vitest);
if (results.client) findings.push(...clientFindings(groups, results.client.sidecars));
for (const tier of ['server', 'browser']) findings.push(...(results[tier]?.data?.findings ?? []));
md.push('## Summary');
md.push(
  'Cases marked ⚠ are adversarial or unusual: built to find the worst case the rules or the protocol ' +
    'allow, not what a typical game does. Everything else follows a real path through the app.',
);
if (findings.length) md.push(findings.map((f) => `- ${f}`).join('\n'));

md.push('## Environment');
md.push(table({ columns: ['', ''], rows: Object.entries(env), align: ['l', 'l'] }));
for (const tier of ['server', 'browser']) {
  const meta = results[tier]?.data?.meta;
  if (meta)
    md.push(
      `${results[tier].data.title}:\n\n${table({ columns: ['', ''], rows: Object.entries(meta) })}`,
    );
}

const failed = (name, r) =>
  `**The ${name} tier failed** (after ${r.seconds.toFixed(0)} s). Last output:\n\n\`\`\`\n${r.tail}\n\`\`\``;

// Client
if (results.client) {
  const { sidecars } = results.client;
  md.push('## Client');
  md.push(
    'Timed in Node with vitest’s benchmark runner (tinybench), from `client/bench/`. The workloads are ' +
      'deterministic: games played by seeded policies (`client/bench/fixtures.ts`), positions built ' +
      'to stress one part of the rules, and message logs shaped like real sessions.',
  );
  if (!results.client.ok) md.push(failed('client', results.client));
  const parts = [
    ['engine', 'Rules engine (`client/src/engine`)'],
    ['game', 'Event-sourced game state (`client/src/game`)'],
    ['interaction', 'Board interaction math (`client/src/three`)'],
  ];
  const baseBench = BASELINE?.client
    ? new Map(
        clientGroups(BASELINE.client).flatMap((g) =>
          g.benchmarks.map((b) => [`${g.group} > ${b.name}`, b]),
        ),
      )
    : null;
  for (const [key, title] of parts) {
    const sc = sidecars[key] ?? {};
    md.push(`### ${title}`);
    for (const t of sc.tables ?? []) md.push(section(4, t));
    for (const g of groups.filter((x) => x.file.endsWith(`${key}.bench.ts`))) {
      md.push(benchSection(g, sc.intros?.[g.group], sc.workloads?.[g.group], baseBench));
    }
    if (key === 'engine' && sc.facts) {
      md.push(
        `Perft node counts (a checksum of the work done): ${Object.entries(sc.facts)
          .map(([k, v]) => `${k} = ${v}`)
          .join(', ')}.`,
      );
    }
  }
  md.push('### Startup: piece geometry (`client/src/three/pieces`, `scene/occlusion.ts`)');
  md.push(
    'Measured by hand (`client/bench/startup.ts`): one-time work tinybench cannot repeat cold.',
  );
  for (const t of sidecars.startup?.tables ?? []) {
    md.push(section(4, withBaseline('startup', t, BASELINE?.startup?.tables)));
  }
}

for (const [tier, name] of [
  ['server', 'Server'],
  ['browser', 'Browser'],
]) {
  const r = results[tier];
  if (!r) continue;
  md.push(`## ${r.data?.title ?? name}`);
  if (!r.ok || !r.data) md.push(failed(tier, r));
  for (const s of r.data?.sections ?? []) {
    md.push(section(3, withBaseline(tier, s, BASELINE?.[tier]?.sections)));
  }
}

// What changed against the baseline, placed right after the summary
if (BASELINE) {
  const was = BASELINE.run;
  const lines = [
    '## Compared with the baseline',
    `Baseline: \`${BASELINE.dir.startsWith(ROOT) ? relative(ROOT, BASELINE.dir) : BASELINE.dir}\`` +
      (was
        ? `, run ${String(was.started).slice(0, 16).replace('T', ' ')} UTC at ${was.env?.Commit ?? '?'}`
        : '') +
      (was?.quick ? ' (**a quick run: too few samples to compare against**)' : '') +
      '. A change is called better or worse only beyond its noise: the larger of the two runs\u2019 ' +
      'round-to-round (or repeat-to-repeat) spread for that row, and at least 5%; for a row measured ' +
      'once, 15% (client), 10% (startup) or 30% (server, browser), from A/A tests on a shared VM. ' +
      'The tables show every change.',
  ];
  if (changes.length === 0) {
    lines.push('Nothing moved beyond its noise band.');
  } else {
    const count = (improved) => changes.filter((c) => c.improved === improved).length;
    lines.push(`${count(true)} better, ${count(false)} worse. The largest changes:`);
    const top = [...changes].sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 15);
    lines.push(
      table({
        columns: ['Tier', 'Where', 'Case', 'Change'],
        align: ['l', 'l', 'l', 'r'],
        rows: top.map((c) => [c.tier, c.where, c.what, c.text]),
      }),
    );
  }
  const at = md.findIndex((m) => m.startsWith('## Environment'));
  md.splice(at, 0, ...lines);
}

md.push('## Method');
md.push(
  [
    'Each tier runs alone, one after another, on an otherwise idle machine; the numbers are only ' +
      'comparable between runs on the same machine. A shared cloud VM like the one above is noisy in ' +
      'a way no single run can see: A/A tests (identical code run twice) moved single-run medians by ' +
      'up to 30\u201370% for a few cases while most stayed within 3%. So the client tier runs each case ' +
      'in rounds and reports their spread, and `--compare` calls a change real only beyond that spread ' +
      '(and 5%); with that rule, identical runs flagged about 1\u20135% of cases.',
    'Client microbenchmarks: tinybench via `vitest bench` in Node (no jsdom), each case warmed up, ' +
      'started from a freshly collected heap, then sampled for 0.3 s and at least 20 calls in all ' +
      '(cases of 20\u2013400 ms: 0.8 s and at least 6; whole-game replays: 3 calls; `SAMPLE` in ' +
      '`client/bench/fixtures.ts`), split over three rounds a pass of the whole file apart. *Median* ' +
      'is the median of the rounds\u2019 medians and *Run-to-run* their range: how far this case moves ' +
      'between identical runs on this machine, the noise a comparison has to beat. *Median* and *p99* ' +
      'are per call; *Mean ± RME* is the mean with its relative margin of error at 95%; *Throughput* is ' +
      'calls per second. Results are kept alive in a module-level sink so the JIT cannot skip the work.',
    'The seeded games choose among the legal moves in a fixed order of their own, so an optimisation ' +
      'that only reorders move generation times exactly the same games; their fingerprints and the ' +
      'perft counts are checked on every run, and a mismatch stops the client tier (the engine\u2019s ' +
      'rules changed) rather than timing different work.',
    'The client benches run the app’s own modules unmodified. Where the app computes something inside a ' +
      'React component (the per-message work of `GameScreen.tsx`, the hover probe of `Board.tsx`, the tap ' +
      'assist’s projection), the bench reproduces those few lines around the real functions; ' +
      '*what-if* rows are alternatives for comparison, not app code.',
    'Server and browser tiers measure wall-clock latency over real sockets on localhost, so they include ' +
      'the kernel’s loopback but no real network: production adds the internet round trip and Modal’s ' +
      'own `modal.Dict` latency, which only the server tier’s simulated-latency store models.',
    'The browser tier renders WebGL in software (SwiftShader), so frame times are CPU-bound and far slower ' +
      'than a GPU would draw; they are useful relative to each other, not as absolute frame rates.',
  ]
    .map((p) => `- ${p}`)
    .join('\n'),
);
md.push('## How to run');
md.push(
  [
    '```bash',
    '# once',
    '(cd client && npm ci) && (cd server && uv sync --extra test)',
    '',
    '# everything, then read bench/RESULTS.md (raw JSON in bench/out/)',
    'node bench/run.mjs',
    '',
    '# one tier, or a fast smoke run',
    'node bench/run.mjs --only client',
    'node bench/run.mjs --quick --out /tmp/quick.md',
    '',
    '# measure a change: interleaved A/B against a commit, report in bench/out/AB.md',
    'node bench/run.mjs --base HEAD                                    # uncommitted work vs HEAD',
    'node bench/run.mjs --base main --only client --files engine --grep E4   # one group, < 1 min',
    '',
    '# or compare with a saved run (only as good as the machine was steady in between)',
    'cp -r bench/out /tmp/base && node bench/run.mjs --only client --compare /tmp/base',
    '',
    '# a tier, a file or a single case on its own (fastest while iterating)',
    'cd client && npx vitest bench --config vitest.bench.config.ts                    # engine, game, interaction',
    'cd client && npx vitest bench --config vitest.bench.config.ts bench/engine.bench.ts -t "E4"',
    'cd client && node --expose-gc node_modules/vite-node/dist/cli.mjs bench/startup.ts  # piece geometry startup',
    'uv run --project server python server/bench/bench_server.py --out /tmp/server.json [--only store,move-rtt]',
    'cd client && node scripts/bench-browser.mjs --out /tmp/browser.json [--only reopen]',
    '```',
    '',
    'The browser tier needs Playwright’s Chromium; in a container with a preinstalled one, set ' +
      '`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` (see `client/playwright.config.ts`).',
  ].join('\n'),
);

mkdirSync(dirname(REPORT), { recursive: true });
writeFileSync(REPORT, md.join('\n\n') + '\n');
log(`report written to ${relative(process.cwd(), REPORT) || REPORT}`);
const anyFailed = Object.values(results).some((r) => !r.ok);
process.exit(anyFailed ? 1 : 0);
