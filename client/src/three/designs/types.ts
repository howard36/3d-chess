import type { ComponentType, CSSProperties } from 'react';
import type { Material, ToneMapping } from 'three';
import type { Coord } from '../../engine/coords';
import type { PieceType } from '../../engine/pieces';
import type { Orientation } from '../layout';

// A design is the whole look of the game: where the cells sit in the scene,
// what is drawn around them, what the pieces are made of, how moves and
// captures play out, and how the HUD is dressed. Board.tsx keeps every rule
// about what may be clicked; a design only decides how things look.

export type Vec3 = [number, number, number];
export type PieceColor = 'white' | 'black';

/**
 * Limits on how far the player may orbit and zoom, applied to the game's
 * OrbitControls. Angles are polar angles in radians, measured from straight
 * overhead (0) down to the horizon (PI / 2) and below.
 */
export interface OrbitLimits {
  minPolarAngle?: number;
  maxPolarAngle?: number;
  minDistance?: number;
  maxDistance?: number;
}

/** Where the 125 cells sit in world space. */
export interface BoardLayout {
  /**
   * Both stack the levels upward. Lattice: one cube of evenly spaced cells.
   * Tower: five boards with gaps between them.
   */
  kind: 'lattice' | 'tower';
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
  /** Orbit and zoom limits; without them the camera orbits freely (6 units in at most). */
  orbit?: OrbitLimits;
  /**
   * Height of each cell's click box, standing on the cell's floor. Without it
   * the box fills `cellSize` about the cell's centre. A thin box makes a
   * click land on the square whose floor is under the pointer, so markers
   * drawn on the floor are exactly what a click aims at.
   */
  hitHeight?: number;
}

export interface PieceBodyProps {
  /** The seat the board is drawn for (Black's view walks round the board). */
  orientation: Orientation;
  type: PieceType;
  color: PieceColor;
  /** Emissive tint the classic body paints (check red, selection amber, or black). */
  emissive: string | number;
  selected: boolean;
  /** The pointer is over a piece the player may pick up. */
  hovered: boolean;
  /** This is a king and its side is in check. */
  inCheck: boolean;
  /**
   * The level (engine z, 0 = A) of the cell the piece stands on. Board always
   * sets it; optional only so a design that draws a body itself (a captured
   * victim, a celebration) need not.
   */
  level?: number;
}

export interface MarkerProps {
  /** The cell's centre. */
  centre: Vec3;
  /** The floor of the cell, where a piece's base sits. */
  floor: Vec3;
  /**
   * The pointer is over this legal destination (or the piece it would
   * capture). Only set for designs with `hoverDestinations`.
   */
  hovered?: boolean;
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

export interface MoveFxProps {
  /** The seat the board is drawn for (Black's view walks round the board). */
  orientation: Orientation;
  from: Vec3;
  to: Vec3;
  /** Colour of the side that moved. */
  color: PieceColor;
  piece: PieceType;
  capture: boolean;
  durationMs: number;
  /**
   * Height of the move's arc above the straight line from `from` to `to`
   * (world units; see LastMoveMarkerProps.arc). The piece travels along
   * `movePoint(from, to, easeInOutCubic(t), arc)` (movePath.ts); a trail
   * that follows it should too. Board always sets it.
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
 * the pointer, reported only for designs with `hoverDestinations` or
 * `hud.readout` (null otherwise). Hover wins over selection: see
 * `focusLevelOf` in kit/focus.ts.
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

/**
 * How a move plays out. Every style but 'teleport' glides in a straight line
 * from the source square to the destination, eased in and out, whatever the
 * level change (a knight arcs instead when the player sets knight moves to
 * 'arc'; see movePath.ts).
 */
export type MoveStyle =
  /** A plain eased glide (classic). */
  | 'hop'
  /** A glide that stretches as it travels and lands with a squash-and-stretch bounce. */
  | 'bounce'
  /** A plain eased glide (the same as 'hop'). */
  | 'slide'
  /** Shrinks away at the source and pops in at the destination. */
  | 'teleport';

export interface DesignMotion {
  style: MoveStyle;
  durationMs: number;
  /**
   * Unused by Board: moves no longer lift (a knight's arc, when the player
   * asks for one, is the same height in every design). Kept so a design can
   * size its own effects by it.
   */
  lift?: number;
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
  /** Extra layer drawn over the canvas under the HUD (scanlines, vignette, grain). */
  overlay?: CSSProperties;
  /**
   * Show a small readout of the cell under the pointer ("Cc4 · White Bishop")
   * under the turn indicator, styled with the HUD vars.
   */
  readout?: boolean;
}

export interface CanvasSettings {
  fov?: number;
  toneMapping?: ToneMapping;
  exposure?: number;
  /** Real-time shadows (the design's lights and meshes opt in). */
  shadows?: boolean;
  /** Device pixel ratio cap; below 1 renders chunky pixels (paired with `pixelated`). */
  dpr?: number | [number, number];
  /** Upscale the canvas with nearest-neighbour sampling. */
  pixelated?: boolean;
  antialias?: boolean;
}

export interface Design {
  id: string;
  name: string;
  /** One line on the idea, shown in the picker. */
  blurb: string;
  layout: BoardLayout;
  /**
   * Render every frame instead of on demand, for designs with ambient
   * motion (drifting particles, shimmering materials).
   */
  continuous: boolean;
  canvas?: CanvasSettings;
  /** Background, lights, fog, environment, ambient effects, post-processing. */
  Stage: ComponentType<StageProps>;
  /** The visible structure of the board. Decorative: never takes pointer events. */
  Grid: ComponentType<GridProps>;
  /**
   * Fills of the raycast boxes: legal destinations and the last move's cells.
   * `null` draws no fill at all (the cell still takes clicks), for designs
   * whose markers say everything on the floor.
   */
  cellFills: { destination: Material | null; lastMove: Material | null };
  PieceBody: ComponentType<PieceBodyProps>;
  /** Knight yaw per colour, so its profile faces the camera. */
  knightYaw?: number;
  markers: {
    Quiet: ComponentType<MarkerProps>;
    Capture: ComponentType<MarkerProps>;
    Selection: ComponentType<MarkerProps>;
    /** Drawn in addition to the last-move cell fills. */
    LastMove?: ComponentType<LastMoveMarkerProps>;
    /** Drawn at the king of the side in check. */
    Check?: ComponentType<MarkerProps>;
  };
  motion: DesignMotion;
  /** Plays alongside a new move's glide (trails, dust, sparks). */
  MoveFx?: ComponentType<MoveFxProps>;
  /** Replaces the classic fade-out of a captured piece. */
  CaptureFx?: ComponentType<CaptureFxProps>;
  /** Shown around the mated king once the game ends. */
  Celebration?: ComponentType<CelebrationProps>;
  /** Tip the mated king over when the game ends. */
  toppleMatedKing?: boolean;
  /**
   * Lift a piece the player may pick up off its floor when the pointer is on
   * it, and the selected piece higher. `true` takes the kit's heights and
   * holds the selected piece still; a PieceLift sets the heights and, if
   * wanted, a gentle bob while selected. Leave it off to stage hover and
   * selection in the piece body instead (PieceBodyProps.hovered, .selected).
   */
  hoverLift?: boolean | PieceLift;
  /**
   * Track the pointer over legal destinations, so the Quiet and Capture
   * markers get `hovered` and can brighten under it.
   */
  hoverDestinations?: boolean;
  /**
   * Uniform scale of every piece about its base (default 1). Staunton
   * pieces stand up to 0.87 tall at 1; a compact tower wants them shorter.
   */
  pieceScale?: number;
  hud: DesignHud;
}

/**
 * How Board lifts pieces (Design.hoverLift). Heights are in piece units
 * (before `pieceScale`).
 */
export interface PieceLift {
  /** Under the pointer (default 0.08). */
  hover?: number;
  /** Selected (default 0.2). */
  selected?: number;
  /**
   * How far the selected piece bobs up and down while held (default 0:
   * still). The round-2 designs use SELECTION_BOB from kit/motion.
   */
  bob?: number;
}

/** Picker sections, listed in this order (see DESIGN_GROUPS in registry.ts). */
export type DesignGroup = 'round4' | 'round3' | 'clarity' | 'classic' | 'earlier';

export interface DesignEntry {
  id: string;
  name: string;
  blurb: string;
  /** Swatch colours for the picker: background, white army, black army, accent. */
  swatch: [string, string, string, string];
  load: () => Promise<{ default: Design }>;
  /** The picker section it is listed under (ungrouped entries come last). */
  group?: DesignGroup;
  /** Left out of the picker; still reachable with `?design=<id>` (dev references). */
  hidden?: boolean;
}
