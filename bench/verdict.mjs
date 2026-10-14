// The A/B's rule (run.mjs --base): how a row's interleaved pairs are judged.
// Tested by client/bench/verdict.test.mjs.

export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * The pairs' verdict for one measured thing: each pair's ratio head/base,
 * their geometric mean as the change, and a change called real only when
 * every pair agrees on its direction and it exceeds both 5% and the pairs'
 * own disagreement (their ratios' range). A value at 0 on a side is judged
 * by the pairs' differences instead (`diffs`, the change their median).
 */
export function verdict(pairs, better, unit) {
  // A value at 0 on a side has no ratio: its change is the difference,
  // called when every pair moves the same way. A count (the programs a move
  // links once warm, a leak's growth) is judged so whenever a pair has a 0;
  // anything else (a longest task, 0 until one reaches the browser's 50 ms)
  // only when no two pairs give a ratio, since a time's differences all lean
  // one way by chance far more often than its ratios clear the rule below
  const ratioPairs = pairs.filter(([b, h]) => b > 0 && h > 0);
  const zero = pairs.some(([b, h]) => b === 0 || h === 0);
  if (pairs.length >= 2 && zero && (unit === 'count' || ratioPairs.length < 2)) {
    const diffs = pairs.map(([b, h]) => h - b);
    const change = median(diffs);
    const real = diffs.every((d) => d > 0) || diffs.every((d) => d < 0);
    const improved = better === 'higher' ? change > 0 : change < 0;
    return { ratios: [], diffs, change, spread: 0, real, improved };
  }
  const ratios = pairs.map(([b, h]) => h / b).filter((r) => Number.isFinite(r) && r > 0);
  if (ratios.length < 2) return null;
  const mean = Math.exp(ratios.reduce((s, r) => s + Math.log(r), 0) / ratios.length);
  const change = (mean - 1) * 100;
  const spread = ((Math.max(...ratios) - Math.min(...ratios)) / mean) * 100;
  // Every pair, a pair with a 0 included (it has no ratio, but a direction)
  const ways = pairs.map(([b, h]) => Math.sign(h - b));
  const agree = ways.every((w) => w > 0) || ways.every((w) => w < 0);
  const real = agree && Math.abs(change) > Math.max(5, spread);
  const improved = better === 'higher' ? change > 0 : change < 0;
  return { ratios, change, spread, real, improved };
}
