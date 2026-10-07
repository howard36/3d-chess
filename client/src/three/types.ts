import type { Coord } from '../engine/coords';
import type { PieceType } from '../engine/pieces';
import type { FrameRing } from './cameraFit';
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
interface OrbitLimits {
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
   * What the camera's framing keeps in view from every side: circles about
   * the board's vertical axis round its platforms, pieces and labels
   * (towerFrameRings in scene/labelAnchors.ts), which look the same however
   * the view has turned, so turning never moves the framing (FitCameraToBoard).
   * Without them, the rings round the halfExtents box.
   */
  frameRings?: readonly FrameRing[];
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
  /**
   * When the piece arrives in the game's entrance, in seconds after the
   * first (intro/timeline.ts, pieceArrival); 0 when unset. Outside the
   * entrance the piece is simply there.
   */
  arrival?: number;
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
   * The player is attending to another level (`focusLevelOf`): step back
   * with this one's glass. Set for destinations only.
   */
  dim?: boolean;
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
  /** How long the moving piece takes to land (ms): a fresh mark's entrance follows it. */
  glideMs?: number;
}

export interface CaptureFxProps {
  /** The seat the board is drawn for (Black's view walks round the board). */
  orientation: Orientation;
  /** The yaw Board gives a knight of the victim's colour, so a redrawn knight faces the same way. */
  victimFacing?: number;
  /** Floor of the cell where the capture happened. */
  floor: Vec3;
  victim: { type: PieceType; color: PieceColor };
  /** When the attacker reaches the victim (ms after the move arrived): the hit. */
  hitMs: number;
  /** When the attacker comes to rest. */
  landMs: number;
  /** Which way the attacker was going across the board (unit x, z), or null for straight up or down. */
  heading?: [number, number] | null;
}

export interface CelebrationProps {
  /** Floor of the mated king's cell. */
  floor: Vec3;
  /** Wait this long before the pulse leaves (ms): the king strikes the floor then. */
  delayMs?: number;
  /** How fast the pulse spreads (world units a second). */
  speed?: number;
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
  /** Whether to draw the coordinate labels (on by default). */
  labels?: boolean;
}

export interface StageProps {
  orientation: Orientation;
}
