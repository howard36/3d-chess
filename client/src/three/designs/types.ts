import type { ComponentType } from 'react';
import type { ToneMapping } from 'three';
import type { Coord } from '../../engine/coords';
import type { PieceType } from '../../engine/pieces';
import type { Orientation } from '../layout';
import type { KnightMoves } from '../movePath';
import type { SettingSpec, SettingValues } from './settings';

// A design is the whole look of the game: where the cells sit in the scene,
// what is drawn around them, what the pieces are made of, how moves and
// captures play out, and how the HUD is dressed. Board.tsx keeps every rule
// about what may be clicked; a design only decides how things look.

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

/** Where the 125 cells sit in world space. */
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

export interface MarkerProps {
  /** The cell's centre. */
  centre: Vec3;
  /** The floor of the cell, where a piece's base sits. */
  floor: Vec3;
  /**
   * The pointer is over this legal destination (or the piece it would
   * capture). Set for destinations only.
   */
  hovered?: boolean;
  /**
   * Check only: the check is mate (the game is over and this king has lost),
   * so a design can settle its check marker while the king topples.
   */
  mated?: boolean;
}

export interface LastMoveMarkerProps {
  from: MarkerProps;
  to: MarkerProps;
  /**
   * The move arrived live while this board was up (it animates), rather than
   * being replayed from history or on a rejoin. Board keys the component by
   * move, so an entrance played on mount when `fresh` plays once per move
   * and never again on a reconnect. Board always sets it; optional only so a
   * design's own wrappers need not pass it on.
   */
  fresh?: boolean;
  /**
   * Height of the move's arc above the straight line between the two floors
   * (world units): 0 for every move but a knight's when the player has
   * knights arc. Pass it to the kit's line (`tracePath`, `LastMoveLine`) so
   * the line follows exactly the path the piece took. Board always sets it.
   */
  arc?: number;
}

export interface CaptureFxProps {
  /** The seat the board is drawn for (Black's view walks round the board). */
  orientation: Orientation;
  /** The yaw Board gives a knight of the victim's colour, so a redrawn knight faces the same way. */
  victimFacing?: number;
  /** Floor of the cell where the capture happened. */
  floor: Vec3;
  centre: Vec3;
  victim: { type: PieceType; color: PieceColor };
  durationMs: number;
}

export interface CelebrationProps {
  /** The seat the board is drawn for (Black's view walks round the board). */
  orientation: Orientation;
  /** Floor of the mated king's cell. */
  floor: Vec3;
  winner: PieceColor | null;
}

/**
 * Levels (engine z, 0 = A) the player is attending to. `selected` is the
 * selected piece's level; `hovered` is the level of the cell or piece under
 * the pointer. Hover wins over selection: see `focusLevelOf` in kit/focus.ts.
 */
export interface LevelFocus {
  selected: number | null;
  hovered: number | null;
}

export interface GridProps {
  layout: BoardLayout;
  orientation: Orientation;
  /** Which level to emphasise (Board always passes it; optional for other callers). */
  focus?: LevelFocus;
}

export interface StageProps {
  layout: BoardLayout;
  orientation: Orientation;
}

export interface DesignMotion {
  /**
   * How long a move's glide takes. Every move glides in a straight line from
   * the source square to the destination, eased in and out, whatever the
   * level change (a knight arcs instead when the player sets knight moves to
   * 'arc'; see movePath.ts).
   */
  durationMs: number;
}

/**
 * CSS custom properties the HUD reads. Every one has a fallback matching the
 * classic look, so a design sets only what it changes.
 */
export type HudVars = Partial<
  Record<
    | '--hud-font'
    | '--hud-mono'
    | '--hud-bg'
    | '--hud-fg'
    | '--hud-muted'
    | '--hud-accent'
    | '--hud-accent-fg'
    | '--hud-border'
    | '--hud-radius'
    | '--hud-shadow'
    | '--hud-blur'
    | '--hud-case'
    | '--hud-tracking'
    | '--turn-bg'
    | '--turn-fg'
    | '--turn-size'
    // The turn chip's own face and weight (default: --hud-font, 600)
    | '--turn-font'
    | '--turn-weight'
    | '--turn-border'
    | '--turn-shadow'
    | '--modal-radius'
    | '--modal-shadow'
    | '--button-bg'
    | '--button-fg'
    | '--button-border'
    | '--button-radius'
    | '--modal-bg'
    | '--modal-fg'
    | '--modal-backdrop'
    // The result card only (the promotion dialog keeps --modal-bg)
    | '--result-bg'
    | '--result-title-size'
    | '--page-bg'
    | '--page-fg',
    string
  >
>;

export interface DesignHud {
  vars: HudVars;
}

export interface CanvasSettings {
  fov: number;
  toneMapping: ToneMapping;
  exposure: number;
}

export interface Design {
  id: string;
  name: string;
  layout: BoardLayout;
  canvas: CanvasSettings;
  /** Background, lights, fog, environment, ambient effects. */
  Stage: ComponentType<StageProps>;
  /** The visible structure of the board. Decorative: never takes pointer events. */
  Grid: ComponentType<GridProps>;
  PieceBody: ComponentType<PieceBodyProps>;
  /** How far a knight turns off the rank line, so its profile shows. */
  knightYaw: number;
  markers: {
    Quiet: ComponentType<MarkerProps>;
    Capture: ComponentType<MarkerProps>;
    Selection: ComponentType<MarkerProps>;
    LastMove: ComponentType<LastMoveMarkerProps>;
    /** Drawn at the king of the side in check. */
    Check: ComponentType<MarkerProps>;
  };
  motion: DesignMotion;
  /**
   * How knights travel, from the player's settings: 'straight' like every
   * other piece, or over an arc (see movePath.ts). The glide, the last-move
   * line and the move's effects all follow it.
   */
  knightMoves: (settings: SettingValues) => KnightMoves;
  /** Replaces a captured piece as the capturer arrives. */
  CaptureFx: ComponentType<CaptureFxProps>;
  /** Shown around the mated king once the game ends (he topples too). */
  Celebration: ComponentType<CelebrationProps>;
  /**
   * How long the result card waits after a mate played live, so the mate
   * animation plays out first, from the player's settings.
   */
  resultDelayMs: (settings: SettingValues) => number;
  /**
   * How far a piece the player may pick up rises off its floor when the
   * pointer is on it, and the selected piece higher, from the player's
   * settings.
   */
  hoverLift: (settings: SettingValues) => PieceLift;
  /**
   * Uniform scale of every piece about its base. Staunton pieces stand up to
   * 0.87 tall at 1; the compact tower wants them shorter.
   */
  pieceScale: number;
  hud: DesignHud;
  /**
   * Visual settings the player may adjust in the settings panel, each with
   * the design's chosen default. Read them with useDesignSetting (settings.ts).
   */
  settings: SettingSpec[];
}

/** How Board lifts pieces (Design.hoverLift). Heights are in piece units (before `pieceScale`). */
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
   * The same for a rise to the selected height or a fall from it (so
   * hover to held and back both take it).
   */
  selectSeconds: number;
}
