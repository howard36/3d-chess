import { SPACING } from './layout';

// Feel of the last-move animation, in one place. Every move glides in a
// straight line (see movePath.ts).
export const MOVE_ANIMATION = {
  durationMs: 300,
  // Peak height of the lift a glide used to make (world units). Moves no
  // longer lift; kept for designs that size their own effects by it.
  liftWorld: 0.2 * SPACING,
  // A stalled frame (backgrounded tab, hitchy renderer) reports a huge delta;
  // clamping it lets the animation resume smoothly instead of snapping to
  // the end.
  maxFrameMs: 33,
} as const;

export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;

/**
 * Whether the player asked their system for less motion. The move glide and
 * the captured piece's fade are then skipped: the position simply changes,
 * and the last-move highlight still shows what moved.
 */
export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
