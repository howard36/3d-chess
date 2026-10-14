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

  it('has nothing to say on fewer than two pairs', () => {
    expect(verdict([[100, 90]], 'lower', 'ms')).toBeNull();
  });
});
