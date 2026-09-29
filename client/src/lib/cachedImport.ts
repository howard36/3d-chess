/**
 * A loader for a chunk that asks for it once and hands every caller the same
 * promise, until that load fails: then the next call asks again, so a
 * dropped connection or a stale deploy costs one failed attempt rather than
 * every later one.
 */
export const cachedImport = <T>(load: () => Promise<T>): (() => Promise<T>) => {
  let pending: Promise<T> | null = null;
  return () =>
    (pending ??= load().catch((error: unknown) => {
      pending = null;
      throw error;
    }));
};
