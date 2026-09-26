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

/** Where the 125 cells sit in world space. */
export interface BoardLayout {
  /** Lattice: levels recede into depth. Tower: levels stack upward. */
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
}

export interface PieceBodyProps {
  type: PieceType;
  color: PieceColor;
  /** Emissive tint the classic body paints (check red, selection amber, or black). */
  emissive: string | number;
  selected: boolean;
  /** The pointer is over a piece the player may pick up. */
  hovered: boolean;
  /** This is a king and its side is in check. */
  inCheck: boolean;
}

export interface MarkerProps {
  /** The cell's centre. */
  centre: Vec3;
  /** The floor of the cell, where a piece's base sits. */
  floor: Vec3;
}

export interface LastMoveMarkerProps {
  from: MarkerProps;
  to: MarkerProps;
}

export interface MoveFxProps {
  from: Vec3;
  to: Vec3;
  /** Colour of the side that moved. */
  color: PieceColor;
  piece: PieceType;
  capture: boolean;
  durationMs: number;
}

export interface CaptureFxProps {
  /** Floor of the cell where the capture happened. */
  floor: Vec3;
  centre: Vec3;
  victim: { type: PieceType; color: PieceColor };
  durationMs: number;
}

export interface CelebrationProps {
  /** Floor of the mated king's cell. */
  floor: Vec3;
  winner: PieceColor | null;
}

export interface GridProps {
  layout: BoardLayout;
  orientation: Orientation;
}

export interface StageProps {
  layout: BoardLayout;
  orientation: Orientation;
}

export type MoveStyle =
  /** A parabolic lift from source to destination (classic). */
  | 'hop'
  /** A higher arc that lands with a squash-and-stretch bounce. */
  | 'bounce'
  /** Straight line, fast out and eased in, no lift. */
  | 'slide'
  /** Shrinks away at the source and pops in at the destination. */
  | 'teleport';

export interface DesignMotion {
  style: MoveStyle;
  durationMs: number;
  /** Peak height of the lift, world units ('hop' and 'bounce'). */
  lift: number;
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
    | '--page-bg'
    | '--page-fg',
    string
  >
>;

export interface DesignHud {
  vars: HudVars;
  /** Extra layer drawn over the canvas under the HUD (scanlines, vignette, grain). */
  overlay?: CSSProperties;
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
  /** Fills of the raycast boxes: legal destinations and the last move's cells. */
  cellFills: { destination: Material; lastMove: Material };
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
  /** Lift a piece under the pointer / the selected piece off its floor. */
  hoverLift?: boolean;
  hud: DesignHud;
}

export interface DesignEntry {
  id: string;
  name: string;
  blurb: string;
  /** Swatch colours for the picker: background, white army, black army, accent. */
  swatch: [string, string, string, string];
  load: () => Promise<{ default: Design }>;
}
