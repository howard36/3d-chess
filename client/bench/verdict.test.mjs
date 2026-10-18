// The A/B's rule (bench/verdict.mjs): what it calls and what it leaves alone.
import { verdict } from '../../bench/verdict.mjs';

describe('verdict', () => {
  it('calls a change every pair agrees on, beyond 5% and the pairs’ spread', () => {
    const v = verdict(
      [
        [100, 80],
        [100, 82],
        [100, 79],
      ],
      'lower',
      'ms',
    );
    expect(v.real).toBe(true);
    expect(v.improved).toBe(true);
  });

  it('never calls a row that is a choice, not a cost, but still gives its change', () => {
    const placed = verdict(
      [
        [0, 5],
        [0, 5],
        [0, 5],
      ],
      'none',
      'count',
    );
    expect(placed.real).toBe(false);
    expect(placed.change).toBe(5);
    const v = verdict(
      [
        [5, 3],
        [5, 3],
        [5, 3],
      ],
      'none',
      'count',
    );
    expect([v.real, Math.round(v.change)]).toEqual([false, -40]);
    // The same pairs judged 'higher' are a loss
    expect(
      verdict(
        [
          [5, 3],
          [5, 3],
          [5, 3],
        ],
        'higher',
        'count',
      ),
    ).toMatchObject({
      real: true,
      improved: false,
    });
  });

  it('leaves alone pairs that disagree, or agree within 5%', () => {
    const split = [
      [100, 80],
      [100, 120],
      [100, 90],
    ];
    expect(verdict(split, 'lower', 'ms').real).toBe(false);
    const small = [
      [100, 103],
      [100, 104],
      [100, 103],
    ];
    expect(verdict(small, 'lower', 'ms').real).toBe(false);
  });

  it('judges a count with a 0 by its differences: 0 → N in every pair', () => {
    const v = verdict(
      [
        [0, 2],
        [0, 3],
        [0, 1],
      ],
      'lower',
      'count',
    );
    expect(v.diffs).toEqual([2, 3, 1]);
    expect(v.real).toBe(true);
    expect(v.improved).toBe(false);
    expect(
      verdict(
        [
          [0, 2],
          [1, 0],
          [0, 0],
        ],
        'lower',
        'count',
      ).real,
    ).toBe(false);
  });

  it('does not call a time on direction alone when one pair has a 0', () => {
    // Two pairs give a ratio: judged by ratios, never by the differences
    expect(
      verdict(
        [
          [0, 55],
          [60, 61],
          [70, 71],
        ],
        'lower',
        'ms',
      ).real,
    ).toBe(false);
  });

  it('counts a pair at 0 against the others’ direction rather than dropping it', () => {
    // 55 → 0 went the other way: the two ratios alone (+15%) are not every pair
    const v = verdict(
      [
        [55, 0],
        [60, 70],
        [62, 70],
      ],
      'lower',
      'ms',
    );
    expect(v.real).toBe(false);
  });

  const pairsOf = (ratios) => ratios.map((r) => [100, 100 * r]);

  it('calls 10 or more pairs that all agree, though one of them is far out', () => {
    // ab-20261017-1252-final-search.md, the middlegame search: −44%, every
    // pair faster, and one pair at 0.35 that made the range 55% wide
    const search = [0.62, 0.65, 0.58, 0.54, 0.56, 0.35, 0.59, 0.54, 0.5, 0.61, 0.61, 0.6];
    expect(verdict(pairsOf(search), 'lower', 'ms')).toMatchObject({ real: true, improved: true });
    // Two far out still set the bar
    const two = [0.62, 0.65, 0.58, 0.54, 0.56, 0.35, 0.3, 0.54, 0.5, 0.61, 0.61, 0.6];
    expect(verdict(pairsOf(two), 'lower', 'ms').real).toBe(false);
  });

  it('keeps the whole range below 10 pairs, and leaves a lean within its noise alone', () => {
    // ab-20261016-1616-final.md, the desktop board in 8 pairs: trimmed, it would be called
    const eight = [0.41, 0.62, 0.52, 0.67, 0.68, 0.6, 0.46, 0.63];
    expect(verdict(pairsOf(eight), 'lower', 'ms').real).toBe(false);
    const lean = [0.99, 0.97, 0.9, 0.95, 0.98, 0.93, 0.96, 0.85, 0.97, 0.94];
    expect(verdict(pairsOf(lean), 'lower', 'ms').real).toBe(false);
  });

  it('has nothing to say on fewer than two pairs', () => {
    expect(verdict([[100, 90]], 'lower', 'ms')).toBeNull();
  });
});
