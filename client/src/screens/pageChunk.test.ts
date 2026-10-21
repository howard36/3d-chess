import { beforeEach, expect, test, vi } from 'vitest';
import { pageReady } from './pageChunk';

// Each page's chunk, as a promise of its own to tell which one is waited for
const { game, computer } = vi.hoisted(() => ({
  game: Promise.resolve(),
  computer: Promise.resolve(),
}));
vi.mock('./gameScreenChunk', () => ({ gameScreen: { ready: vi.fn(() => game) } }));
vi.mock('./computerGameChunk', () => ({ computerGame: { ready: vi.fn(() => computer) } }));

beforeEach(() => vi.clearAllMocks());

test("a game's address waits for its page's chunk before the app first renders", () => {
  expect(pageReady('/game/ABC123')).toBe(game);
  expect(pageReady('/computer/abc123')).toBe(computer);
});

test('any other address renders at once, asking for no chunk', async () => {
  const { gameScreen } = await import('./gameScreenChunk');
  const { computerGame } = await import('./computerGameChunk');
  for (const path of ['/', '/new', '/computer', '/learn', '/learn/rook', '/game/', '/nope']) {
    const ready = pageReady(path);
    expect([path, ready === game || ready === computer]).toEqual([path, false]);
  }
  expect(gameScreen.ready).not.toHaveBeenCalled();
  expect(computerGame.ready).not.toHaveBeenCalled();
});
