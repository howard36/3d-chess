import '@testing-library/jest-dom/vitest';
import { beforeEach, vi } from 'vitest';
import { loadPieceData } from './three/pieces/pieceData';

// The set's precomputed parts, which the pages load beside their canvases
await loadPieceData();

// Mock ResizeObserver (a class: it is constructed with new, which a mock
// with an arrow function for its implementation refuses)
class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

// Assign the mock to the global scope
vi.stubGlobal('ResizeObserver', ResizeObserverMock);

// jsdom has no AnimationEvent, and React, finding none, listens for the
// prefixed webkitAnimationEnd in its place (jsdom's style knows the prefixed
// property), so no animationend would reach a handler: give it one, as every
// browser has, before react-dom loads (and outside the stubs a test may undo)
if (!('AnimationEvent' in window)) {
  class AnimationEvent extends Event {
    readonly animationName: string;
    readonly elapsedTime: number;
    readonly pseudoElement: string;
    constructor(type: string, init: AnimationEventInit = {}) {
      super(type, init);
      this.animationName = init.animationName ?? '';
      this.elapsedTime = init.elapsedTime ?? 0;
      this.pseudoElement = init.pseudoElement ?? '';
    }
  }
  Object.defineProperty(window, 'AnimationEvent', {
    value: AnimationEvent,
    configurable: true,
    writable: true,
  });
}

// The scene builds and bakes the piece set in the background as soon as it
// is imported (preloadBakedSet), on idle callbacks or, where there are none,
// timers: jsdom has none, so every test file importing the scene would bake
// the whole set behind its tests. An idle callback that never comes keeps
// the preload asleep; pieces are built when first drawn, as before.
vi.stubGlobal('requestIdleCallback', () => 0);

// Again before each test: Vitest gives a stubbed global back as it was
// before its first stub, absent in jsdom, so a file's vi.unstubAllGlobals()
// took these two with it for the rest of the file, and its later tests ran
// a path no browser takes (1016:TS1)
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  vi.stubGlobal('requestIdleCallback', () => 0);
});
