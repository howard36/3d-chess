// How long each player takes over a move, in a Chromium worker as the game
// runs it (speed.ts), on this machine:
//   node speed.mjs hard hardFixed expert@40000 expert=40000 ...
// prints, per player, the median, 10th and 90th percentile and mean time a
// move, the median positions searched, the rate and the median depth. Set
// CHROMIUM to a Chromium to launch if Playwright's own isn't installed.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '../../client/package.json'));
const { build } = require('rolldown');
const { chromium } = require('playwright');

const players = process.argv.slice(2);
const { output } = await build({
  input: join(here, 'speed.ts'),
  platform: 'browser',
  output: { format: 'iife' },
  write: false,
});
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const page = await browser.newPage();
const rows = await page.evaluate(
  ([code, players]) =>
    new Promise((done) => {
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      const worker = new Worker(url);
      worker.onmessage = (e) => done(e.data);
      worker.postMessage(players);
    }),
  [output[0].code, players],
);
await browser.close();

const at = (xs, q) => [...xs].sort((a, b) => a - b)[Math.round(q * (xs.length - 1))];
const pad = (s, n) => String(s).padStart(n);
console.log(
  `${'player'.padEnd(16)}${pad('moves', 6)}${pad('median', 8)}${pad('p10', 6)}${pad('p90', 6)}${pad('mean', 6)} ms` +
    `${pad('positions', 11)}${pad('a second', 10)}${pad('depth', 6)}`,
);
for (const player of players) {
  const r = rows.filter((x) => x.player === player);
  const ms = r.map((x) => x.ms);
  const nodes = r.map((x) => x.nodes);
  const total = ms.reduce((s, x) => s + x, 0);
  const rate = nodes.reduce((s, x) => s + x, 0) / (total / 1000);
  console.log(
    `${player.padEnd(16)}${pad(r.length, 6)}${pad(at(ms, 0.5).toFixed(0), 8)}${pad(at(ms, 0.1).toFixed(0), 6)}` +
      `${pad(at(ms, 0.9).toFixed(0), 6)}${pad((total / r.length).toFixed(0), 6)}   ` +
      `${pad(at(nodes, 0.5), 11)}${pad((rate / 1e6).toFixed(2) + 'M', 10)}${pad(
        at(
          r.map((x) => x.depth),
          0.5,
        ),
        6,
      )}`,
  );
}
