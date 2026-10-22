// The A/B's rule (run.mjs --base): how a row's interleaved pairs are judged.
// Tested by client/bench/verdict.test.mjs.

export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** From how many pairs the spread leaves out the two most extreme. */
const TRIM_FROM = 10;

/**
 * The pairs' verdict for one measured thing: each pair's ratio head/base,
 * their geometric mean as the change, and a change called real only when
 * every pair agrees on its direction and it exceeds both 5% and the pairs'
 * own disagreement (their ratios' range; from 10 pairs on, the range without
 * the lowest and the highest ratio, so that one pair far out, a hiccup of the
 * machine, cannot set the bar for all the others). A value at 0 on a side is judged
 * by the pairs' differences instead (`diffs`, the change their median).
 * A row whose `better` is 'none' (a choice, not a cost) is never called.
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
    const real = better !== 'none' && (diffs.every((d) => d > 0) || diffs.every((d) => d < 0));
    const improved = better === 'higher' ? change > 0 : change < 0;
    return { ratios: [], diffs, change, spread: 0, real, improved };
  }
  const ratios = pairs.map(([b, h]) => h / b).filter((r) => Number.isFinite(r) && r > 0);
  if (ratios.length < 2) return null;
  const mean = Math.exp(ratios.reduce((s, r) => s + Math.log(r), 0) / ratios.length);
  const change = (mean - 1) * 100;
  // Trimmed only from 10 pairs: with sign flips of every committed report's
  // pairs as the null, the calls left to chance stay under 0.01% of rows
  // (bench/loop/tools/calling-rule-null.mjs); trimmed from 8 they grow 5-fold
  const kept = ratios.length >= TRIM_FROM ? [...ratios].sort((a, b) => a - b).slice(1, -1) : ratios;
  const spread = ((Math.max(...kept) - Math.min(...kept)) / mean) * 100;
  // Every pair, a pair with a 0 included (it has no ratio, but a direction)
  const ways = pairs.map(([b, h]) => Math.sign(h - b));
  const agree = ways.every((w) => w > 0) || ways.every((w) => w < 0);
  const real = better !== 'none' && agree && Math.abs(change) > Math.max(5, spread);
  const improved = better === 'higher' ? change > 0 : change < 0;
  return { ratios, change, spread, real, improved };
}

/**
 * The chance the rule calls a row of these pairs' sizes when nothing changed:
 * were each pair as likely to go either way (the null of sign flips), it is
 * called only when every pair lands on one side, 2^(1-n) of the flips, and
 * the sizes clear the rule. It leaves out a drift of the VM's between the two
 * sides' runs, which only an A/A of identical code shows.
 */
export function chanceOfCall(ratios) {
  const sizes = ratios.map((r) => Math.exp(Math.abs(Math.log(r))));
  if (sizes.length < 2 || !sizes.every((r) => r > 1)) return 0;
  const v = verdict(
    sizes.map((r) => [100, 100 * r]),
    'lower',
    'ms',
  );
  return v?.real ? 2 ** (1 - sizes.length) : 0;
}

/**
 * The skill's speed rule over the primary rows, as the A/B report's sentence,
 * worked out here so nobody counts pairs by hand: a measured row worse in every
 * pair, or more than 3% worse at its median pair (not the pairs' geometric
 * mean), is the owner's to see, called or not. `measured` holds each measured
 * row's `moment`, `ratios` (head/base) and `better`; a narrowed A/B claims
 * nothing for the `total - measured.length` rows it did not measure.
 */
export function speedRule(measured, total) {
  const flagged = measured.flatMap(({ moment, ratios, better }) => {
    const worse = ratios.map((x) => (better === 'higher' ? 1 / x : x));
    const mid = median(worse);
    const over = worse.filter((x) => x > 1).length;
    if (over < worse.length && mid <= 1.03) return [];
    return [`${moment}: median pair ×${mid.toFixed(3)}, ${over} of ${worse.length} pairs worse`];
  });
  const unmeasured = total - measured.length;
  if (flagged.length)
    return (
      `**For "Needs from me"** (worse in every pair, or more than 3% worse at the median pair): ` +
      `${flagged.join('; ')}.`
    );
  if (unmeasured)
    return (
      `No measured primary row is worse in every pair or more than 3% worse at its median ` +
      `pair; ${unmeasured} of ${total} were not measured, and nothing is claimed for them.`
    );
  return 'No primary row is worse in every pair or more than 3% worse at its median pair.';
}
