// Reads the Chrome traces the browser bench's cold-load section writes with
// BENCH_TRACE_COLD=<dir> (one per load left alone, until the live preview),
// and prints where each load's time went until the board showed: the
// requests (sent, first byte, done, from the cache or not), the main thread's
// work (scripts by file, parsing, style and layout, paint), the picture's
// decode, and the paints (first contentful, the largest's candidates).
//
//   node bench/loop/tools/cold-trace.mjs <dir> [--case phone-cpu4-4g] [--raw <browser.json>]
//
// --raw takes the bench's raw JSON (its coldPicture runs carry each trace's
// file and the bench's own stamps), to print the bench's board time beside each.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dir = args[0];
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const only = opt('--case');
const rawFile = opt('--raw');
const stamps = new Map();
if (rawFile) {
  const raw = JSON.parse(fs.readFileSync(rawFile, 'utf8'));
  const runs = Object.values(raw.raw?.coldPicture ?? raw.coldPicture ?? {}).flat();
  for (const r of runs) if (r.trace) stamps.set(path.basename(r.trace), r);
}

const files = fs
  .readdirSync(dir)
  .filter((f) => f.startsWith('cold-') && f.endsWith('.json'))
  .filter((f) => !only || f.startsWith(`cold-${only}-`))
  .sort();

const short = (url) => {
  try {
    const u = new URL(url);
    return u.pathname.replace(/-[\w-]{8}(\.\w+)$/, '$1');
  } catch {
    return String(url).slice(0, 40);
  }
};
const med = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN;
};
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(0).padStart(5) : '    -');

const summaries = [];
for (const file of files) {
  const { traceEvents: ev } = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  // The renderer's main thread: the one navigationStart for our page is on
  const nav = ev.find(
    (e) =>
      e.name === 'navigationStart' &&
      /^http:\/\/[^/]+\/$/.test(e.args?.data?.documentLoaderURL ?? ''),
  );
  if (!nav) {
    console.log(`${file}: no navigationStart`);
    continue;
  }
  const t0 = nav.ts;
  const ms = (ts) => (ts - t0) / 1000;
  const { pid, tid } = nav;
  const threadName = new Map(
    ev
      .filter((e) => e.ph === 'M' && e.name === 'thread_name')
      .map((e) => [`${e.pid}:${e.tid}`, e.args.name]),
  );
  // Requests
  const req = new Map();
  for (const e of ev) {
    const d = e.args?.data;
    if (!d?.requestId) continue;
    const r = req.get(d.requestId) ?? { id: d.requestId };
    if (e.name === 'ResourceSendRequest')
      Object.assign(r, { url: d.url, send: ms(e.ts), priority: d.priority });
    if (e.name === 'ResourceReceiveResponse')
      Object.assign(r, {
        response: ms(e.ts),
        status: d.statusCode,
        cache: d.fromCache || d.fromServiceWorker,
        mime: d.mimeType,
      });
    if (e.name === 'ResourceFinish')
      Object.assign(r, { finish: ms(e.ts), bytes: d.encodedDataLength });
    req.set(d.requestId, r);
  }
  const requests = [...req.values()]
    .filter((r) => r.url && r.send >= -5)
    .sort((a, b) => a.send - b.send);
  // Main-thread work
  const main = ev.filter((e) => e.pid === pid && e.tid === tid && e.ph === 'X');
  const tasks = main.filter((e) => e.name === 'RunTask');
  const named = (n) => main.filter((e) => e.name === n);
  const scripts = [
    ...named('EvaluateScript'),
    ...named('v8.evaluateModule'),
    ...named('FunctionCall'),
  ];
  const lcp = ev
    .filter((e) => e.name === 'largestContentfulPaint::Candidate')
    .map((e) => ({
      t: ms(e.ts),
      type: e.args?.data?.type,
      url: e.args?.data?.url,
      size: e.args?.data?.size,
    }));
  const fcp = ev.find((e) => e.name === 'firstContentfulPaint');
  const decodes = ev
    .filter(
      (e) => e.ph === 'X' && /^(Decode Image|ImageDecodeTask|Decode LazyPixelRef)$/.test(e.name),
    )
    .map((e) => ({
      t: ms(e.ts),
      dur: e.dur / 1000,
      thread: threadName.get(`${e.pid}:${e.tid}`) ?? '?',
    }));
  const paints = named('Paint').map((e) => ({ t: ms(e.ts), dur: e.dur / 1000 }));
  const stamp = stamps.get(file);
  const board = stamp?.picture ?? stamp?.board ?? lcp.find((c) => c.type === 'image')?.t ?? NaN;
  const before = (t) => tasks.filter((e) => ms(e.ts) < board && ms(e.ts) >= 0);
  const busy = before().reduce((s, e) => s + Math.min(e.dur / 1000, board - ms(e.ts)), 0);
  const sumIn = (list) =>
    list.filter((e) => ms(e.ts) >= 0 && ms(e.ts) < board).reduce((s, e) => s + e.dur / 1000, 0);
  const html = requests.find((r) => /\/$/.test(r.url));
  const pic = requests.filter((r) => r.url.includes('/landing/'));
  const css = requests.find((r) => /\.css$/.test(r.url));
  const entry = requests.find((r) => /\/assets\/index-[\w-]+\.js$/.test(r.url));
  const s = {
    file,
    board,
    html: html?.finish,
    htmlResp: html?.response,
    picSend: pic[0]?.send,
    picResp: pic[0]?.response,
    picDone: pic[0]?.finish,
    picStatus: pic.map((p) => `${short(p.url)}:${p.status}${p.cache ? '(cache)' : ''}`).join(' '),
    cssDone: css?.finish,
    entryDone: entry?.finish,
    fcp: fcp ? ms(fcp.ts) : NaN,
    lcpImage: lcp.find((c) => c.type === 'image')?.t,
    busy,
    script: sumIn(scripts),
    parse: sumIn(named('ParseHTML')),
    style: sumIn([
      ...named('UpdateLayoutTree'),
      ...named('Layout'),
      ...named('ParseAuthorStyleSheet'),
    ]),
    paint: sumIn(named('Paint')),
    decode: decodes.filter((d) => d.t < board).reduce((s2, d) => s2 + d.dur, 0),
    longest: Math.max(0, ...before().map((e) => e.dur / 1000)),
  };
  summaries.push(s);
  console.log(
    `\n## ${file}: board ${f1(board)} ms${stamp ? ' (the bench’s stamp)' : ' (LCP image)'}`,
  );
  console.log('requests (ms from navigation: sent / first byte / done, status, bytes):');
  for (const r of requests.filter((r) => r.send < board + 50))
    console.log(
      `  ${f1(r.send)} ${f1(r.response)} ${f1(r.finish)}  ${String(r.status ?? '').padEnd(3)} ${r.cache ? 'cache' : '     '} ${String(r.bytes ?? '').padStart(7)}  ${r.priority ?? ''} ${short(r.url)}`,
    );
  console.log('main-thread tasks over 8 ms before the board:');
  for (const e of before().filter((e) => e.dur > 8000)) {
    const inside = main
      .filter(
        (x) =>
          x !== e && x.ts >= e.ts && x.ts < e.ts + e.dur && x.dur > 2000 && x.name !== 'RunTask',
      )
      .slice(0, 4)
      .map(
        (x) =>
          `${x.name}${x.args?.data?.url ? ` ${short(x.args.data.url)}` : ''} ${(x.dur / 1000).toFixed(0)}`,
      );
    console.log(`  ${f1(ms(e.ts))} +${(e.dur / 1000).toFixed(0)} ms  ${inside.join(' · ')}`);
  }
  console.log(
    `decodes: ${decodes.map((d) => `${d.t.toFixed(0)}+${d.dur.toFixed(1)} (${d.thread})`).join(', ') || 'none'}`,
  );
  console.log(
    `paints: ${paints
      .filter((p) => p.t < board + 100)
      .map((p) => p.t.toFixed(0))
      .join(' ')}`,
  );
  console.log(
    `FCP ${f1(s.fcp)}  LCP candidates: ${lcp.map((c) => `${c.t.toFixed(0)} ${c.type}`).join(', ')}`,
  );
}

if (summaries.length > 1) {
  console.log(`\n## Medians over ${summaries.length} loads (ms from navigation)`);
  for (const k of [
    'htmlResp',
    'html',
    'cssDone',
    'picSend',
    'picResp',
    'picDone',
    'entryDone',
    'fcp',
    'lcpImage',
    'board',
    'busy',
    'script',
    'parse',
    'style',
    'paint',
    'decode',
    'longest',
  ])
    console.log(
      `  ${k.padEnd(10)} ${f1(med(summaries.map((s) => s[k])))}   (${summaries.map((s) => f1(s[k]).trim()).join(' ')})`,
    );
  console.log(`  pictures: ${[...new Set(summaries.map((s) => s.picStatus))].join(' | ')}`);
}
