// Probe: the app with WebGL off (Chromium --disable-webgl --disable-3d-apis) and
// the first paint with scripts blocked, against a served build:
//   node bench/loop/tools/nowebgl.mjs <url> <tag>   (screenshots to /tmp/claude-0/shots)
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../../../client/package.json', import.meta.url))(
  '@playwright/test',
);
const [url, tag] = process.argv.slice(2);
const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const out = {};
{
  const b = await chromium.launch({ executablePath: exe, args: ['--disable-webgl', '--disable-3d-apis', '--no-sandbox'] });
  const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push('console: ' + m.text().slice(0, 120)));
  for (const path of ['/', '/learn', '/computer']) {
    await p.goto(url + path); await p.waitForTimeout(4000);
    out[path] = { text: (await p.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 160) };
    await p.screenshot({ path: `/tmp/claude-0/shots/nowebgl-${tag}${path.replace(/\//g, '_')}.png` });
  }
  // A game against the computer, from its side choice: the page, then a move typed
  await p.goto(url + '/computer');
  await p.getByRole('button', { name: /^White/ }).click();
  await p.getByRole('group', { name: 'Difficulty' }).getByRole('button', { name: 'Easy' }).click();
  await p.waitForURL(/\/computer\/./, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(5000);
  out.game = { url: p.url(), text: (await p.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 220) };
  const box = p.locator('#typed-move');
  if (await box.count()) {
    await box.fill('Bb1-Cb1'); await box.press('Enter'); await p.waitForTimeout(4000);
    out.game.afterMove = await p.getByTestId('move-announcer').getAttribute('data-move-count').catch(() => null);
  }
  await p.screenshot({ path: `/tmp/claude-0/shots/nowebgl-${tag}-game.png` });
  out.errors = errs.filter((e) => !e.includes('WebSocket')).slice(0, 6);
  await b.close();
}
{
  const b = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.route('**/*.js', (r) => r.abort());
  await p.goto(url + '/');
  out.bodyBgBeforeJs = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await p.screenshot({ path: `/tmp/claude-0/shots/nojs-${tag}.png` });
  await b.close();
}
console.log(JSON.stringify(out, null, 1));
