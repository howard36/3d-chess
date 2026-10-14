import { afterEach, expect, test, vi } from 'vitest';
import { LANDING_BANDS, landingLayoutOf, preloadLandingPicture } from './landingLayout';
import { pictureSourceSet } from '../three/landingLens';

const bands = (w: number, h: number) => ({
  top: LANDING_BANDS.top(h, w),
  bottom: LANDING_BANDS.bottom(h, w),
  left: LANDING_BANDS.left(w, h),
});

test('beside the tower in a wide window: the gutter, the column and a gap', () => {
  // 1440: gutter 86.4, column 30vw = 432
  expect(bands(1440, 900)).toEqual({ top: 24, bottom: 24, left: 86.4 + 432 + 16 });
  // The column's floor (340) in a small laptop, a phone on its side's (300) when short
  expect(bands(1024, 768).left).toBeCloseTo(61.44 + 340 + 16);
  expect(bands(667, 375).left).toBeCloseTo(40.02 + 300 + 16);
});

test('an upright phone: the title above the tower, the tiles under it', () => {
  const { top, bottom, left } = bands(390, 844);
  expect(left).toBe(0);
  expect(top).toBeCloseTo(24 + 2 * 0.92 * 64 + 16);
  expect(bottom).toBe(24 + 16 + 116 + 14 + 44);
});

test('an upright tablet: title and tiles in one band along the bottom', () => {
  const { top, bottom, left } = bands(834, 1112);
  expect([top, left]).toEqual([24, 0]);
  // The taller of the title (11vw a line, with its rule) and the tiles
  const title = 2 * 0.92 * 0.11 * 834 + 22;
  expect(bottom).toBeCloseTo(0.06 * 834 + 16 + Math.max(title, 132 + 14 + 44));
});

test('three layouts: a phone and a tablet upright, and anything wider than tall', () => {
  expect(landingLayoutOf(390, 844)).toBe('phone');
  expect(landingLayoutOf(599, 900)).toBe('phone');
  expect(landingLayoutOf(600, 900)).toBe('tablet');
  expect(landingLayoutOf(1000, 1000)).toBe('tablet');
  expect(landingLayoutOf(1001, 1000)).toBe('wide');
  expect(landingLayoutOf(844, 390)).toBe('wide');
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.querySelectorAll('link[rel="preload"]').forEach((l) => l.remove());
});

/** preloadLandingPicture as the built page runs it: from its source alone, in a window this size at `path`. */
const preloadFromSource = (width: number, height: number, path = '/') => {
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('innerHeight', height);
  vi.stubGlobal('location', { pathname: path });
  new Function(`(${preloadLandingPicture.toString()})()`)();
  return [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"]')];
};

test('the start page preloads the picture of its layout, from the function’s source alone', () => {
  for (let w = 300; w <= 2000; w += 37) {
    for (const h of [w - 1, w, w + 1, Math.round(w * 0.6), Math.round(w * 2.1)]) {
      const links = preloadFromSource(w, h);
      expect(links).toHaveLength(1);
      expect(links[0].getAttribute('href')).toBe(`/landing/${landingLayoutOf(w, h)}.avif`);
      expect(links[0].getAttribute('as')).toBe('image');
      expect(links[0].getAttribute('type')).toBe('image/avif');
      // The same choice as the page's picture makes
      expect(links[0].getAttribute('imagesrcset')).toBe(
        pictureSourceSet(landingLayoutOf(w, h), 'avif'),
      );
      links[0].remove();
    }
  }
});

test('no other page preloads it', () => {
  expect(preloadFromSource(390, 844, '/new')).toHaveLength(0);
  expect(preloadFromSource(390, 844, '/game/abc')).toHaveLength(0);
});
