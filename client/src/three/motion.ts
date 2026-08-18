import { SPACING } from './layout';

// Feel of the last-move animation, in one place. The lift makes a glide read
// as "picked up and set down" rather than a slide along the lattice.
export const MOVE_ANIMATION = {
  durationMs: 300,
  liftWorld: 0.2 * SPACING, // peak height of the parabolic lift, world units
  // A stalled frame (backgrounded tab, hitchy renderer) reports a huge delta;
  // clamping it lets the animation resume smoothly instead of snapping to
  // the end.
  maxFrameMs: 33,
} as const;

export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
