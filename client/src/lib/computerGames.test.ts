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

it('ignores what is not a game, and plays on from memory where storage is refused', () => {
  localStorage.setItem('3dchess:computer:junk', '{"id":"junk","color":"red"}');
  expect(loadComputerGame('junk')).toBeNull();
  localStorage.setItem('3dchess:computer:bad', '{not json');
  expect(loadComputerGame('bad')).toBeNull();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('refused');
  });
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('refused');
  });
  const other = { ...game, id: 'memoryonly' };
  saveComputerGame(other);
  expect(loadComputerGame('memoryonly')).toEqual(other);
  expect(getStoredDifficulty()).toBe('medium');
  expect(() => setStoredDifficulty('easy')).not.toThrow();
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
