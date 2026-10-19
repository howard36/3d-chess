import { test, expect } from '@playwright/test';
import { GLYPHS, INK } from '../src/screens/glyphs';

// Each silhouette's ink as INK gives it (the move record's icon is cut to
// it) is the ink the browser measures of GLYPHS: a redrawn piece fails here,
// not as a crooked icon in the record.
test('each piece’s ink is where its silhouette’s outline is', async ({ page }) => {
  await page.setContent('<svg viewBox="0 0 24 24" width="240" height="240"></svg>');
  const boxes = await page.evaluate((glyphs) => {
    const svg = document.querySelector('svg')!;
    return Object.fromEntries(
      Object.entries(glyphs).map(([type, d]) => {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        svg.appendChild(path);
        const { x, y, width, height } = path.getBBox();
        return [type, [x, y, x + width, y + height]];
      }),
    );
  }, GLYPHS);
  // (to a hundredth: the knight's curve measures 6.095 on the left)
  for (const [type, [left, top, right]] of Object.entries(INK)) {
    const [x0, y0, x1, y1] = boxes[type];
    const off = [x0 - left, y0 - top, x1 - right, y1 - 21].map((d) => +d.toFixed(3));
    expect([type, off.every((d) => Math.abs(d) <= 0.01) || off]).toEqual([type, true]);
  }
});
