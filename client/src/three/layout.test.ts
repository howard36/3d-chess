import { describe, it, expect } from 'vitest';
import { CELLS, GRID_SIZE } from './layout';
import { toZXY } from '../engine/coords';

describe('CELLS', () => {
  it('covers every cell of the grid exactly once', () => {
    expect(CELLS).toHaveLength(GRID_SIZE ** 3);
    expect(new Set(CELLS.map(toZXY)).size).toBe(GRID_SIZE ** 3);
  });
});
