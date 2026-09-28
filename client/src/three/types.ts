import type { Coord } from '../engine/coords';
import type { PieceType } from '../engine/pieces';
import type { Orientation } from './layout';

// Shapes shared by the board (Board.tsx, which keeps every rule about what
// may be clicked) and the scene it draws (scene/: the pieces' bodies, the
// markers, the effects), which only decides how things look.

export type Vec3 = [number, number, number];
export type PieceColor = 'white' | 'black';

/**
 * Limits on how far the player may orbit and zoom, applied to the game's
 * camera controls. Angles are polar angles in radians, measured from straight
 * overhead (0) down to the horizon (PI / 2) and below. The distance only
 * narrows the zoom range, 0.7x to 1.5x the distance that fits the board in
 * the window (zoomRange in three/cameraFit.ts).
 */
export interface OrbitLimits {
  minPolarAngle: number;
  maxPolarAngle: number;
  minDistance: number;
}

/** Where the 125 cells sit in world space (towerLayout in layout.ts). */
export interface BoardLayout {
  /** Centre of a cell's (raycast) box. */
  toWorld(cell: Coord, orientation: Orientation): Vec3;
  /**
   * Cell-local height of the floor a piece stands on. Pieces are modeled
   * base-at-y=0; PieceMesh drops them by this much.
   */
  floorY: number;
  /** Size of each cell's raycast box. */
  cellSize: Vec3;
  /** Half the board's bounding box, for framing the camera. */
  halfExtents: Vec3;
  /**
   * What the camera's framing keeps in view, seen from a camera at `eye`
   * looking at the board's centre: the board's own outline and the labels
   * standing outside it (towerFramePoints in scene/labelAnchors.ts).
   * Without it, the halfExtents box.
   */
  framePoints?: (eye: Vec3) => Vec3[];
  /** Direction from the board's centre to the camera when a game opens. */
  viewDirection: Vec3;
  /** Orbit and zoom limits. */
  orbit: OrbitLimits;
  /**
   * Height of each cell's click box, standing on the cell's floor. A thin box
   * makes a click land on the square whose floor is under the pointer, so
   * markers drawn on the floor are exactly what a click aims at.
   */
  hitHeight: number;
}

export interface PieceBodyProps {
  type: PieceType;
  color: PieceColor;
  selected: boolean;
  /** The pointer is over a piece the player may pick up. */
  hovered: boolean;
  /** This is a king and its side is in check. */
  inCheck: boolean;
  /** The level (engine z, 0 = A) of the cell the piece stands on. */
  level: number;
}

/**
 * How far a piece rises off its floor, and how quickly. Heights are in piece
 * units (before the pieces' scale).
 */
export interface PieceLift {
  /** Under the pointer. */
  hover: number;
  /** Selected. */
  selected: number;
  /**
   * Seconds a piece takes to rise to its hover height or settle from it,
   * setting off at once and slowing into the target without passing it.
   */
  hoverSeconds: number;
  /**
   * The same for a rise to the selected height or a fall from it (so hover
   * to held and back both take it).
   */
  selectSeconds: number;
}

export interface MarkerProps {
  /** The floor of the cell, where a piece's base sits. */
  floor: Vec3;
  /**
   * The pointer is over this legal destination (or the piece it would
   * capture). Set for destinations only.
   */
  hovered?: boolean;
  /**
   * Check only: the check is mate (the game is over and this king has lost),
   * so the check marker can settle while the king topples.
   */
  mated?: boolean;
}

export interface LastMoveMarkerProps {
  from: MarkerProps;
  to: MarkerProps;
  /**
   * The move arrived live while this board was up (it animates), rather than
   * being replayed from history or on a rejoin. Board keys the marker by
   * move, so an entrance played on mount when `fresh` plays once per move
   * and never again on a reconnect.
   */
  fresh: boolean;
  /**
   * Height of the move's arc above the straight line between the two floors
   * (world units): 0 for every move but a knight's when the player has
   * knights arc. The line follows exactly the path the piece took.
   */
  arc: number;
}

export interface CaptureFxProps {
  /** The seat the board is drawn for (Black's view walks round the board). */
  orientation: Orientation;
  /** The yaw Board gives a knight of the victim's colour, so a redrawn knight faces the same way. */
  victimFacing?: number;
  /** Floor of the cell where the capture happened. */
  floor: Vec3;
  victim: { type: PieceType; color: PieceColor };
  durationMs: number;
}

export interface CelebrationProps {
  /** Floor of the mated king's cell. */
  floor: Vec3;
}

/**
 * Levels (engine z, 0 = A) the player is attending to. `selected` is the
 * selected piece's level; `hovered` is the level of the cell or piece under
 * the pointer. Hover wins over selection: see `focusLevelOf` in scene/focus.ts.
 */
export interface LevelFocus {
  selected: number | null;
  hovered: number | null;
}

export interface GridProps {
  layout: BoardLayout;
  orientation: Orientation;
  /** Which level to emphasise. */
  focus: LevelFocus;
}

export interface StageProps {
  orientation: Orientation;
}
