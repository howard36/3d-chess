import { expect, test } from 'vitest';
import { cardBeside, learnBottom, learnLeft } from './learnLayout';

test("keeps the card's room clear where the card stands, by layout", () => {
  // A desktop: beside the tower, which clears it centred
  expect(cardBeside(1280, 800)).toBe(true);
  expect([learnBottom(800, 1280), learnLeft(1280, 800)]).toEqual([0, 0]);
  // Too narrow for that: along the bottom
  expect(cardBeside(1024, 768)).toBe(false);
  expect(learnBottom(768, 1024)).toBe(272);
  // Phones held upright, the narrowest's card tallest
  expect(learnBottom(844, 390)).toBe(284);
  expect(learnBottom(568, 320)).toBe(296);
  expect(learnLeft(320, 568)).toBe(0);
  // A phone on its side: beside, the room right of it there should the tower need it
  expect(cardBeside(568, 320)).toBe(true);
  expect([learnBottom(320, 568), learnLeft(568, 320)]).toEqual([0, 276]);
});
