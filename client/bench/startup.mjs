// Page-load benchmark: serves two builds (gzip, like the CDN) and times, in
// Chromium with a throttled network and CPU, how long a page takes to show
// its first screen, alternating the builds run by run.
//   node bench/startup.mjs --a <dist> --b <dist> [--runs 7] [--rtt 150] [--kbps 1600] [--cpu 4]
// Build both with VITE_WS_URL pointing nowhere (ws://127.0.0.1:9/ws), so a game
// page never reaches a real backend.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const dists = { a: arg('a'), b: arg('b') };
const runs = Number(arg('runs', '7'));
const rtt = Number(arg('rtt', '150'));
const kbps = Number(arg('kbps', '1600'));
const cpu = Number(arg('cpu', '4'));
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
};

const serve = (root) =>
  new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
      let file = join(root, path);
      if (!extname(path)) file = join(root, 'index.html'); // the app's routes
      try {
        let body = await readFile(file);
        const type = TYPES[extname(file)] ?? 'application/octet-stream';
        const headers = { 'content-type': type };
        if (/text|javascript|svg/.test(type)) {
          body = gzipSync(body);
          headers['content-encoding'] = 'gzip';
        }
        res.writeHead(200, headers).end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });

const servers = { a: await serve(dists.a), b: await serve(dists.b) };
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});

const measure = async (which, path, selector) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: rtt,
    downloadThroughput: (kbps * 1024) / 8,
    uploadThroughput: (kbps * 1024) / 8,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  const port = servers[which].address().port;
  await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: 'commit' });
  await page.waitForSelector(selector, { state: 'visible', timeout: 120000 });
  const ms = await page.evaluate(() => performance.now());
  const bytes = await page.evaluate(() =>
    performance.getEntriesByType('resource').reduce((n, e) => n + (e.transferSize || 0), 0),
  );
  await context.close();
  return { ms, bytes };
};

const pages = [
  ['start', '/', 'text=Start New Game'],
  ['game', '/game/BENCH1', '#root > *'],
];
const results = {};
for (let r = 0; r < runs; r++) {
  for (const which of r % 2 ? ['b', 'a'] : ['a', 'b']) {
    for (const [name, path, selector] of pages) {
      const { ms, bytes } = await measure(which, path, selector);
      (results[`${name}.${which}`] ??= { ms: [], bytes: [] }).ms.push(ms);
      results[`${name}.${which}`].bytes.push(bytes);
    }
  }
}
await browser.close();
for (const s of Object.values(servers)) s.close();
const median = (xs) => [...xs].sort((p, q) => p - q)[Math.floor(xs.length / 2)];
const out = {};
for (const [k, { ms, bytes }] of Object.entries(results)) {
  out[k] = {
    median: +median(ms).toFixed(0),
    min: +Math.min(...ms).toFixed(0),
    max: +Math.max(...ms).toFixed(0),
    bytes: median(bytes),
  };
}
console.log(
  JSON.stringify({ bench: 'startup', rtt, kbps, cpu, runs, a: dists.a, b: dists.b, results: out }),
);
