// For review only (never merged): the demo game the address asks for.

/** The game `?game=N` asks for (from 1), as an index into the demo's games, or null. */
export const chosenGame = (count: number): number | null => {
  const n = Number(new URLSearchParams(window.location.search).get('game'));
  return Number.isInteger(n) && n >= 1 && n <= count ? n - 1 : null;
};
