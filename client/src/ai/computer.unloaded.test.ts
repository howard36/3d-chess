import { createComputer } from './computer';
import { ChunkLoadError } from '../lib/cachedImport';

// The search's chunk that does not load (a page from before a deploy, whose
// chunk has gone): told apart from a search that failed
vi.mock('./choose', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

it('rejects with a ChunkLoadError when the search’s code cannot load', async () => {
  vi.stubGlobal('Worker', undefined);
  try {
    await expect(createComputer().think([], 'easy')).rejects.toBeInstanceOf(ChunkLoadError);
  } finally {
    vi.unstubAllGlobals();
  }
});
