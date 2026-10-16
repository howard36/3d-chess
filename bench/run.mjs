#!/usr/bin/env node
// Runs the benchmark suite and writes its report as Markdown.
//
//   node bench/run.mjs [--quick] [--primary] [--only client,server,browser]
//                      [--out bench/out/RESULTS.md] [--compare <dir>] [--from <dir>] [--rounds N]
//                      [--repeat N] [--files engine,game] [--grep <case name pattern>]
//                      [--base <git ref> [--pairs N]]
//                      [--server-sections a,b] [--browser-sections a,b]
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
// (uv sync --extra test in server/). The report and the raw JSON go to
// bench/out/ (ignored by git: a report is true of one commit on one machine,
// and a copy left in the tree reads as current long after it is not).
// --quick takes a few samples of everything, to check the suite runs, not to
// measure.
//
// The report and the A/B comparison lead with the primary rows
// (bench/primary.mjs): one number for each moment a player waits on, each
// from the player's action to what they see. --primary runs only what those
// rows need (the browser tier's primary profile and the client tier's search
// bench), the quick way to judge a change: with --base, about 13 minutes on
// a 4-core VM, where the client and browser tiers in full took 37.
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
// the app differs), copies this checkout into a second one laid out alike
// (node_modules and .venv linked in), runs the selected tiers on both, interleaved over --pairs
// pairs (base then head, then head then base, ...), and writes an A/B report
// (bench/out/AB.md unless --out) judging each change by pairs of runs made
// next to each other. A/A tests on a shared VM showed its speed drifting by
// 50-100% over minutes, which fools any comparison of runs made apart.
// Without --only it runs the tiers the diff can touch (server/ changed: the
// server tier; the client's app code: client and browser).
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
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PRIMARY, PRIMARY_BROWSER_SECTIONS, PRIMARY_CLIENT_FILES, keyOf } from './primary.mjs';
import { median, verdict } from './verdict.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = join(ROOT, 'client');
const OUT_DIR = join(ROOT, 'bench', 'out');

// A flag it does not know, or one missing its value, stops it with the usage
// above: a typo would otherwise run something else and overwrite the report
const STRINGS = ['only', 'out', 'compare', 'from', 'rounds', 'files', 'grep', 'repeat', 'base'];
STRINGS.push('pairs', 'server-sections', 'browser-sections');
let parsed;
try {
  parsed = parseArgs({
    options: Object.fromEntries([
      ['quick', { type: 'boolean' }],
      ['primary', { type: 'boolean' }],
      ...STRINGS.map((name) => [name, { type: 'string' }]),
    ]),
    strict: true,
    allowPositionals: false,
  }).values;
} catch (e) {
  process.stderr.write(`[bench] ${e.message}\nUsage: see the top of bench/run.mjs.\n`);
  process.exit(2);
}
const flag = (name) => parsed[name.slice(2)] === true;
const option = (name, fallback) => parsed[name.slice(2)] || fallback;
const QUICK = flag('--quick');
const PRIMARY_ONLY = flag('--primary');
const ONLY_GIVEN = option('--only', null);
let ONLY = (ONLY_GIVEN ?? (PRIMARY_ONLY ? 'client,browser' : 'client,server,browser')).split(',');
const TIERS = ['client', 'server', 'browser'];
if (ONLY.some((t) => !TIERS.includes(t))) {
  process.stderr.write(`[bench] --only takes ${TIERS.join(', ')} (comma-separated, no spaces)\n`);
  process.exit(2);
}
const REPORT = resolve(option('--out', join(ROOT, 'bench', 'out', 'RESULTS.md')));
const COMPARE = option('--compare', null);
const FROM = option('--from', null);
const ROUNDS = Math.max(1, Number(option('--rounds', QUICK ? '1' : '3')) || 1);
const FILES = option('--files', PRIMARY_ONLY ? PRIMARY_CLIENT_FILES.join(',') : '')
  .split(',')
  .filter(Boolean)
  .map((f) => `bench/${f}.bench.ts`);
const GREP = option('--grep', null);
const REPEAT = Math.max(1, Number(option('--repeat', '1')) || 1);
const BASE = option('--base', null);
const PAIRS = Math.max(2, Number(option('--pairs', '3')) || 3);
const SERVER_SECTIONS = option('--server-sections', null);
const BROWSER_SECTIONS = option(
  '--browser-sections',
  PRIMARY_ONLY ? PRIMARY_BROWSER_SECTIONS.join(',') : null,
);
const VENV_PYTHON = join(
  ROOT,
  'server',
  '.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
);

/**
 * Where a tier runs and writes: this checkout by default; with --base, also
 * a worktree of the base commit (`python`: run the server bench with that
 * side's venv interpreter, never `uv run`, which would re-sync the venv
 * against the worktree; the base shares this checkout's unless it locks
 * other packages).
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

const SIDECARS = ['engine', 'game', 'interaction', 'ai', 'startup'];
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
      ...(QUICK ? ['--quick'] : PRIMARY_ONLY ? ['--profile', 'primary'] : []),
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
  if (ms === 0) return '0 ms';
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
  const rowKey = (row, metric) => metric?.key ?? row[0];
  const then = new Map(
    (base?.rows ?? []).map((row, i) => [rowKey(row, base.metrics?.[i]), base.metrics?.[i]]),
  );
  return {
    ...s,
    columns: [...s.columns, 'vs baseline'],
    align: [...(s.align ?? s.columns.map(() => 'l')), 'r'],
    rows: s.rows.map((row, i) => {
      const m = s.metrics[i];
      if (!m) return [...row, ''];
      const key = rowKey(row, m);
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

/**
 * Findings from this run's client numbers, each skipped if its data is
 * missing. They state the numbers and nothing about their cause: a cause
 * written here once stays in the report after the code has changed (the
 * report long said a pattern backtracked quadratically beside numbers that
 * grew linearly), and a reader takes the report's word for it.
 */
function clientFindings(groups, sidecars) {
  const out = [];
  const b = (group, name) => lookup(groups, group, name);
  const fresh = b('G1', 'new game');
  const m3000 = b('G1', 'marathon ⚠ (3,000');
  const move3000 = b('G2', 'marathon ⚠, ply 3,000');
  if (fresh && m3000 && move3000) {
    out.push(
      `Opening a game replays its record: ${duration(fresh.median)} for a new game, ` +
        `${duration(m3000.median)} for 3,000 plies; a move arriving at ply 3,000 costs ` +
        `${duration(move3000.median)}.`,
    );
  }
  const storm = b('E1', 'queen storm');
  if (storm) {
    out.push(
      `The slowest piece to select (a queen among six queens a side, adversarial) takes ` +
        `${duration(storm.median)} of rules work.`,
    );
  }
  const search = groups.find((g) => g.group.startsWith('A1'));
  if (search?.benchmarks.length) {
    const nodes = sidecars.ai?.workloads?.[search.group]?.rows?.[0]?.[2];
    out.push(
      `The computer’s search: ${search.benchmarks
        .map((x) => `${duration(x.median)} (${x.name})`)
        .join(', ')} for ${nodes ? `about ${nodes}` : 'a fixed number of'} positions each.`,
    );
  }
  const facts = sidecars.startup?.facts;
  if (facts) {
    out.push(
      `First visit: ~${duration(facts['cold first-visit total (ms)'])} of main-thread work ` +
        `building and baking the piece set; the knight alone ${duration(facts['cold knight build (ms)'])} cold.`,
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
  const dirty = sh('git', ['status', '--porcelain', '--', '.', ':!bench/out']) !== '';
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

/** The machine as a run begins (Linux; blank where /proc says nothing). */
function machineState(lastEnd) {
  const read = (file) => {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return '';
    }
  };
  const avg10 = (file) => Number(/some avg10=([\d.]+)/.exec(read(file))?.[1]);
  // Processes earlier runs left behind, by their own executable (a shell
  // whose command line names them is not one)
  const left = { chromium: 0, preview: 0, uvicorn: 0 };
  let pids = null;
  try {
    pids = readdirSync('/proc').filter((d) => /^\d+$/.test(d));
  } catch {
    // No /proc (macOS): the column stays blank
  }
  for (const pid of pids ?? []) {
    const argv = read(`/proc/${pid}/cmdline`).split('\0');
    const exe = argv[0].split('/').pop();
    if (exe === 'headless_shell' || exe === 'chrome') left.chromium++;
    else if (exe === 'node' && argv.includes('preview') && argv.some((a) => /vite(\.js)?$/.test(a)))
      left.preview++;
    else if (/^python/.test(exe) && argv.includes('uvicorn')) left.uvicorn++;
  }
  return {
    gap: lastEnd === null ? NaN : (Date.now() - lastEnd) / 1000,
    load: os.loadavg()[0],
    cpu: avg10('/proc/pressure/cpu'),
    io: avg10('/proc/pressure/io'),
    memGiB: Number(/MemAvailable:\s+(\d+)/.exec(read('/proc/meminfo'))?.[1]) / 2 ** 20,
    left: pids ? `${left.chromium} / ${left.preview} / ${left.uvicorn}` : '',
  };
}

/** A worktree of `ref` with this checkout's harness and installed dependencies. */
function baseWorktree(ref) {
  const sha = sh('git', ['rev-parse', '--verify', `${ref}^{commit}`]);
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    // A cloud session's clone is shallow: an old base (the first recorded run) isn't in it
    const shallow = sh('git', ['rev-parse', '--is-shallow-repository']) === 'true';
    throw new Error(
      `--base: not a commit: ${ref}` +
        (shallow ? ' (this clone is shallow: fetch the history first, git fetch --unshallow)' : ''),
    );
  }
  const dir = join(mkdtempSync(join(os.tmpdir(), 'bench-base-')), 'tree');
  execFileSync('git', ['worktree', 'add', '--detach', dir, sha], { cwd: ROOT, stdio: 'ignore' });
  for (const path of HARNESS) {
    rmSync(join(dir, path), { recursive: true, force: true });
    cpSync(join(ROOT, path), join(dir, path), { recursive: true });
  }
  // Shared dependencies, unless the base locks others: then it installs its own,
  // or the A/B would time this checkout's three.js, React or Starlette on both sides
  const differs = (lock) =>
    spawnSync('git', ['diff', '--quiet', sha, '--', lock], { cwd: ROOT }).status !== 0;
  const python = join(dir, 'server', '.venv', 'bin', 'python');
  if (differs('client/package-lock.json')) {
    log(`base ${sha.slice(0, 7)} locks other npm packages: npm ci in its worktree`);
    execFileSync('npm', ['ci', '--no-audit', '--no-fund'], {
      cwd: join(dir, 'client'),
      stdio: 'ignore',
    });
  } else {
    symlinkSync(join(CLIENT, 'node_modules'), join(dir, 'client', 'node_modules'), 'dir');
  }
  if (differs('server/uv.lock')) {
    log(`base ${sha.slice(0, 7)} locks other Python packages: uv sync in its worktree`);
    execFileSync('uv', ['sync', '--extra', 'test', '--frozen'], {
      cwd: join(dir, 'server'),
      stdio: 'ignore',
    });
    return { dir, sha, python };
  }
  symlinkSync(join(ROOT, 'server', '.venv'), join(dir, 'server', '.venv'), 'dir');
  return { dir, sha, python: VENV_PYTHON };
}

/**
 * This checkout as it stands (its commit, uncommitted and untracked files),
 * laid out as the base's worktree is: a temp dir with node_modules and .venv
 * linked in. Run from the checkout itself, the head would differ from the
 * base in where it lives as well as in its code (1016:AA1).
 */
function headWorktree() {
  const dir = join(mkdtempSync(join(os.tmpdir(), 'bench-head-')), 'tree');
  execFileSync('git', ['worktree', 'add', '--detach', dir, 'HEAD'], { cwd: ROOT, stdio: 'ignore' });
  for (const f of changedSince('HEAD')) {
    const to = join(dir, f);
    if (existsSync(join(ROOT, f))) {
      mkdirSync(dirname(to), { recursive: true });
      cpSync(join(ROOT, f), to);
    } else rmSync(to, { force: true });
  }
  symlinkSync(join(CLIENT, 'node_modules'), join(dir, 'client', 'node_modules'), 'dir');
  symlinkSync(join(ROOT, 'server', '.venv'), join(dir, 'server', '.venv'), 'dir');
  return dir;
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

/** The files of this checkout (commits, uncommitted and untracked) that differ from `ref`. */
function changedSince(ref) {
  return [
    ...sh('git', ['diff', '--name-only', ref]).split('\n'),
    ...sh('git', ['ls-files', '--others', '--exclude-standard']).split('\n'),
  ].filter((f) => f && f !== 'unknown');
}

/** Of those, the ones the app is made of: not the benchmark code, not tests, not bench/loop. */
function appChanges(sha) {
  const harness = (f) => HARNESS.some((h) => f === h || f.startsWith(`${h}/`));
  return changedSince(sha).filter(
    (f) =>
      !harness(f) &&
      !f.startsWith('bench/') &&
      !/\.test\.tsx?$|\.spec\.ts$|^server\/tests\//.test(f),
  );
}

/**
 * The tiers a change from `sha` to this checkout (commits, uncommitted and
 * untracked files) can move, and why: the server's code moves the server
 * tier, the client's app code (what the build is made of) the client and
 * browser tiers. Only the app counts: the benchmark code is this checkout's
 * on both sides. Nothing the app is made of changed (an A/A test): every tier.
 */
function tiersFromDiff(sha) {
  const app = appChanges(sha);
  const server = app.some((f) => f.startsWith('server/') && !f.startsWith('server/tests/'));
  const client = app.some((f) =>
    /^client\/(src\/|public\/|index\.html$|vite\.config\.ts$|package(-lock)?\.json$)/.test(f),
  );
  const tiers = [...(client ? ['client', 'browser'] : []), ...(server ? ['server'] : [])];
  if (!tiers.length) {
    return {
      tiers: ['client', 'server', 'browser'],
      why: 'nothing the app is made of differs from the base: every tier (an A/A test)',
    };
  }
  return {
    tiers,
    why: `the diff touches ${[client && 'the client’s app code', server && 'the server'].filter(Boolean).join(' and ')}`,
  };
}

function abMain() {
  const { dir, sha, python: basePython } = baseWorktree(BASE);
  const headDir = headWorktree();
  const appFiles = appChanges(sha);
  const chosen = ONLY_GIVEN
    ? { tiers: ONLY, why: '--only' }
    : PRIMARY_ONLY
      ? { tiers: ONLY, why: '--primary' }
      : tiersFromDiff(sha);
  const tiers = chosen.tiers.filter((t) => ['client', 'server', 'browser'].includes(t));
  log(`tiers: ${tiers.join(', ')} (${chosen.why})`);
  const started = new Date();
  const headSha = sh('git', ['rev-parse', 'HEAD']);
  const dirty = sh('git', ['status', '--porcelain', '--', '.', ':!bench/out']) !== '';
  const runs = { base: [], head: [] };
  // What the machine was doing as each run began (1016:AA1: the run that
  // goes first in its pair differs from the second by ~10%, unexplained)
  const machine = [];
  let lastEnd = null;
  const failures = [];
  let cleaned = false;
  const clean = () => {
    if (!cleaned) [dir, headDir].forEach(removeWorktree);
    cleaned = true;
  };
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => (clean(), process.exit(130)));
  try {
    for (let pair = 0; pair < PAIRS; pair++) {
      // Base first, then head first, and so on: a drift of the machine over the
      // run weighs on both sides alike
      for (const side of pair % 2 ? ['head', 'base'] : ['base', 'head']) {
        const ctx = {
          root: side === 'base' ? dir : headDir,
          out: join(OUT_DIR, 'ab', side, String(pair + 1)),
          rounds: 1,
          repeat: 1,
          python: side === 'base' ? basePython : VENV_PYTHON,
        };
        rmSync(ctx.out, { recursive: true, force: true });
        mkdirSync(ctx.out, { recursive: true });
        log(`pair ${pair + 1} of ${PAIRS}: ${side}`);
        machine.push({ pair: pair + 1, side, ...machineState(lastEnd) });
        const results = {};
        if (tiers.includes('client')) results.client = runClient(ctx);
        if (tiers.includes('server')) results.server = runServer(ctx);
        if (tiers.includes('browser')) results.browser = runBrowser(ctx);
        for (const [tier, r] of Object.entries(results)) {
          if (!r.ok) failures.push({ side, pair: pair + 1, tier, tail: r.tail });
        }
        runs[side].push(flatten(results));
        lastEnd = Date.now();
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
    const v = verdict(pairs, any.better, any.unit);
    // Each side's own values, paired or not: a row one side lost must show
    const sides = ['base', 'head'].map((side) =>
      runs[side].map((m) => m.get(key)?.value).filter(Number.isFinite),
    );
    rows.push({ ...any, pairs, v, sides });
  }

  const md = ['# A/B benchmark comparison'];
  md.push(
    `Base \`${BASE}\` (\`${sha.slice(0, 7)}\`) against this checkout (\`${headSha.slice(0, 7)}\`` +
      `${dirty ? ' with uncommitted changes' : ''}), ${runs.base.length} interleaved pairs (base then head, then ` +
      `head then base, ...) of ${tiers.join(', ')} (${chosen.why}); both sides run this checkout’s benchmark code, ` +
      `each from a temporary worktree. ` +
      (appFiles.length
        ? `The app differs in ${appFiles.length} file(s): ${appFiles
            .slice(0, 12)
            .map((f) => `\`${f}\``)
            .join(', ')}${appFiles.length > 12 ? ', …' : ''}. `
        : 'No file the app is made of differs: an A/A test. ') +
      `${Math.round((finished - started) / 60000)} min. Generated by ` +
      `\`node bench/run.mjs ${process.argv.slice(2).join(' ')}\`.`,
  );
  md.push(
    'A *pair* is one run of the base and one of the head, made back to back, so if the machine ' +
      'speeds up or slows down during the comparison, both sides feel it. Each pair gives a ratio, ' +
      'head divided by base. A change is called **better** or **worse** only when every pair moves ' +
      'the same way, by more than 5% and by more than the pairs disagree with each other (the range ' +
      'of their ratios). Otherwise the change is shown but not called. A value of 0 on one side has ' +
      'no ratio: that row is judged by the pairs’ differences instead, and called when every pair ' +
      'moves the same way. *Base first* and *Head first* are the geometric means of the ratios of ' +
      'the pairs where that side ran first: a gap between them that the overall figure lacks is the ' +
      'order of the runs, not the code (too few pairs to call anything on).',
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
  // Measured in fewer pairs than were run, or on one side only: a section
  // that stopped, a selector that no longer matches
  const short = rows.filter((r) => r.pairs.length < runs.base.length);
  if (short.length) {
    md.push(
      `**${short.length} measurement(s) not taken in every pair**: ${short
        .map((r) => `${r.where}: ${r.what} (${r.pairs.length} of ${runs.base.length})`)
        .join('; ')}.`,
    );
  }
  const fmtDiff = (d, unit) =>
    `${d > 0 ? '+' : d < 0 ? '−' : ''}${unit === 'count' ? Math.abs(d) : shown(Math.abs(d), unit)}`;
  const fmtChange = (v, unit) =>
    !v
      ? ''
      : v.diffs
        ? v.change
          ? fmtDiff(v.change, unit)
          : ''
        : `${v.change > 0 ? '+' : '−'}${Math.abs(v.change).toFixed(Math.abs(v.change) >= 10 ? 0 : 1)}%`;
  const called = (v) =>
    !v ? 'one side only' : v.real ? `**${v.improved ? 'better' : 'worse'}**` : '';
  const line = (r) => [
    r.tier,
    r.where,
    r.what,
    ...r.sides.map((xs) => (xs.length ? shown(median(xs), r.unit) : 'missing')),
    fmtChange(r.v, r.unit),
    r.v?.diffs
      ? r.v.diffs.map((d) => fmtDiff(d, r.unit)).join(' ')
      : r.v
        ? r.v.ratios.map((x) => x.toFixed(2)).join(' ')
        : '',
    called(r.v),
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

  // The primary rows first: the moments a player waits on
  const byKey = new Map(rows.map((r) => [keyOf(r), r]));
  const primary = PRIMARY.map((p) => ({ p, r: byKey.get(keyOf(p)) }));
  const measured = primary.filter(({ r }) => r?.v?.ratios.length);
  const unmeasured = primary.filter(({ r }) => !r?.v?.ratios.length);
  md.push('## Primary rows');
  if (unmeasured.length) {
    md.push(
      `**${unmeasured.length} of ${primary.length} primary rows not compared**, because they ` +
        `are missing on one side or measured in fewer than two pairs. They are left out of the ` +
        `overall figure: ` +
        `${unmeasured.map(({ p }) => p.moment).join('; ')}.`,
    );
  }
  if (measured.length) {
    // Each row's head/base as a speed (time rows inverted): above 1, faster.
    // Its pairs' median ratio, so one wild pair of a row with two modes (the
    // start page's first click) cannot tip the whole figure
    const speeds = measured.map(({ r }) => {
      const ratio = median(r.v.ratios);
      return r.better === 'higher' ? ratio : 1 / ratio;
    });
    const geo = Math.exp(speeds.reduce((t, x) => t + Math.log(x), 0) / speeds.length);
    md.push(
      `Over the ${measured.length} primary rows measured (\`bench/primary.mjs\`), the head is ` +
        `**×${geo.toFixed(3)}** as fast as the base. That is the geometric mean of each row’s ` +
        `median pair; above 1 means faster, and identical code compared with itself gave ×1.004. ` +
        `${measured.filter(({ r }) => r.v.real && r.v.improved).length} called better, ` +
        `${measured.filter(({ r }) => r.v.real && !r.v.improved).length} called worse.`,
    );
  }
  // Each pair's ratio by which side ran first (pair 1, 3, ...: the base)
  const byOrder = (r) => {
    const key = keyOf(r);
    const geo = (first) => {
      const logs = runs.base
        .map((m, i) => [i, m.get(key)?.value, runs.head[i]?.get(key)?.value])
        .filter(([i, b, h]) => i % 2 === (first === 'base' ? 0 : 1) && b > 0 && h > 0)
        .map(([, b, h]) => Math.log(h / b));
      return logs.length ? Math.exp(logs.reduce((t, x) => t + x, 0) / logs.length).toFixed(2) : '';
    };
    return [geo('base'), geo('head')];
  };
  md.push(
    table({
      columns: [
        'Moment',
        'Base',
        'Head',
        'Change',
        'Pairs (head/base)',
        'Base first',
        'Head first',
        'Verdict',
      ],
      align: ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'l'],
      rows: primary.map(({ p, r }) => {
        if (!r) return [p.moment, '', '', '', '', '', '', 'not measured'];
        const cells = line(r).slice(3);
        return [p.moment, ...cells.slice(0, 4), ...byOrder(r), cells[4]];
      }),
    }),
  );

  // The skill's speed rule, worked out here so nobody counts pairs by hand: a
  // primary row worse in every pair, or more than 3% worse at its median pair
  // (not the Change column, which is the pairs' geometric mean), is the
  // owner's to see, called or not
  const flagged = measured.flatMap(({ p, r }) => {
    const worse = r.v.ratios.map((x) => (r.better === 'higher' ? 1 / x : x));
    const mid = median(worse);
    const over = worse.filter((x) => x > 1).length;
    if (over < worse.length && mid <= 1.03) return [];
    return [`${p.moment}: median pair ×${mid.toFixed(3)}, ${over} of ${worse.length} pairs worse`];
  });
  md.push(
    flagged.length
      ? `**For "Needs from me"** (worse in every pair, or more than 3% worse at the median pair): ` +
          `${flagged.join('; ')}.`
      : 'No primary row is worse in every pair or more than 3% worse at its median pair.',
  );

  const others = rows.filter((r) => !PRIMARY.some((p) => keyOf(p) === keyOf(r)));
  const real = others.filter((r) => r.v?.real);
  const better = real.filter((r) => r.v.improved);
  md.push('## Diagnostics');
  md.push(
    `${others.length} other measurements compared: **${better.length} better, ` +
      `${real.length - better.length} worse**, ${others.length - real.length} unchanged within ` +
      `their noise. These show where the time goes, not whether a player waits less. When ` +
      `identical code was compared with itself, 1–5% of measurements were called by chance, so ` +
      `about ${Math.round(others.length * 0.01)}–${Math.round(others.length * 0.05)} of the calls ` +
      `here may be chance.`,
  );
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
    '*Base* and *Head* are the medians of each side’s runs. For rates (per second) higher is ' +
      'better; for everything else lower is better.',
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
  md.push('## The machine at each run');
  md.push(
    'As each run began: seconds since the run before it ended, the load average over a minute, ' +
      'the share of the last 10 s that tasks waited on the CPU and on I/O (Linux pressure), ' +
      'memory available, and the processes earlier runs left alive (Chromium, `vite preview`, ' +
      'uvicorn). For reading an order gap between the pairs (*Base first*, *Head first*).',
  );
  const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '');
  md.push(
    table({
      columns: [
        'Pair',
        'Side',
        'Gap (s)',
        'Load',
        'CPU wait %',
        'I/O wait %',
        'Memory (GiB)',
        'Left: Chromium / preview / uvicorn',
      ],
      align: ['r', 'l', 'r', 'r', 'r', 'r', 'r', 'r'],
      rows: machine.map((m) => [
        String(m.pair),
        m.side,
        f1(m.gap),
        m.load.toFixed(2),
        f1(m.cpu),
        f1(m.io),
        f1(m.memGiB),
        m.left,
      ]),
    }),
  );
  const report = resolve(option('--out', join(OUT_DIR, 'AB.md')));
  mkdirSync(dirname(report), { recursive: true });
  writeFileSync(report, md.join('\n\n') + '\n');
  log(
    `A/B report written to ${report}: primary rows ${measured.filter(({ r }) => r.v.real && r.v.improved).length} better, ` +
      `${measured.filter(({ r }) => r.v.real && !r.v.improved).length} worse`,
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

// The primary rows: the moments a player waits on (bench/primary.mjs)
{
  const now = flatten(results);
  const then = BASELINE
    ? flatten({
        client: {
          vitest: BASELINE.client,
          sidecars: { startup: BASELINE.startup },
        },
        server: { data: BASELINE.server },
        browser: { data: BASELINE.browser },
      })
    : null;
  const rows = PRIMARY.map((p) => {
    const m = now.get(keyOf(p));
    if (!m) return [p.moment, 'not measured', ''];
    const b = then?.get(keyOf(p));
    // The change only: the tables below judge it against each row's noise
    const vs = b ? compareMetric(m.value, b.value, m.better, Infinity)?.text : '';
    return [
      p.moment,
      shown(m.value, m.unit),
      `${p.tier} · ${p.where}`,
      ...(then ? [vs ?? ''] : []),
    ];
  });
  md.push('## Primary rows');
  md.push(
    'One number for each moment a player waits for, timed from the player’s action to what ' +
      'they see (`bench/primary.mjs`). Everything after them shows where the time goes. ' +
      '`--primary` runs only what these need.',
  );
  md.push(
    table({
      columns: ['Moment', 'Value', 'From', ...(then ? ['vs baseline'] : [])],
      align: ['l', 'r', 'l', 'r'],
      rows,
    }),
  );
}

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
    ['ai', 'The computer’s search (`client/src/ai`)'],
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
    'The browser tier draws WebGL in software (SwiftShader, on the CPU), far more slowly than a GPU ' +
      'would. Its times are useful compared with each other, not as what a device would show. A ' +
      'picture is *handed to the GPU* when the page’s render() call returns and *drawn by the GPU* ' +
      'when the GPU has finished it; the primary rows for moves and picking up a piece use the second.',
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
    '# everything, then read bench/out/RESULTS.md (raw JSON beside it)',
    'node bench/run.mjs',
    '',
    '# the primary rows only (the moments a player waits on): what to run while iterating',
    'node bench/run.mjs --primary --base main      # A/B against main, report in bench/out/AB.md',
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
