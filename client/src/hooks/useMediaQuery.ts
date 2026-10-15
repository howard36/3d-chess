import React from 'react';

const matches = (query: string) =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia(query).matches;

/** Whether a CSS media query matches, following it as it changes. */
export function useMediaQuery(query: string): boolean {
  const [matched, setMatched] = React.useState(() => matches(query));
  React.useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const changed = () => setMatched(list.matches);
    list.addEventListener?.('change', changed);
    return () => list.removeEventListener?.('change', changed);
  }, [query]);
  return matched;
}
