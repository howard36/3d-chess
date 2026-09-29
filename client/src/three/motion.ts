// Timing shared by the board's animations (the move glide, the lift, the
// scene's effects).
export const MOVE_ANIMATION = {
  // A stalled frame (backgrounded tab, hitchy renderer) reports a huge delta;
  // clamping it lets the animation resume smoothly instead of snapping to
  // the end.
  maxFrameMs: 33,
} as const;

export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;

/**
 * Whether the player asked their system for less motion. The move glide and
 * the capture's effect are then skipped: the position simply changes, and the
 * last-move line still shows what moved.
 */
export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
