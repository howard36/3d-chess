import { describe, expect, it } from 'vitest';
import { CELLS, SPACING, toWorld } from '../../layout';
import { toZXY } from '../../../engine/coords';
import {
  CLARITY_TOWER_DEFAULTS,
  clarityTower,
  latticeLayout,
  towerBoardY,
  towerFrame,
  towerLayout,
  viewDirectionFor,
} from './layouts';

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

describe('clarityTower', () => {
  const layout = clarityTower({ pitch: 1, levelGap: 1.4, pieceHeight: 0.7 });
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
    const view = clarityTower({ elevation: 20, azimuth: 15, minElevation: 5, maxElevation: 70 });
    const [x, y, z] = view.viewDirection;
    expect(Math.hypot(x, y, z)).toBeCloseTo(1);
    expect(Math.asin(y)).toBeCloseTo((20 * Math.PI) / 180);
    expect(Math.atan2(x, z)).toBeCloseTo((15 * Math.PI) / 180);
    expect(view.orbit?.minPolarAngle).toBeCloseTo((20 * Math.PI) / 180);
    expect(view.orbit?.maxPolarAngle).toBeCloseTo((85 * Math.PI) / 180);
    expect(viewDirectionFor(0, 90)[0]).toBeCloseTo(1);
  });

  it('stops the orbit at 50° by default, where the levels are still readable', () => {
    expect(CLARITY_TOWER_DEFAULTS.maxElevation).toBe(50);
    expect(clarityTower().orbit?.minPolarAngle).toBeCloseTo((40 * Math.PI) / 180);
  });

  it('gives cells thin click boxes on their floors', () => {
    const d = clarityTower();
    expect(d.hitHeight).toBeGreaterThan(0);
    expect(d.hitHeight).toBeLessThan(0.2);
    expect(clarityTower({ hitHeight: 0.3 }).hitHeight).toBe(0.3);
  });

  it('uses its documented defaults', () => {
    const d = clarityTower();
    expect(towerFrame(d).gap).toBeCloseTo(CLARITY_TOWER_DEFAULTS.levelGap);
    expect(Math.asin(d.viewDirection[1])).toBeCloseTo(
      (CLARITY_TOWER_DEFAULTS.elevation * Math.PI) / 180,
    );
    expect(d.kind).toBe('tower');
  });
});

describe('towerFrame', () => {
  it('measures the classic tower layout too', () => {
    const layout = towerLayout({ spacing: 1.1, levelGap: 2 });
    const frame = towerFrame(layout);
    expect(frame.pitch).toBeCloseTo(1.1);
    expect(frame.gap).toBeCloseTo(2);
    expect(frame.levelY[1]).toBeCloseTo(towerBoardY(layout, 1));
  });
});
