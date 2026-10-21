import { lazyChunk } from '../lib/cachedImport';

// A game's page (its HUD, its move record, the review) is a chunk of its own,
// so the start page's entry carries none of it. A game's address waits for it
// before the app first renders (pageReady), the side choice asks for it as soon
// as it shows, and a game against the computer imports it with its own chunk.
export const gameScreen = lazyChunk(() => import('./GameScreen'));
