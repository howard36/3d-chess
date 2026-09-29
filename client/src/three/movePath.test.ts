import { describe, expect, it } from 'vitest';
import { movePoint } from './movePath';

describe('movePath', () => {
  it('runs a move in a straight line, whatever its level change', () => {
    const from: [number, number, number] = [0, 0, 0];
    const to: [number, number, number] = [2, 2.7, -1];
    expect(movePoint(from, to, 0)).toEqual(from);
    expect(movePoint(from, to, 1)).toEqual(to);
    for (const e of [0.1, 0.25, 0.5, 0.9]) {
      const p = movePoint(from, to, e);
      p.forEach((v, i) => expect(v).toBeCloseTo(to[i] * e));
    }
  });

  it('lifts an arc to its height above the line’s midpoint, and no further', () => {
    const from: [number, number, number] = [0, 1, 0];
    const to: [number, number, number] = [1, 3.7, 2];
    const peak = movePoint(from, to, 0.5, 0.6);
    expect(peak[1]).toBeCloseTo((1 + 3.7) / 2 + 0.6);
    for (let e = 0; e <= 1; e += 0.05) {
      const lineY = 1 + 2.7 * e;
      expect(movePoint(from, to, e, 0.6)[1] - lineY).toBeLessThanOrEqual(0.6 + 1e-9);
    }
  });
});
