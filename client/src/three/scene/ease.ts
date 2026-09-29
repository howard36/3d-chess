// Easing and ramps shared by the scene's timelines.

export const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1);

/** Smoothstep of a 0-1 ramp. */
export const smooth = (t: number) => t * t * (3 - 2 * t);

/** Fast at first, settling at 1 (never past it). */
export const easeOutQuad = (t: number) => 1 - (1 - t) ** 2;
export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/** `v` moved toward `goal` by at most `step`. */
export const toward = (v: number, goal: number, step: number) =>
  goal > v ? Math.min(goal, v + step) : Math.max(goal, v - step);
