// Probe: shader programs linked, and the long tasks (ms), per tutorial step
// (each step makes the board again); START=1 also counts the start page's
// links over 90 s. Needs a built client served (vite preview).
//   node bench/loop/tools/learnlinks.mjs <baseUrl>
import { createRequire } from 'node:module';
// (Playwright from the client's packages)
const { chromium } = createRequire(new URL('../../../client/package.json', import.meta.url))(
  '@playwright/test',
);
const base = process.argv[2] ?? 'http://localhost:5173';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const init = () => {
  const w = window;
  w.__links = [];
  w.__lt = [];
  new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__lt.push([e.startTime, e.duration]))).observe({ type: 'longtask', buffered: true });
  const link = WebGL2RenderingContext.prototype.linkProgram;
  WebGL2RenderingContext.prototype.linkProgram = function (p) {
    const src = (this.getAttachedShaders(p) ?? []).map((s) => this.getShaderSource(s) ?? '').join('\n');
    w.__links.push([performance.now(), src.slice(src.lastIndexOf('void main')).replace(/\s+/g, ' ').slice(0, 60)]);
    return link.call(this, p);
  };
};
const out = {};
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(init);
  await page.goto(`${base}/learn`);
  await page.getByTestId('learn-canvas').waitFor();
  await page.waitForTimeout(8000);
  const steps = [];
  let n = (await page.evaluate(() => window.__links.length));
  steps.push(['Setup', n]);
  for (let i = 0; i < 8; i++) {
    const next = page.getByRole('button', { name: /^Next/ });
    const name = await next.textContent();
    const t = await page.evaluate(() => performance.now());
    await next.click();
    await page.waitForTimeout(4000);
    const ls = await page.evaluate(() => window.__links);
    const lt = await page.evaluate((t) => window.__lt.filter((e) => e[0] >= t - 5).map((e) => Math.round(e[1])), t);
    steps.push([name, ls.length - n, lt]);
    n = ls.length;
  }
  out.learn = steps;
  await page.close();
}
if (process.env.START) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(init);
  await page.goto(`${base}/`);
  await page.waitForTimeout(90000);
  out.start = await page.evaluate(() => window.__links.map((l) => [Math.round(l[0]), l[1]]));
  await page.close();
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
