import { useFrame } from '@react-three/fiber';

// Small pieces of state the design's parts share with each other, outside
// React (read in frame loops and shaders).

/**
 * How close the view is to straight down: 0 below 55° of elevation, 1 from
 * 65°. Shaders on the board read it to quiet decoration, and to let the
 * selection show through pieces stacked above it.
 */
export const steep = { value: 0 };

/** How far the view is tilted toward straight down, 0–1, between two elevations (degrees). */
export const elevationOf = (p: { x: number; y: number; z: number }) =>
  Math.atan2(p.y, Math.hypot(p.x, p.z)) * (180 / Math.PI);

const ramp = (x: number, a: number, b: number) => Math.min(Math.max((x - a) / (b - a), 0), 1);

/** Keeps `steep` up to date; mount once (the Grid does). */
export const useSteep = () =>
  useFrame(({ camera }) => {
    const t = ramp(elevationOf(camera.position), 55, 65);
    steep.value = t * t * (3 - 2 * t);
  });

/**
 * The held piece: where it stands (x, z) and how tall it is (world units,
 * lift included), so the selection's ribbon fits it and a destination
 * straight above or below it can grow out from under it.
 */
export const held = { x: NaN, z: NaN, top: 0.7 };

/** Pieces are drawn at this scale, so the king clears the platform above. */
export const PIECE_SCALE = 0.8;

/**
 * How far a piece rises under the pointer and when held (piece units). Kept
 * small: at the opening view a bigger lift detaches the piece from its pool
 * and it seems to float a rank back.
 */
export const LIFT = { hover: 0.05, selected: 0.08 };
