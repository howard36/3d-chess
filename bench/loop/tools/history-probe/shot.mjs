import { chromium } from '/home/user/3d-chess-improve/client/node_modules/playwright/index.mjs';
const [port, out] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
const res = [];
for (const [w, h] of (process.env.SIZES ? JSON.parse(process.env.SIZES) : [[640, 360], [844, 390], [390, 844]])) {
  for (const shown of [40, 20]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    await p.goto(`http://127.0.0.1:${port}/probe-history.html?shown=${shown}`);
    await p.waitForSelector('[data-testid="move-history"]');
    const r = await p.evaluate(() => {
      const nav = document.querySelector('[data-testid="move-history"]').getBoundingClientRect();
      const steps = [...document.querySelectorAll('.hud-steps > *')].map((e) => e.getBoundingClientRect()).filter((r) => r.width);
      const right = Math.max(...steps.map((s) => s.right));
      return { nav: [Math.round(nav.left), Math.round(nav.right)], stepsRight: Math.round(right), win: innerWidth, widths: steps.map((s) => Math.round(s.width)) };
    });
    res.push({ w, h, shown, ...r });
    await p.screenshot({ path: `${out}/history-${w}x${h}-${shown === 40 ? 'live' : 'review'}.png` });
    await ctx.close();
  }
}
console.log(JSON.stringify(res, null, 1));
await b.close();
