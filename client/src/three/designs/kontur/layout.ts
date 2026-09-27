import { clarityTower, towerFrame } from '../kit/layouts';

// Kontur keeps the kit's compact tower (1.35 gap, 18° opening camera): its
// flat, near-orthographic lens (see the canvas fov) already shows every
// level from almost the same angle, so no level gets flattened. The pieces
// are built at their final size (pieceScale 1); the king is the tallest.

export const PIECE_HEIGHT = 0.74;

export const layout = clarityTower({ pieceHeight: PIECE_HEIGHT });
export const frame = towerFrame(layout);
export const { pitch } = frame;

/** Height of the highest platform at or below world height `y`. */
export const floorBelow = (y: number): number => {
  let floor = frame.levelY[0];
  for (const level of frame.levelY) if (level <= y + 0.02) floor = level;
  return floor;
};

/** The level (0 = A) whose platform is nearest world height `y`. */
export const levelAt = (y: number): number => {
  let best = 0;
  frame.levelY.forEach((level, z) => {
    if (Math.abs(level - y) < Math.abs(frame.levelY[best] - y)) best = z;
  });
  return best;
};
