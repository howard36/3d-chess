// Where the phone's start-page picture spends its time: one cold load at a time,
// phone 390x844 DPR 3, 4x CPU, Fast 4G, against a `vite preview` at BASE.
// node landing.mjs <base url> <runs>
import { chromium } from '/home/user/3d-chess-improve/client/node_modules/playwright/index.mjs';
const BASE = process.argv[2];
const RUNS = Number(process.argv[3] ?? 3);
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
for (let r = 0; r < RUNS; r++) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 165, downloadThroughput: (9e6 / 8) * 0.9, uploadThroughput: (750e3 / 8) * 0.9 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.addInitScript(() => {
    const t = (window.__p = { lt: [], lcp: [] });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => t.lt.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: 'longtask', buffered: true });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => t.lcp.push([Math.round(e.startTime), e.element?.tagName, e.url?.split('/').pop()]))).observe({ type: 'largest-contentful-paint', buffered: true });
    new MutationObserver(() => {
      const img = document.querySelector('[data-testid="landing-picture"] img');
      if (img && !t.inserted) {
        t.inserted = Math.round(performance.now());
        img.addEventListener('load', () => {
          t.loaded = Math.round(performance.now());
          img.decode().then(() => { t.decoded = Math.round(performance.now()); requestAnimationFrame(() => (t.raf = Math.round(performance.now()))); });
        });
      }
      if (!t.button && [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Play a friend')) t.button = Math.round(performance.now());
      if (!t.canvas && document.querySelector('[data-testid="landing-canvas"]')) t.canvas = Math.round(performance.now());
    }).observe(document, { subtree: true, childList: true });
  });
  await page.goto(BASE + '/', { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__p.raf, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const p = await page.evaluate(() => {
    const res = performance.getEntriesByType('resource').filter((e) => /landing|assets/.test(e.name)).map((e) => [e.name.split('/').pop().slice(0, 28), Math.round(e.startTime), Math.round(e.responseEnd), e.transferSize]);
    const nav = performance.getEntriesByType('navigation')[0];
    return { ...window.__p, res, dcl: Math.round(nav.domContentLoadedEventEnd) };
  });
  console.log(JSON.stringify({ button: p.button, inserted: p.inserted, loaded: p.loaded, decoded: p.decoded, raf: p.raf, canvas: p.canvas, dcl: p.dcl, lcp: p.lcp }));
  console.log('  res', JSON.stringify(p.res));
  console.log('  longtasks', JSON.stringify(p.lt.filter(([s]) => s < 2500)));
  await ctx.close();
}
await browser.close();
