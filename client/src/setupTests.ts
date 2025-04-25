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
