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
});
