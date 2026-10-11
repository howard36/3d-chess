import { chromium } from '/home/user/3d-chess-improve/client/node_modules/playwright/index.mjs';
const [port, label] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto(`http://127.0.0.1:${port}/probe-landing.html?n=${process.env.N ?? 2000}`);
await p.waitForSelector(`[data-ply="${process.env.N ?? 2000}"]`);
await p.waitForTimeout(1500);
const out = [];
for (let i = 0; i < 40; i++) { out.push(await p.evaluate(() => window.__land())); await p.waitForTimeout(50); }
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
console.log(label, 'commit ms', med(out.map((o) => o[0])).toFixed(2), 'layout ms', med(out.map((o) => o[1])).toFixed(2));
await b.close();
