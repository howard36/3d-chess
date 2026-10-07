import { expect, test } from 'vitest';
import { cardBeside, learnBottom, learnGutter, learnLeft } from './learnLayout';

test("keeps the card's room clear where the card stands, by layout", () => {
  // A desktop: beside the tower, set in by the home page's gutter, its room
  // kept should the tower, centred, run under it
  expect(cardBeside(1280, 800)).toBe(true);
  expect([learnBottom(800, 1280), learnLeft(1280, 800)]).toEqual([0, 76.8 + 300 + 12]);
  expect(learnLeft(1920, 1080)).toBe(112 + 300 + 12);
  // Too narrow for that: along the bottom
  expect(cardBeside(1024, 768)).toBe(false);
  expect([learnBottom(768, 1024), learnLeft(1024, 768)]).toEqual([272, 0]);
  // Phones held upright, the narrowest's card tallest
  expect(learnBottom(844, 390)).toBe(284);
  expect(learnBottom(568, 320)).toBe(296);
  expect(learnLeft(320, 568)).toBe(0);
  // A phone on its side: beside, 12 px in, the room right of it there should the tower need it
  expect(cardBeside(568, 320)).toBe(true);
  expect([learnBottom(320, 568), learnLeft(568, 320)]).toEqual([0, 276]);
  expect(learnLeft(844, 390)).toBe(276);
});

test("sets the card in by the home page's gutter", () => {
  // index.css, --landing-gutter: clamp(24px, 6vw, 112px)
  expect([300, 1000, 1920, 2560].map(learnGutter)).toEqual([24, 60, 112, 112]);
});
