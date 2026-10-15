/**
 * What Stage hands each area of garden detail (boardDetail, court, horizon):
 * the board's turn for the seat (1 white, -1 black), and how far the lobby
 * quiets the garden.
 */
export interface GardenDetailProps {
  turn: 1 | -1;
  dim?: GardenDim;
}

/** How far the lobby quiets the garden: a value, or one read each frame. */
export type GardenDim = number | (() => number);

/** The quieting as it stands this frame (1, none, when not given). */
export const dimNow = (dim: GardenDim | undefined): number =>
  typeof dim === 'function' ? dim() : (dim ?? 1);
