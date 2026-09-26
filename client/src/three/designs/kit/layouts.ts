import { GRID_SIZE, SPACING, CELL_FLOOR_Y, toWorld } from '../../layout';
import type { Orientation } from '../../layout';
import type { Coord } from '../../../engine/coords';
import type { BoardLayout, Vec3 } from '../types';

const HALF = (GRID_SIZE - 1) / 2;

/**
 * The classic lattice: files across, ranks up the screen, levels receding
 * into depth (see toWorld in layout.ts). `spacing` widens the gaps between
 * cells for designs that want the pieces to breathe.
 */
export const latticeLayout = (spacing = SPACING): BoardLayout => {
  const scale = spacing / SPACING;
  const half = HALF * spacing + 0.5;
  return {
    kind: 'lattice',
    toWorld: (cell: Coord, orientation: Orientation): Vec3 => {
      const [x, y, z] = toWorld(cell, orientation);
      return [x * scale, y * scale, z * scale];
    },
    floorY: CELL_FLOOR_Y,
    cellSize: [1, 1, 1],
    halfExtents: [half, half, half],
    viewDirection: [6.5, 5, 8.5],
  };
};

/**
 * Five boards stacked like a Raumschach set: files across, ranks running
 * away from the player, levels stacked upward (A at the bottom). Seen from
 * Black's side the tower is walked around rather than turned upside down,
 * so files and ranks flip but the levels stay put: Black's army starts on
 * the top two boards, nearest the camera.
 *
 * A cell is the space above one square of its board; its centre sits half a
 * unit above the board so pieces stand on the board surface.
 */
export const towerLayout = ({
  spacing = 1.05,
  levelGap = 1.9,
  viewDirection = [0.15, 0.62, 1] as Vec3,
} = {}): BoardLayout => ({
  kind: 'tower',
  toWorld: ({ x, y, z }: Coord, orientation: Orientation): Vec3 => {
    const fx = orientation === 'white' ? x : GRID_SIZE - 1 - x;
    const fy = orientation === 'white' ? y : GRID_SIZE - 1 - y;
    return [(fx - HALF) * spacing, (z - HALF) * levelGap, (HALF - fy) * spacing];
  },
  floorY: CELL_FLOOR_Y,
  cellSize: [spacing * 0.98, 1, spacing * 0.98],
  halfExtents: [HALF * spacing + 0.55, HALF * levelGap + 0.6, HALF * spacing + 0.55],
  viewDirection,
});

/** World height of the board surface of level `z` in a tower layout. */
export const towerBoardY = (layout: BoardLayout, z: number): number =>
  layout.toWorld({ x: 0, y: 0, z }, 'white')[1] + layout.floorY;
