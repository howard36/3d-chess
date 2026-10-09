// Summarises aiPass.ts's output: search time per move and depth, base vs head.
const rows = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
const by = { base: [], head: [] };
for (const r of rows) by[r.side].push(r);
const med = (a) => {
  a = [...a].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
for (const s of ['base', 'head']) {
  const ms = by[s].map((r) => r.ms);
  console.log(
    s,
    'n', ms.length,
    'median ms', med(ms).toFixed(0),
    'mean', (ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(0),
    'max', Math.max(...ms).toFixed(0),
    'depth median', med(by[s].map((r) => r.depth)),
    '>1500 ms', ms.filter((x) => x > 1500).length,
  );
}
let same = 0, deeper = 0, shallower = 0;
for (let i = 0; i < by.base.length; i++) {
  const b = by.base[i], h = by.head[i];
  if (b.move === h.move) same++;
  if (h.depth > b.depth) deeper++;
  if (h.depth < b.depth) shallower++;
}
console.log('same move', same, 'of', by.base.length, 'head deeper', deeper, 'shallower', shallower);
console.log(by.base.map((b, i) => `${Math.round(b.ms)}/${Math.round(by.head[i].ms)} d${b.depth}/${by.head[i].depth}`).join(' | '));
