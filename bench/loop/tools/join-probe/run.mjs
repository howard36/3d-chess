// Where the joiner's long tasks go: builds nothing itself; serve a build
// (vite preview on WEB) and a backend (WS) first. Opens a game a socket made,
// clicks "Join game", CPU-profiles the page from the click for MS ms, and prints
// the long tasks with the functions taking most of each one's samples.
//   WEB=http://127.0.0.1:4173 WS=ws://127.0.0.1:8000/ws node run.mjs [ms]
import { chromium } from '@playwright/test';
const WEB = process.env.WEB, WS = process.env.WS;
const MS = Number(process.argv[2] ?? 6000);
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const sock = new WebSocket(WS);
await new Promise((r) => (sock.onopen = r));
const created = new Promise((r) => (sock.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === 'game_created') r(m); }));
sock.send(JSON.stringify({ type: 'create_game', clientId: `probe-${Date.now()}`, color: 'white' }));
const { gameId } = await created;
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
await page.addInitScript(() => {
  window.__lt = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
});
await page.goto(`${WEB}/game/${gameId}`);
const join = page.getByRole('button', { name: /^Join game\b/i });
await join.waitFor();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
await cdp.send('Profiler.start');
const t0 = await page.evaluate(() => performance.now());
await join.click();
await page.waitForTimeout(MS);
const { profile } = await cdp.send('Profiler.stop');
const lt = await page.evaluate(() => window.__lt);
// Sample times (µs since profile start) → page ms via the profile's startTime ≈ t0
const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const label = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`;
let t = 0;
const samples = profile.samples.map((id, i) => { t += profile.timeDeltas[i]; return [t / 1000, id]; });
const start = samples[0][0];
for (const [s, d] of lt.filter(([s]) => s >= t0 - 50)) {
  const from = s - t0, to = from + d;
  const self = new Map(), incl = new Map();
  for (const [ts, id] of samples) {
    const at = ts - start;
    if (at < from || at > to) continue;
    const n = nodes.get(id);
    self.set(label(n), (self.get(label(n)) ?? 0) + 1);
    const seen = new Set();
    for (let k = id; k !== undefined; k = parent.get(k)) { const l = label(nodes.get(k)); if (!seen.has(l)) { seen.add(l); incl.set(l, (incl.get(l) ?? 0) + 1); } }
  }
  const total = [...self.values()].reduce((a, b) => a + b, 0) || 1;
  const top = (m, k) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).map(([l, c]) => `${Math.round((c / total) * 100)}% ${l}`);
  console.log(`\n== long task at +${Math.round(from)} ms, ${Math.round(d)} ms (${total} samples)`);
  console.log(' self:', top(self, 8).join('\n       '));
  console.log(' incl:', top(incl, 25).filter((l) => !/\(root\)|\(program\)/.test(l)).join('\n       '));
}
await browser.close();
sock.close();
