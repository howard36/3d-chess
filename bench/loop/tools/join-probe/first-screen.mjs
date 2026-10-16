// Where a shared game's first screen goes (RG6): builds nothing itself;
// serve a build (vite preview on WEB) and a backend (WS) first. RUNS times,
// a fresh context each: a socket makes a game, the page opens its link, and a
// Chrome trace of the renderer's main thread is cut at the moment "Join game"
// enters the DOM (a MutationObserver, as the bench stamps it). Prints the
// median time to the button (COLD=1: a new browser per run, as the bench's
// first join is the browser's first page) and the median main-thread time per trace event
// before it (each event's own time, its children's taken out).
//   WEB=http://127.0.0.1:4173 WS=ws://127.0.0.1:8000/ws RUNS=10 node first-screen.mjs
import { chromium } from '@playwright/test';
const WEB = process.env.WEB;
const WS = process.env.WS;
const RUNS = Number(process.env.RUNS ?? 10);
const launch = () =>
  chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
    ],
  });
const COLD = process.env.COLD === '1';
let browser = await launch();
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : 0;
};
const perRun = [];
const joins = [];
for (let run = 0; run < RUNS; run++) {
  if (COLD && run > 0) {
    await browser.close();
    browser = await launch();
  }
  if (process.env.PRIME) {
    const c = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pg = await c.newPage();
    await pg.goto(`${WEB}/new`);
    await pg.waitForTimeout(4000);
    await c.close();
  }
  const sock = new WebSocket(WS);
  await new Promise((r) => (sock.onopen = r));
  const created = new Promise(
    (r) =>
      (sock.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.type === 'game_created') r(m);
      }),
  );
  sock.send(
    JSON.stringify({ type: 'create_game', clientId: `probe-${Date.now()}`, color: 'white' }),
  );
  const { gameId } = await created;
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (window.__join) return;
      for (const b of document.querySelectorAll('button'))
        if (b.textContent.trim() === 'Join game') {
          window.__join = performance.now();
          performance.mark('join-shown');
        }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await browser.startTracing(page, {
    categories: [
      'devtools.timeline',
      'disabled-by-default-devtools.timeline',
      'blink.user_timing',
      'v8.execute',
      'loading',
    ],
  });
  await page.goto(`${WEB}/game/${gameId}`);
  await page.waitForFunction(() => window.__join);
  const join = await page.evaluate(() => window.__join);
  const trace = JSON.parse((await browser.stopTracing()).toString());
  await ctx.close();
  sock.close();
  joins.push(join);
  const events = trace.traceEvents ?? trace;
  const mark = events.find((e) => e.name === 'join-shown');
  const nav = events.find((e) => e.name === 'navigationStart' && e.args?.data?.isLoadingMainFrame);
  // The renderer's main thread: the one the mark is on
  const main = events.filter(
    (e) => e.pid === mark.pid && e.tid === mark.tid && e.ph === 'X' && e.dur !== undefined,
  );
  const start = nav?.ts ?? Math.min(...main.map((e) => e.ts));
  const inWindow = main
    .filter((e) => e.ts >= start && e.ts + e.dur <= mark.ts)
    .sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  // Self time: each event's duration less its direct children's
  const self = new Map();
  const stack = [];
  for (const e of inWindow) {
    while (stack.length && stack.at(-1).ts + stack.at(-1).dur <= e.ts) stack.pop();
    const parent = stack.at(-1);
    if (parent) self.set(parent, (self.get(parent) ?? parent.dur) - e.dur);
    self.set(e, e.dur);
    stack.push(e);
  }
  if (process.env.TASKS)
    console.log(
      `run ${run} join ${join.toFixed(0)}: ` +
        inWindow
          .filter((e) => e.name === 'RunTask' && e.dur > 15000)
          .map((e) => {
            const kids = inWindow
              .filter(
                (k) => k !== e && k.ts >= e.ts && k.ts + k.dur <= e.ts + e.dur && k.dur > 3000,
              )
              .slice(0, 6)
              .map(
                (k) =>
                  `${k.name}${k.args?.data?.url ? '(' + k.args.data.url.split('/').pop() + ')' : k.args?.data?.functionName ? '(' + k.args.data.functionName + ')' : ''}:${(k.dur / 1000).toFixed(0)}`,
              );
            return `[${((e.ts - start) / 1000).toFixed(0)}+${(e.dur / 1000).toFixed(0)} ${kids.join(' ')}]`;
          })
          .join(' '),
    );
  const byName = {};
  for (const [e, t] of self) byName[e.name] = (byName[e.name] ?? 0) + t / 1000;
  byName['(wall to join)'] = (mark.ts - start) / 1000;
  perRun.push(byName);
}
await browser.close();
const names = [...new Set(perRun.flatMap((r) => Object.keys(r)))];
const rows = names
  .map((n) => [n, median(perRun.map((r) => r[n] ?? 0))])
  .filter(([, t]) => t >= 0.3)
  .sort((a, b) => b[1] - a[1]);
console.log(
  `join button (performance.now): median ${median(joins).toFixed(1)} ms of ${RUNS}: ${joins.map((j) => j.toFixed(0)).join(' ')}`,
);
for (const [n, t] of rows) console.log(`${t.toFixed(1).padStart(8)} ms  ${n}`);
