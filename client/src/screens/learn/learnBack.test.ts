import { expect, test } from 'vitest';
import { backToGame } from './learnBack';

test('leads back only to a game page: a friend’s game or the computer’s', () => {
  expect(backToGame({ back: '/game/ABCD' })).toBe('/game/ABCD');
  expect(backToGame({ back: '/computer/x1y2' })).toBe('/computer/x1y2');
  for (const state of [
    null,
    undefined,
    {},
    { back: 3 },
    { back: '/' },
    { back: '/new' },
    { back: '/game/' },
    { back: '/game/A/B' },
    { back: '//elsewhere.example/game/A' },
  ])
    expect(backToGame(state)).toBeNull();
});
