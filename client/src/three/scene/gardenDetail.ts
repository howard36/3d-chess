import type { platformStack } from './mask';

/**
 * What Stage hands each area of garden detail (skyDetail, boardDetail,
 * court, horizon): the board's turn for the seat (1 white, -1 black; the sky
 * does not turn), what casts the tower's shade when it is not the whole tower
 * (the lobby's single platform), and how far the lobby quiets the garden.
 */
export interface GardenDetailProps {
  turn: 1 | -1;
  shade?: ReturnType<typeof platformStack>;
  dim?: number | (() => number);
}
