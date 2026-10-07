import { expect, test } from 'vitest';
import { LANDING_BANDS } from './landingLayout';

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
