import React from 'react';

/**
 * Whether `active` has held for `ms` without a break: for words about a wait
 * that only need saying once it is taking longer than it should (a connection
 * that is usually open in a moment).
 */
export function useDelayed(active: boolean, ms: number): boolean {
  const [late, setLate] = React.useState(false);
  React.useEffect(() => {
    if (!active) {
      setLate(false);
      return;
    }
    const timer = window.setTimeout(() => setLate(true), ms);
    return () => window.clearTimeout(timer);
  }, [active, ms]);
  return active && late;
}

/** How long a wait on the server goes unremarked. */
export const SLOW_SERVER_MS = 1500;
