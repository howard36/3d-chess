import { describe, expect, it } from 'vitest';
import { columnHeight, selectState, stepSelection } from './selection';

// The held light's timeline: the column grows to its height and its light
// comes up without ever overshooting and falling back.

const run = (frames: number, dt: number, selected: boolean, s = selectState()) => {
  const trace: { rise: number; strength: number }[] = [];
  for (let i = 0; i < frames; i++) {
    stepSelection(s, selected, dt, false);
    trace.push({ rise: s.rise, strength: s.strength });
  }
  return { s, trace };
};

describe('the selection timeline', () => {
  it('grows the column and its light monotonically to rest, at any frame rate', () => {
    for (const dt of [1000 / 60, 1000 / 24, 1000 / 8, 125]) {
      const { trace } = run(Math.ceil(2500 / dt), dt, true);
      for (let i = 1; i < trace.length; i++) {
        expect(trace[i].rise).toBeGreaterThanOrEqual(trace[i - 1].rise);
        expect(trace[i].strength).toBeGreaterThanOrEqual(trace[i - 1].strength);
      }
      const end = trace[trace.length - 1];
      expect(end.rise).toBe(1);
      expect(end.strength).toBeCloseTo(0.5, 5);
    }
  });

  it('releases to nothing, and replays the whole entrance on the next pick-up', () => {
    const { s } = run(120, 1000 / 60, true);
    const released = run(30, 1000 / 60, false, s).s;
    expect(released.rise).toBe(0);
    expect(released.strength).toBe(0);
    stepSelection(released, true, 1000 / 60, false);
    expect(released.since).toBeLessThan(40);
    expect(released.pulse).toBeGreaterThanOrEqual(0);
  });

  it('stands the column on the held lift, scaled to the piece, and below the level above', () => {
    const pawn = columnHeight(0.52, 0.17);
    const king = columnHeight(0.87, 0.17);
    expect(pawn).toBeGreaterThan(0.17);
    expect(king).toBeGreaterThan(pawn);
    expect(king - 0.17).toBeCloseTo(((0.87 / 0.52) * (pawn - 0.17)) as number, 6);
    // The level gap is 1.35 in the world, 1.69 piece units
    expect(columnHeight(0.87, 0.45)).toBeLessThan(1.6);
  });
});
