import { matchPath } from 'react-router';
import { gameScreen } from './gameScreenChunk';
import { computerGame } from './computerGameChunk';

/**
 * What the app's first render at `path` waits for: the page's own chunk,
 * where its route renders one (App.tsx), preloaded from the HTML's head
 * alongside the entry (vite.config.ts, PRELOADS), as a part that suspended in
 * the first commit would hold it for 300 ms.
 */
export const pageReady = (path: string): Promise<void> =>
  matchPath('/game/:gameId', path)
    ? gameScreen.ready()
    : matchPath('/computer/:gameId', path)
      ? computerGame.ready()
      : Promise.resolve();
