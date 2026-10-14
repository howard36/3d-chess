import {
  getStoredDifficulty,
  loadComputerGame,
  newComputerGameId,
  saveComputerGame,
  setStoredDifficulty,
} from './computerGames';
import type { ComputerGame } from '../game/computerGame';

const game: ComputerGame = {
  id: 'kq7x2mpa9d',
  color: 'black',
  difficulty: 'hard',
  started: true,
  moves: [{ by: 'white', from: 'Bc2', to: 'Cc2' }],
};

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it('keeps a game in the browser and reads it back', () => {
  expect(loadComputerGame(game.id)).toBeNull();
  saveComputerGame(game);
  expect(JSON.parse(localStorage.getItem(`3dchess:computer:${game.id}`)!)).toEqual(game);
  localStorage.setItem(`3dchess:computer:${game.id}`, JSON.stringify(game));
  expect(loadComputerGame(game.id)).toEqual(game);
});

it('ignores what is not a game, saying so, and plays on from memory where storage is refused', () => {
  const unread = vi.spyOn(console, 'warn').mockImplementation(() => {});
  localStorage.setItem('3dchess:computer:junk', '{"id":"junk","color":"red"}');
  expect(loadComputerGame('junk')).toBeNull();
  localStorage.setItem('3dchess:computer:bad', '{not json');
  expect(loadComputerGame('bad')).toBeNull();
  // Nothing stored is no game, and nothing to say
  expect(loadComputerGame('none')).toBeNull();
  expect(unread.mock.calls.map((c) => String(c[0]))).toEqual([
    'The stored game junk is not one this page can read.',
    'The stored game bad could not be read.',
  ]);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('refused');
  });
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('refused');
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const other = { ...game, id: 'memoryonly' };
  saveComputerGame(other);
  expect(loadComputerGame('memoryonly')).toEqual(other);
  expect(getStoredDifficulty()).toBe('medium');
  expect(() => setStoredDifficulty('easy')).not.toThrow();
});

it('plays on from its latest move once storage starts refusing it, and says so once', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  saveComputerGame(game);
  // Storage full: the next moves are refused
  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('QuotaExceededError');
  });
  const later = {
    ...game,
    moves: [...game.moves, { by: 'black' as const, from: 'Ed4', to: 'Dd4' }],
  };
  saveComputerGame(later);
  saveComputerGame({ ...later });
  // Not the older copy storage still holds
  expect(loadComputerGame(game.id)).toEqual(later);
  expect(warn).toHaveBeenCalledOnce();
  // Room again: storage holds the latest, and is read from again
  setItem.mockRestore();
  saveComputerGame(later);
  localStorage.setItem(`3dchess:computer:${game.id}`, JSON.stringify(game));
  expect(loadComputerGame(game.id)).toEqual(game);
});

it('remembers the last level, Medium the first time', () => {
  expect(getStoredDifficulty()).toBe('medium');
  setStoredDifficulty('hard');
  expect(getStoredDifficulty()).toBe('hard');
  localStorage.setItem('3dchess:computer-difficulty', 'impossible');
  expect(getStoredDifficulty()).toBe('medium');
});

it('makes ids no server game could have', () => {
  const ids = new Set(Array.from({ length: 50 }, newComputerGameId));
  expect(ids.size).toBe(50);
  for (const id of ids) expect(id).toMatch(/^[a-z2-9]{10}$/);
});
