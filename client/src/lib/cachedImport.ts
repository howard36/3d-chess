import { lazy } from 'react';
import type { ComponentType } from 'react';

/**
 * A chunk that did not load (its loader's error is the `cause`), told apart
 * from any other error so that ChunkBoundary can leave out only the part of
 * the page the chunk would have drawn.
 */
export class ChunkLoadError extends Error {
  readonly cause: unknown;
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'ChunkLoadError';
    this.cause = cause;
  }
}

/**
 * A loader for a chunk that asks for it once and hands every caller the same
 * promise, until that load fails (with a ChunkLoadError): then the next call
 * asks again. Whether asking again fetches anything is the browser's
 * business: Chromium keeps a module that failed to fetch failed for the rest
 * of the page's life (tried in 141), so there only a reload helps, as it
 * does after a deploy has replaced the chunk.
 */
export const cachedImport = <T>(load: () => Promise<T>): (() => Promise<T>) => {
  let pending: Promise<T> | null = null;
  return () =>
    (pending ??= load().catch((error: unknown) => {
      pending = null;
      throw new ChunkLoadError(error);
    }));
};

/**
 * A component from a chunk of its own (a canvas), for the page around it to
 * show without waiting; `preload` asks for the chunk before it first renders.
 * React.lazy keeps its first failure for good, so `retry` makes a fresh one,
 * which asks for the chunk again, for the next render to use. Render it
 * inside a ChunkBoundary.
 */
// As React.lazy's own: any component, whatever its props
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const lazyChunk = <C extends ComponentType<any>>(load: () => Promise<{ default: C }>) => {
  const get = cachedImport(load);
  let component = lazy(get);
  return {
    get Component() {
      return component;
    },
    preload: () => void get().catch(() => {}),
    retry: () => {
      component = lazy(get);
    },
  };
};

/** Loads the page afresh: the one retry left for a chunk the browser holds failed. */
export const reloadPage = () => window.location.reload();
