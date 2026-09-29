import { useEffect } from 'react';

/**
 * Frees GPU resources built once with useMemo (geometries, materials) when
 * the component goes. `parts` must be the memoised object itself, so the
 * effect runs once.
 */
export const useDisposeOnUnmount = (parts: Record<string, { dispose(): void }>) =>
  useEffect(() => () => Object.values(parts).forEach((p) => p.dispose()), [parts]);
