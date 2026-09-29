#!/usr/bin/env node
// Runs the benchmark suite and writes its report as Markdown.
//
//   node bench/run.mjs [--quick] [--only client,server,browser] [--out bench/RESULTS.md]
//
// Three tiers, run one after another so none times the others' load:
//
//   client   the rules engine, the event-sourced game state, the board's
//            pointer/frame math (vitest bench, client/bench/*.bench.ts) and
//            the piece geometry's startup cost (client/bench/startup.ts)
//   server   the WebSocket relay, in process and over real sockets
//            (server/bench/bench_server.py)
//   browser  the production build in headless Chromium, end to end
//            (client/scripts/bench-browser.mjs; needs Chromium, see the README)
//
// Needs client/node_modules (npm ci) and the server's test extra
// (uv sync --extra test in server/). Raw JSON goes to bench/out/ (ignored by
// git); the report is the only file meant to be committed. --quick takes a
// few samples of everything, to check the suite runs, not to measure.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function runClient() {
  const meta = join(OUT_DIR, 'client-meta');
  rmSync(meta, { recursive: true, force: true });
  const env = { BENCH_META_DIR: meta, ...(QUICK ? { BENCH_QUICK: '1' } : {}) };
  const vitestJson = join(OUT_DIR, 'client-vitest.json');
  const benches = run(
    'client benches',
    'npx',
    ['vitest', 'bench', '--run', '--config', 'vitest.bench.config.ts', '--outputJson', vitestJson],
    { cwd: CLIENT, env },
  );
  const startup = run('client startup', 'npx', ['vite-node', 'bench/startup.ts'], {
    cwd: CLIENT,
    env,
  });
  return {
    ok: benches.ok && startup.ok,
    seconds: benches.seconds + startup.seconds,
    tail: [benches, startup]
      .filter((r) => !r.ok)
      .map((r) => r.tail)
      .join('\n'),
    vitest: readJson(vitestJson),
    sidecars: Object.fromEntries(
      ['engine', 'game', 'interaction', 'startup'].map((k) => [
        k,
        readJson(join(meta, `${k}.json`)),
      ]),
    ),
  };
}

function runServer() {
  const out = join(OUT_DIR, 'server.json');
  rmSync(out, { force: true });
  const res = run(
    'server',
    'uv',
    [
      'run',
      '--project',
      'server',
      'python',
      'server/bench/bench_server.py',
      '--out',
      out,
      ...(QUICK ? ['--quick'] : []),
    ],
    { cwd: ROOT },
  );
  return { ...res, data: readJson(out) };
}

function runBrowser() {
  const out = join(OUT_DIR, 'browser.json');
  rmSync(out, { force: true });
  const res = run(
    'browser',
    'node',
    ['scripts/bench-browser.mjs', '--out', out, ...(QUICK ? ['--quick'] : [])],
    { cwd: CLIENT },
  );
  return { ...res, data: readJson(out) };
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

function benchSection(g, intro, workload) {
  const rows = g.benchmarks.map((b) => [
    b.name,
    duration(b.median),
    `${duration(b.mean)} ±${b.rme.toFixed(1)}%`,
    duration(b.p99),
    rate(b.hz),
    String(b.sampleCount),
  ]);
  const parts = [
    section(4, {
      title: g.group,
      intro: intro ?? '',
      columns: ['Case', 'Median', 'Mean ± RME', 'p99', 'Throughput', 'Samples'],
      align: ['l', 'r', 'r', 'r', 'r', 'r'],
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
  const wholeM = b('G4', 'marathon');
  if (whole && wholeM) {
    out.push(
      `**Over a whole game, each client spends ${duration(whole.median)} of main-thread time ` +
        `replaying a 100-ply game played live** (one full replay plus one end-of-game test per move). ` +
        `The replay part grows quadratically with the game: 400 plies of the marathon cost ` +
        `${duration(wholeM.median)}.`,
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

// --- Main ----------------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });
const started = new Date();
const env = environment();
const results = {};
if (ONLY.includes('client')) results.client = runClient();
if (ONLY.includes('server')) results.server = runServer();
if (ONLY.includes('browser')) results.browser = runBrowser();
const finished = new Date();

const md = [];
md.push('# Benchmark results');
md.push(
  `Generated by \`node bench/run.mjs${QUICK ? ' --quick' : ''}\` on ${started.toISOString().slice(0, 16).replace('T', ' ')} UTC ` +
    `(${Math.round((finished - started) / 60000)} min). ${QUICK ? '**Quick mode: a smoke run with too few samples to compare.** ' : ''}` +
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
  for (const [key, title] of parts) {
    const sc = sidecars[key] ?? {};
    md.push(`### ${title}`);
    for (const t of sc.tables ?? []) md.push(section(4, t));
    for (const g of groups.filter((x) => x.file.endsWith(`${key}.bench.ts`))) {
      md.push(benchSection(g, sc.intros?.[g.group], sc.workloads?.[g.group]));
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
  for (const t of sidecars.startup?.tables ?? []) md.push(section(4, t));
}

for (const [tier, name] of [
  ['server', 'Server'],
  ['browser', 'Browser'],
]) {
  const r = results[tier];
  if (!r) continue;
  md.push(`## ${r.data?.title ?? name}`);
  if (!r.ok || !r.data) md.push(failed(tier, r));
  for (const s of r.data?.sections ?? []) md.push(section(3, s));
}

md.push('## Method');
md.push(
  [
    'Each tier runs alone, one after another, on an otherwise idle machine; the numbers are only ' +
      'comparable between runs on the same machine. A shared cloud VM like the one above is noisy: ' +
      'read the median, and treat differences under ~10% (or inside the RME) as noise.',
    'Client microbenchmarks: tinybench via `vitest bench` in Node (no jsdom), each case warmed up ' +
      'then sampled for at least 0.5 s (heavy cases: a fixed number of iterations). *Median* and *p99* ' +
      'are per call; *Mean ± RME* is the mean with its relative margin of error at 95%; *Throughput* is ' +
      'calls per second. Results are kept alive in a module-level sink so the JIT cannot skip the work.',
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
    '# a tier on its own',
    'cd client && npx vitest bench --config vitest.bench.config.ts   # engine, game, interaction',
    'cd client && npx vite-node bench/startup.ts                     # piece geometry startup',
    'uv run --project server python server/bench/bench_server.py --out /tmp/server.json',
    'cd client && node scripts/bench-browser.mjs --out /tmp/browser.json',
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
