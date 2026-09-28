import { describe, expect, it } from 'vitest';
import { budgetPixelRatio, MAX_PIXEL_RATIO, PIXEL_BUDGET } from './pixelBudget';

const drawn = (w: number, h: number, dpr: number) => w * h * budgetPixelRatio(w, h, dpr) ** 2;

describe('budgetPixelRatio', () => {
  it('draws a phone at up to 2x, well inside the budget', () => {
    expect(budgetPixelRatio(390, 844, 3)).toBe(2);
    expect(budgetPixelRatio(430, 932, 3)).toBe(2);
    expect(budgetPixelRatio(375, 667, 2)).toBe(2);
    expect(budgetPixelRatio(844, 390, 3)).toBe(2);
    expect(budgetPixelRatio(360, 640, 1.5)).toBe(1.5);
  });

  it('draws an ordinary window at its own ratio', () => {
    expect(budgetPixelRatio(1280, 720, 1)).toBe(1);
    expect(budgetPixelRatio(1280, 720, 2)).toBe(2);
    expect(budgetPixelRatio(2560, 1440, 1)).toBe(1);
  });

  it('holds a large high-density window to the budget', () => {
    // 1920x1080 at 2x would draw 8.3 MP
    expect(budgetPixelRatio(1920, 1080, 2)).toBeCloseTo(1.47, 2);
    expect(drawn(1920, 1080, 2)).toBeCloseTo(PIXEL_BUDGET);
    expect(drawn(2560, 1440, 2)).toBeCloseTo(PIXEL_BUDGET);
    expect(drawn(1440, 900, 2)).toBeCloseTo(PIXEL_BUDGET);
  });

  it('never draws under one device pixel per CSS pixel, nor finer than MAX_PIXEL_RATIO', () => {
    expect(budgetPixelRatio(3440, 1440, 1)).toBe(1);
    expect(budgetPixelRatio(3840, 2160, 1)).toBe(1);
    expect(budgetPixelRatio(200, 200, 4)).toBe(MAX_PIXEL_RATIO);
    // A screen coarser than one (a zoomed-out page) keeps its own ratio
    expect(budgetPixelRatio(3000, 2000, 0.8)).toBe(0.8);
  });

  it('falls back sensibly on an unknown ratio or an empty canvas', () => {
    expect(budgetPixelRatio(800, 600, 0)).toBe(1);
    expect(budgetPixelRatio(0, 0, 2)).toBe(2);
  });

  it('takes a custom budget', () => {
    expect(budgetPixelRatio(1000, 1000, 3, 1e6)).toBe(1);
    expect(budgetPixelRatio(1000, 1000, 3, 2.25e6)).toBe(1.5);
  });
});
