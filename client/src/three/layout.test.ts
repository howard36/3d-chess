import { describe, it, expect } from 'vitest';
import { CELLS, GRID_SIZE, SPACING, toWorld } from './layout';
import { toZXY } from '../engine/coords';

describe('CELLS', () => {
  it('covers every cell of the grid exactly once', () => {
    expect(CELLS).toHaveLength(GRID_SIZE ** 3);
    expect(new Set(CELLS.map(toZXY)).size).toBe(GRID_SIZE ** 3);
  });
});

describe('toWorld', () => {
  const MAX = ((GRID_SIZE - 1) / 2) * SPACING; // 2.2

  it("puts White's home corner at bottom-left-nearest", () => {
    // Aa1: file a, rank 1, level A
    expect(toWorld({ x: 0, y: 0, z: 0 }, 'white')).toEqual([-MAX, -MAX, MAX]);
    // Ee5: file e, rank 5, level E
    expect(toWorld({ x: 4, y: 4, z: 4 }, 'white')).toEqual([MAX, MAX, -MAX]);
  });

  it("puts Black's home corner at bottom-left-nearest", () => {
    // Ee5 is Black's equivalent of White's Aa1
    expect(toWorld({ x: 4, y: 4, z: 4 }, 'black')).toEqual([-MAX, -MAX, MAX]);
    expect(toWorld({ x: 0, y: 0, z: 0 }, 'black')).toEqual([MAX, MAX, -MAX]);
  });

  it("renders Black's view as the inversion of White's, files included", () => {
    for (const cell of CELLS) {
      const inverted = {
        x: GRID_SIZE - 1 - cell.x,
        y: GRID_SIZE - 1 - cell.y,
        z: GRID_SIZE - 1 - cell.z,
      };
      expect(toWorld(cell, 'black')).toEqual(toWorld(inverted, 'white'));
    }
  });

  it('maps the grid onto the same set of world positions for both players', () => {
    const positions = (orientation: 'white' | 'black') =>
      new Set(CELLS.map((c) => toWorld(c, orientation).join(',')));
    expect(positions('black')).toEqual(positions('white'));
  });
});
