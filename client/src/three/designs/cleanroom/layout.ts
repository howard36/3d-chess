import { clarityTower, towerFrame } from '../kit/layouts';
import type { BoardLayout } from '../types';

// The tower: the kit's compact stack, standing in a tool bay. Pieces are
// scaled so the king clears the tray above. The camera may zoom out only so
// far that it stays well inside the room.

export const PIECE_SCALE = 0.8;

const tower = clarityTower({ pieceHeight: 0.87 * PIECE_SCALE });

export const layout: BoardLayout = {
  ...tower,
  orbit: { ...tower.orbit, maxDistance: 21 },
};

export const frame = towerFrame(layout);
export const { pitch } = frame;

/** How far each tray reaches past its outer squares. */
export const TRAY_MARGIN = 0.1;
/** Half the side of a tray, rim included. */
export const TRAY_HALF = frame.half + TRAY_MARGIN;

/** The lab floor, well below the bottom tray. */
export const FLOOR_Y = frame.levelY[0] - 1.55;
/** Top of the tool's base (the chuck the stack stands on). */
export const BASE_TOP = frame.levelY[0] - 0.95;
/** Half the side of the room (walls). */
export const ROOM_HALF = 30;
/** Height of the ceiling above the floor. */
export const ROOM_HEIGHT = 15;

/** The level (0 = A) whose tray is at this world height (a floor's y). */
export const levelAt = (y: number): number =>
  Math.max(
    0,
    Math.min(
      frame.levelY.length - 1,
      Math.round((y - frame.levelY[0]) / Math.max(frame.gap, 1e-3)),
    ),
  );
