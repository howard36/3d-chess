import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock ResizeObserver
const ResizeObserverMock = vi.fn(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Assign the mock to the global scope
vi.stubGlobal('ResizeObserver', ResizeObserverMock);

// The scene builds and bakes the piece set in the background as soon as it
// is imported (preloadBakedSet), on idle callbacks or, where there are none,
// timers: jsdom has none, so every test file importing the scene would bake
// the whole set behind its tests. An idle callback that never comes keeps
// the preload asleep; pieces are built when first drawn, as before.
vi.stubGlobal('requestIdleCallback', () => 0);
