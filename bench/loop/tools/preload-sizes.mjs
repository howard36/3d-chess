// Usage: node bench/loop/tools/preload-sizes.mjs client/dist (after a build of the commit to measure).
// Per address: the files the built page links (its own tags plus what its inline scripts add), gzip -9.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
const dist = process.argv[2];
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const gz = (b) => gzipSync(b, { level: 9 }).length;
const own = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1])
  .filter((s) => s.includes('modulepreload'));
for (const path of ['/new', '/game/abc', '/computer', '/computer/abc', '/learn']) {
  const linked = [];
  const document = { createElement: () => ({}), head: { appendChild: (l) => linked.push(l) } };
  for (const s of scripts) new Function('location', 'document', s)({ pathname: path }, document);
  const files = [...new Set([...own, ...linked.map((l) => l.href.replace(/^\//, ''))])];
  const kb = files.reduce((t, f) => t + gz(readFileSync(join(dist, f))), 0) / 1000;
  const low = linked.filter((l) => l.fetchPriority === 'low').length;
  console.log(`${path}\t${files.length} files (${low} low)\t${kb.toFixed(1)} KB`);
}
console.log(`index.html\t${gz(Buffer.from(html))} B gzipped`);
