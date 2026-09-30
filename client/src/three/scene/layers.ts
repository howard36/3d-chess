/**
 * Draw order of the scene's see-through layers. The garden (Stage) draws
 * first, below them all (backdropCache.tsx's BACKDROP_END), then the
 * pieces, which are opaque; everything here is transparent, writes no
 * depth, and is drawn after them in this order, so:
 *
 * - platforms never hide a piece, a marker or a label (they write no depth),
 *   they only tint what lies behind them, faintly;
 * - contact shadows darken the platform they lie on;
 * - markers and the last-move trace are drawn over every platform, so a
 *   destination three levels down reads as clearly as one on top;
 * - labels come last.
 *
 * Pieces still hide the markers and traces behind them (depth test), which is
 * what places a marker in 3D.
 */
export const LAYER = {
  plate: 1,
  plateEdge: 2,
  shadow: 3,
  marker: 4,
  trace: 5,
  label: 6,
} as const;
