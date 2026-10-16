// Focus-ring probe: renders ten focusable controls under two pairs of stylesheets
// (old index.css + learn.css, new index.css + learn.css) in Chromium and prints
// each control's outline, box-shadow, background and colour when focused from
// the keyboard and when focused quietly (data-quiet-focus, CLAUDE.md "Gotchas").
// Run 20261016-1159 used it for 22697da:
//   git show 22697da^:client/src/index.css > oi.css; git show 22697da^:client/src/screens/learn/learn.css > ol.css
//   (the same at HEAD into ni.css, nl.css), then from client/:
//   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=... node ../bench/loop/tools/ring-probe.mjs oi.css ol.css ni.css nl.css
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../client/package.json', import.meta.url));
const { chromium } = require('playwright');
const [oi, ol, ni, nl] = process.argv
  .slice(2)
  .map((f) => readFileSync(f, 'utf8').replace(/@import 'tailwindcss';/, ''));
const body = `<button class="button-link" id="t0">Link</button><button class="button-icon" id="t1">?</button>
<ol><li><button class="hud-ply" id="t2"><span class="hud-ply-word">e4</span></button></li></ol>
<button class="hud-step" id="t3">‹</button><button class="hud-now" id="t4">now</button><button class="hud-go" id="t5">Go</button>
<div class="hud-offer"><button class="hud-menu-item" data-accept id="t6">Accept</button></div>
<button class="landing-mode" id="t7">Play</button><button class="learn-tab" id="t8">Rook</button><div class="learn-steps"><button class="learn-step" id="t9"></button></div>`;
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
const read = async (css, quiet) => {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><style>${css}</style><body>${body}</body>`);
  await page.keyboard.press('Shift');
  await page.keyboard.press('Tab');
  const out = [];
  for (let i = 0; i < 10; i++) {
    out.push(
      await page.evaluate(
        ([i, quiet]) => {
          const el = document.getElementById(`t${i}`);
          if (quiet) el.setAttribute('data-quiet-focus', '');
          else el.removeAttribute('data-quiet-focus');
          el.focus();
          const s = (e) => {
            const c = getComputedStyle(e);
            return `${c.outlineStyle} ${c.outlineWidth} | ${c.boxShadow} | ${c.backgroundColor} | ${c.color}`;
          };
          return `${el.className}${el.matches(':focus-visible') ? ' fv' : ''}: ${s(el)}${el.firstElementChild ? ' || word ' + s(el.firstElementChild) : ''}`;
        },
        [i, quiet],
      ),
    );
  }
  await page.close();
  return out;
};
const [o, n, oq, nq] = [
  await read(oi + ol, false),
  await read(ni + nl, false),
  await read(oi + ol, true),
  await read(ni + nl, true),
];
let same = 0;
o.forEach((l, i) => (l === n[i] ? same++ : console.log('DIFF keyboard\n ', l, '\n ', n[i])));
console.log(`keyboard focus: ${same} of ${o.length} the same`);
oq.forEach((l, i) => console.log(`quiet old: ${l}\nquiet new: ${nq[i]}\n`));
await browser.close();
