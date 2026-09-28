import { describe, expect, it } from 'vitest';
// The design context first: this design's modules read their settings through it
import '../context';
import { columnHeight, glintLaps, selectState, stepSelection } from './selection';

// The held light's timeline: the column grows to its height and its light
// comes up without ever overshooting and falling back; the glint runs once
// round and, circling, goes on round without a jump in its pace.

const run = (frames: number, dt: number, selected: boolean, s = selectState()) => {
  const trace: { rise: number; strength: number }[] = [];
  for (let i = 0; i < frames; i++) {
    stepSelection(s, selected, dt, { still: false, pulse: true });
    trace.push({ rise: s.rise, strength: s.strength });
  }
  return { s, trace };
};

describe('zenith selection timeline', () => {
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
    stepSelection(released, true, 1000 / 60, { still: false, pulse: true });
    expect(released.since).toBeLessThan(40);
    expect(released.draw).toBeLessThan(0.1);
    expect(released.pulse).toBeGreaterThanOrEqual(0);
  });

  it('runs the glint once round, then on round at a steady pace with no jump', () => {
    expect(glintLaps(0)).toBe(0);
    expect(glintLaps(640)).toBeCloseTo(1, 6);
    // Continuous in position and pace across the end of the first lap
    const pace = (t: number) => (glintLaps(t + 1) - glintLaps(t - 1)) / 2;
    expect(pace(641)).toBeCloseTo(pace(639), 4);
    // Then circling: about a lap every three seconds, always moving on
    const later = pace(8000);
    expect(later).toBeCloseTo(1 / 3000, 5);
    for (let t = 0; t < 10000; t += 50) expect(glintLaps(t + 50)).toBeGreaterThan(glintLaps(t));
  });

  it('stands the column on the held lift, scaled to the piece, and below the level above', () => {
    const pawn = columnHeight(0.52, 0.17, 1.2);
    const king = columnHeight(0.87, 0.17, 1.2);
    expect(pawn).toBeGreaterThan(0.17);
    expect(king).toBeGreaterThan(pawn);
    expect(king - 0.17).toBeCloseTo(((0.87 / 0.52) * (pawn - 0.17)) as number, 6);
    // The level gap is 1.35 in the world, 1.69 piece units
    expect(columnHeight(0.87, 0.45, 1.6)).toBeLessThan(1.6);
  });
});
