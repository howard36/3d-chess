// A short game that shows every kind of moment: quiet moves, captures both
// ways, checks, and a mate by White, found by search over the rules engine.
// scripts/showcase.mjs records it (from a copy of its own), and tests use it
// as a game that ends in mate. It was the start page's demo before real
// games took its place (game/demo.ts).

export const SHORT_GAME: readonly string[] = [
  'Ab2-De5 Ed4-Ba1', // unicorns trade pawns across the whole cube
  'Ac2-Cc4 Dc4-Dc3',
  'Ad2-Dd5 Ec4-Dd5', // bishop takes with check; the queen takes back
  'Aa1-Ba1 Dd5-Db3', // rook takes the unicorn
  'Cc4-Db3 Db4-Cb4', // queen trade
  'Ad1-Cd2 Dc3-Cc3',
  'Aa2-Da5 Eb4-Ed2',
  'Da5-Db4 Ed2-Cb2',
  'Db3-Ec4', // mate
]
  .join(' ')
  .split(' ');
