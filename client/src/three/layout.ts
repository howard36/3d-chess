import { FILES } from '../engine/coords';
import type { Coord } from '../engine/coords';
import type { BoardLayout, Vec3 } from './types';

export const GRID_SIZE = FILES.length;
const HALF = (GRID_SIZE - 1) / 2;
const DEG = Math.PI / 180;

/** The seat the board is drawn for: each player sees their own army nearest. */
export type Orientation = 'white' | 'black';

/**
 * Every cell of the 5x5x5 grid, in y -> z -> x order: rank by rank, each
 * rank's levels bottom to top, each level's files left to right.
 */
export const CELLS: Coord[] = Array.from({ length: GRID_SIZE ** 3 }, (_, i) => ({
  x: i % GRID_SIZE,
  z: Math.floor(i / GRID_SIZE) % GRID_SIZE,
  y: Math.floor(i / GRID_SIZE ** 2),
}));

/** Unit direction from the board's centre toward a camera at this elevation and azimuth (degrees). */
export const viewDirectionFor = (elevationDeg: number, azimuthDeg: number): Vec3 => {
  const el = elevationDeg * DEG;
  const az = azimuthDeg * DEG;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
};

export interface TowerOptions {
  /** Distance between neighbouring cell centres on a level (world units). */
  pitch?: number;
  /** Distance between one level's platform and the next, in pitches. */
  levelGap?: number;
  /**
   * Height of the tallest piece as drawn (the Staunton king is 0.87 at a
   * piece scale of 1). Centres the tower on its visual mass, pieces included.
   */
  pieceHeight?: number;
  /** Opening camera elevation above the horizon, in degrees. */
  elevation?: number;
  /**
   * Opening camera azimuth off the players' axis, in degrees (positive swings
   * the camera to the player's right), so ranks do not stack into columns.
   */
  azimuth?: number;
  /** Lowest camera elevation the player can orbit to, in degrees. */
  minElevation?: number;
  /** Highest camera elevation the player can orbit to, in degrees. */
  maxElevation?: number;
  /** Closest the camera can zoom to the tower's centre. */
  minDistance?: number;
  /**
   * Height of each cell's click box above its floor (BoardLayout.hitHeight).
   * Thin, so a click lands on the square whose floor is under the pointer.
   */
  hitHeight?: number;
}

/**
 * A 1.35 gap keeps the stack close to a cube (diagonals between levels look
 * natural) while the pieces, at 0.8 scale, stand clear of the platform above
 * (weighed against gaps of 1.2–1.7 pitches and elevations of 12°–38°, from
 * both seats, in the opening and a busy middle game). The camera looks
 * between the levels: above about atan(gap / 4) (19° here) the back row of
 * one level interleaves on screen with the front row of the level above it,
 * so a piece at the back of A reads as standing on B; much below it (12°–14°)
 * the squares flatten into lines. 18° is the steepest view before the rows
 * interleave. The orbit goes all the way up to a bird's-eye view (89.9°, a
 * hair off vertical so the view keeps its heading), where the levels nest
 * like a 2D board seen through glass.
 */
export const TOWER_DEFAULTS = {
  pitch: 1,
  levelGap: 1.35,
  pieceHeight: 0.87 * 0.8,
  elevation: 18,
  azimuth: 16,
  minElevation: 6,
  maxElevation: 89.9,
  minDistance: 5,
  hitHeight: 0.1,
} as const satisfies Required<TowerOptions>;

/**
 * A compact 3D chess tower: five continuous platforms, A at the bottom and
 * E at the top, close enough together that the stack stays near a cube and
 * diagonals look natural, seen from a low, slightly turned camera that looks
 * between the levels rather than down through them. Rank 1 is nearest
 * White; Black walks around the tower (files and ranks flip, levels stay).
 * The orbit is limited so the camera never dips under the bottom platform;
 * it may rise to look straight down the stack.
 *
 * A cell's click box is a thin slab on its square (`hitHeight`): a taller
 * box is entered by rays aimed at the square behind it, so a click on one
 * floor marker could land on the square in front. Cell centres (and so
 * `floorY` and MarkerProps.floor) are still half the level's lower part up.
 */
export const towerLayout = (options: TowerOptions = {}): BoardLayout => {
  const o = { ...TOWER_DEFAULTS, ...options };
  const gap = o.levelGap * o.pitch;
  const boxHeight = Math.min(gap * 0.6, 1);
  // Platforms sit so the whole stack, pieces on the top level included, is
  // centred on the origin (the orbit target).
  const levelY = (z: number) => (z - HALF) * gap - o.pieceHeight / 2;
  const half = HALF * o.pitch;
  return {
    toWorld: ({ x, y, z }: Coord, orientation: Orientation): Vec3 => {
      const fx = orientation === 'white' ? x : GRID_SIZE - 1 - x;
      const fy = orientation === 'white' ? y : GRID_SIZE - 1 - y;
      return [(fx - HALF) * o.pitch, levelY(z) + boxHeight / 2, (HALF - fy) * o.pitch];
    },
    floorY: -boxHeight / 2,
    cellSize: [o.pitch * 0.98, boxHeight, o.pitch * 0.98],
    hitHeight: o.hitHeight,
    // Framed with room for the coordinate labels just outside the platforms
    halfExtents: [
      half + o.pitch * 0.5 + 0.3,
      (HALF * 2 * gap + o.pieceHeight) / 2 + 0.1,
      half + o.pitch * 0.5 + 0.3,
    ],
    viewDirection: viewDirectionFor(o.elevation, o.azimuth),
    orbit: {
      minPolarAngle: (90 - o.maxElevation) * DEG,
      maxPolarAngle: (90 - o.minElevation) * DEG,
      minDistance: o.minDistance,
    },
  };
};

/** The measurements of a tower layout that its platforms and labels are built from. */
export interface TowerFrame {
  /** Distance between neighbouring cell centres on a level. */
  pitch: number;
  /** Vertical distance between neighbouring levels. */
  gap: number;
  /** Half the side of a level's platform (the outer edge of its outer squares). */
  half: number;
  /** World height of each level's surface, A (index 0) to E. */
  levelY: number[];
}

/** Measures a tower layout from its own cell positions. */
export const towerFrame = (layout: BoardLayout): TowerFrame => {
  const at = (x: number, z: number) => layout.toWorld({ x, y: 0, z }, 'white');
  const pitch = at(1, 0)[0] - at(0, 0)[0];
  const levelY = [0, 1, 2, 3, 4].map((z) => at(0, z)[1] + layout.floorY);
  return { pitch, gap: levelY[1] - levelY[0], half: (GRID_SIZE / 2) * pitch, levelY };
};
