// A match between two players over this machine's cores, then its score:
// node run.mjs <A> <B> <games> <seed> [workers] > tag.jsonl ; summary on stderr
// (MATCH=other.mjs: another build of match.ts, say while one is still playing)
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [a, b, games, seed, w] = process.argv.slice(2);
const workers = Number(w ?? cpus().length);
const here = dirname(fileURLToPath(import.meta.url));
const rows = [];
await Promise.all(
  Array.from(
    { length: workers },
    (_, i) =>
      new Promise((done) => {
        const p = spawn('node', [
          join(here, process.env.MATCH ?? 'match.mjs'),
          a,
          b,
          games,
          i,
          workers,
          seed,
        ]);
        let buf = '';
        p.stdout.on('data', (d) => {
          buf += d;
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (!line.trim()) continue;
            process.stdout.write(line + '\n');
            rows.push(JSON.parse(line));
          }
        });
        p.stderr.pipe(process.stderr);
        p.on('close', done);
      }),
  ),
);
const n = rows.length;
const mean = rows.reduce((s, r) => s + r.aScore, 0) / n;
const sd = Math.sqrt(rows.reduce((s, r) => s + (r.aScore - mean) ** 2, 0) / (n - 1));
const se = sd / Math.sqrt(n);
const elo = (p) => -400 * Math.log10(1 / p - 1);
const reasons = {};
for (const r of rows) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
const count = (score) => rows.filter((r) => r.aScore === score).length;
const per = (who) => {
  let ms = 0;
  let nodes = 0;
  let moves = 0;
  for (const r of rows) {
    const k = who === 'a' ? 0 : 1; // stats are A's, then B's
    ms += r.stats[k].ms;
    nodes += r.stats[k].nodes;
    moves += r.stats[k].moves;
  }
  return `${(ms / moves).toFixed(0)} ms, ${(nodes / moves).toFixed(0)} positions a move`;
};
console.error(
  `${a} vs ${b}: ${(100 * mean).toFixed(1)}% ± ${(100 * se).toFixed(1)}% (${elo(mean).toFixed(0)} Elo) over ${n} games, +${count(1)} =${count(0.5)} -${count(0)} ${JSON.stringify(reasons)}; ${a}: ${per('a')}; ${b}: ${per('b')}`,
);
