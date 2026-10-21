import { lazyChunk } from '../lib/cachedImport';

// A game against the computer is a chunk of its own (the stand-in for the
// server, the handle on the computer's worker), so the start page's entry
// carries none of it. Its address waits for it before the app first renders
// (pageReady), the side choice against the computer asks for it as soon as it
// shows; App renders it (ComputerGameRoute).
export const computerGame = lazyChunk(() => import('./ComputerGameScreen'));
