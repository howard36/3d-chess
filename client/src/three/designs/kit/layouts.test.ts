import { describe, expect, it } from 'vitest';
import { CELLS, SPACING, toWorld } from '../../layout';
import { toZXY } from '../../../engine/coords';
import { latticeLayout, towerBoardY, towerLayout } from './layouts';

describe('latticeLayout', () => {
  it('is the classic toWorld at the classic spacing', () => {
    const layout = latticeLayout();
    for (const cell of CELLS) {
      expect(layout.toWorld(cell, 'white')).toEqual(toWorld(cell, 'white'));
      expect(layout.toWorld(cell, 'black')).toEqual(toWorld(cell, 'black'));
    }
  });

  it('scales every position with a wider spacing', () => {
    const wide = latticeLayout(SPACING * 2);
    const [x, y, z] = toWorld({ x: 0, y: 0, z: 0 }, 'white');
    expect(wide.toWorld({ x: 0, y: 0, z: 0 }, 'white')).toEqual([x * 2, y * 2, z * 2]);
  });
});

describe('towerLayout', () => {
  const layout = towerLayout({ spacing: 1, levelGap: 2 });

  it('gives every cell its own place', () => {
    for (const orientation of ['white', 'black'] as const) {
      const seen = new Set(CELLS.map((c) => layout.toWorld(c, orientation).join(',')));
      expect(seen.size).toBe(CELLS.length);
    }
  });

  it('stacks the levels upward, A at the bottom, for both players', () => {
    for (const orientation of ['white', 'black'] as const) {
      const heights = [0, 1, 2, 3, 4].map((z) => layout.toWorld({ x: 1, y: 1, z }, orientation)[1]);
      expect(heights).toEqual([-4, -2, 0, 2, 4]);
    }
  });

  it("puts White's first rank nearest the camera, files left to right", () => {
    // Aa1 near-left, Ae5 far-right on the bottom board
    expect(layout.toWorld({ x: 0, y: 0, z: 0 }, 'white')).toEqual([-2, -4, 2]);
    expect(layout.toWorld({ x: 4, y: 4, z: 0 }, 'white')).toEqual([2, -4, -2]);
  });

  it('walks Black around the tower rather than turning it upside down', () => {
    for (const cell of CELLS) {
      const [wx, wy, wz] = layout.toWorld(cell, 'white');
      const [bx, by, bz] = layout.toWorld(cell, 'black');
      // A half turn about the vertical axis: x and z negate, height stays
      expect(bx).toBeCloseTo(-wx);
      expect(by).toBe(wy);
      expect(bz).toBeCloseTo(-wz);
    }
    // Black's back rank (5) is nearest Black's camera
    expect(layout.toWorld({ x: 2, y: 4, z: 4 }, 'black')[2]).toBe(2);
  });

  it('seats pieces on the board surface of their level', () => {
    const cell = { x: 3, y: 2, z: 1 };
    const [, y] = layout.toWorld(cell, 'white');
    expect(y + layout.floorY).toBe(towerBoardY(layout, 1));
    expect(toZXY(cell)).toBe('Bd3');
  });

  it('frames a box as tall as the stack', () => {
    const [hx, hy, hz] = layout.halfExtents;
    expect(hy).toBeGreaterThan(4);
    expect(hx).toBe(hz);
  });
});
