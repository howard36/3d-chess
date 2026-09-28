import { describe, it, expect } from 'vitest';
import {
  CELLS,
  GRID_SIZE,
  TOWER_DEFAULTS,
  towerFrame,
  towerLayout,
  viewDirectionFor,
} from './layout';
import { toZXY } from '../engine/coords';

describe('CELLS', () => {
  it('covers every cell of the grid exactly once', () => {
    expect(CELLS).toHaveLength(GRID_SIZE ** 3);
    expect(new Set(CELLS.map(toZXY)).size).toBe(GRID_SIZE ** 3);
  });
});

describe('towerLayout', () => {
  const layout = towerLayout({ pitch: 1, levelGap: 1.4, pieceHeight: 0.7 });
  const frame = towerFrame(layout);

  it('gives every cell its own place', () => {
    for (const orientation of ['white', 'black'] as const) {
      const seen = new Set(CELLS.map((c) => layout.toWorld(c, orientation).join(',')));
      expect(seen.size).toBe(CELLS.length);
    }
  });

  it('stacks the levels upward, A at the bottom, a level gap in pitches apart', () => {
    for (const orientation of ['white', 'black'] as const) {
      const heights = [0, 1, 2, 3, 4].map((z) => layout.toWorld({ x: 3, y: 1, z }, orientation)[1]);
      for (let z = 1; z < 5; z++) expect(heights[z] - heights[z - 1]).toBeCloseTo(1.4);
    }
    expect(frame.gap).toBeCloseTo(1.4);
    expect(frame.pitch).toBeCloseTo(1);
    expect(frame.half).toBeCloseTo(2.5);
  });

  it('centres the stack, pieces on the top level included, on the orbit target', () => {
    const bottom = frame.levelY[0];
    const top = frame.levelY[4] + 0.7;
    expect(bottom + top).toBeCloseTo(0);
  });

  it('leaves room for the tallest piece under the next platform, and click boxes that do not overlap', () => {
    for (let z = 0; z < 4; z++) {
      expect(frame.levelY[z] + 0.7).toBeLessThan(frame.levelY[z + 1]);
    }
    expect(layout.cellSize[1]).toBeLessThan(frame.gap);
    // The box stands on its platform
    const [, y] = layout.toWorld({ x: 0, y: 0, z: 2 }, 'white');
    expect(y + layout.floorY).toBeCloseTo(frame.levelY[2]);
  });

  it("puts White's first rank nearest the camera and walks Black around the tower", () => {
    expect(layout.toWorld({ x: 0, y: 0, z: 0 }, 'white')[2]).toBeCloseTo(2);
    expect(layout.toWorld({ x: 0, y: 0, z: 0 }, 'white')[0]).toBeCloseTo(-2);
    for (const cell of CELLS) {
      const [wx, wy, wz] = layout.toWorld(cell, 'white');
      const [bx, by, bz] = layout.toWorld(cell, 'black');
      expect(bx).toBeCloseTo(-wx);
      expect(by).toBe(wy);
      expect(bz).toBeCloseTo(-wz);
    }
  });

  it('opens on a low camera turned a little off the axis, and limits the orbit', () => {
    const view = towerLayout({ elevation: 20, azimuth: 15, minElevation: 5, maxElevation: 70 });
    const [x, y, z] = view.viewDirection;
    expect(Math.hypot(x, y, z)).toBeCloseTo(1);
    expect(Math.asin(y)).toBeCloseTo((20 * Math.PI) / 180);
    expect(Math.atan2(x, z)).toBeCloseTo((15 * Math.PI) / 180);
    expect(view.orbit.minPolarAngle).toBeCloseTo((20 * Math.PI) / 180);
    expect(view.orbit.maxPolarAngle).toBeCloseTo((85 * Math.PI) / 180);
    expect(viewDirectionFor(0, 90)[0]).toBeCloseTo(1);
  });

  it('lets the orbit rise to a bird’s-eye view by default, a hair off vertical', () => {
    expect(TOWER_DEFAULTS.maxElevation).toBe(89.9);
    const min = towerLayout().orbit.minPolarAngle;
    expect(min).toBeGreaterThan(0);
    expect(min).toBeCloseTo((0.1 * Math.PI) / 180);
  });

  it('gives cells thin click boxes on their floors', () => {
    const d = towerLayout();
    expect(d.hitHeight).toBeGreaterThan(0);
    expect(d.hitHeight).toBeLessThan(0.2);
    expect(towerLayout({ hitHeight: 0.3 }).hitHeight).toBe(0.3);
  });

  it('uses its documented defaults', () => {
    const d = towerLayout();
    expect(towerFrame(d).gap).toBeCloseTo(TOWER_DEFAULTS.levelGap);
    expect(Math.asin(d.viewDirection[1])).toBeCloseTo((TOWER_DEFAULTS.elevation * Math.PI) / 180);
  });
});

describe('towerFrame', () => {
  it('measures any tower from its own cells', () => {
    const layout = towerLayout({ pitch: 1.1, levelGap: 2 });
    const frame = towerFrame(layout);
    expect(frame.pitch).toBeCloseTo(1.1);
    expect(frame.gap).toBeCloseTo(2.2);
    // Level B's platform: where a piece's base stands on it
    const [, y] = layout.toWorld({ x: 0, y: 0, z: 1 }, 'white');
    expect(frame.levelY[1]).toBeCloseTo(y + layout.floorY);
  });
});
