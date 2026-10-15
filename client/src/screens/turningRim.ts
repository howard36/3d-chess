import { rimFacing, rimGradient, rimPoints } from './rim';
import type { RimPoint } from './rim';
import { prefersReducedMotion } from '../three/motion';

// The level colours' rim turning round a control at one pace (./rim.ts), the
// pill of starlight's (PlayButton) and the glass tiles' alike. Each paints
// its own `--landing-rim`, which its stylesheet draws (the pill's border, the
// tiles' ::before ring), on the animation frames (so the showcase's virtual
// clock records it): at rest while it isn't turning, as the straight
// gradient the stylesheet holds until script paints it, and still under
// reduced motion.

export interface TurningRimOptions {
  /** Whether the rim turns now, given whether the pointer is over the control. */
  turning: (el: HTMLElement, pointed: boolean) => boolean;
  /** A lap's time, given the control (the pill's quickens while it waits). */
  lapMs: (el: HTMLElement) => number;
  /** Which way sky faces at rest, degrees clockwise from up (rose the other way). */
  sky: number;
  /** How far in from the control's edge the middle of its rim runs. */
  inset: number;
}

/**
 * A stalled frame (a background tab come back) resumes the turn, never jumps
 * it; a slow one (a page busy drawing its scene) still keeps its pace.
 */
const MAX_STEP_MS = 500;

/** The attributes a control's turning can follow (a hover the scene marks, a wait). */
const STATES = ['data-hover', 'disabled', 'aria-disabled'];

/**
 * A ref for a control with a turning rim: one function serves every control
 * of a kind, each attached control keeping its own turn until it detaches.
 */
export function turningRim(options: TurningRimOptions) {
  return (el: HTMLElement | null) => {
    if (!el) return;
    let points: RimPoint[] = [];
    let sky = 0;
    let size = '';
    let turn = 0;
    let pointed = false;
    let frame = 0;
    let last: number | null = null;
    const reduced = prefersReducedMotion();
    const paint = () => {
      if (points.length) el.style.setProperty('--landing-rim', rimGradient(points, turn, sky));
    };
    const measure = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      const key = `${w}x${h}x${radius}`;
      if (key === size || !w || !h) return;
      size = key;
      points = rimPoints(w, h, { radius, inset: options.inset });
      sky = rimFacing(w, h, { radius, inset: options.inset }, options.sky);
      paint();
    };
    const step = (now: number) => {
      if (last !== null) {
        turn = (turn + Math.min(now - last, MAX_STEP_MS) / options.lapMs(el)) % 1;
        paint();
      }
      last = now;
      frame = requestAnimationFrame(step);
    };
    // Turning from rest; stopped, back at rest, as the stylesheet's animation was
    const update = () => {
      const on = !reduced && options.turning(el, pointed);
      if (on && !frame) {
        last = null;
        frame = requestAnimationFrame(step);
      } else if (!on && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
        turn = 0;
        paint();
      }
    };
    const enter = () => {
      pointed = true;
      update();
    };
    const leave = () => {
      pointed = false;
      update();
    };
    measure();
    update();
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    resize?.observe(el);
    const states = typeof MutationObserver === 'function' ? new MutationObserver(update) : null;
    states?.observe(el, { attributes: true, attributeFilter: STATES });
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointerleave', leave);
    return () => {
      resize?.disconnect();
      states?.disconnect();
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointerleave', leave);
      cancelAnimationFrame(frame);
      el.style.removeProperty('--landing-rim');
    };
  };
}

/**
 * The glass tiles' rim (.landing-mode, .lobby-glass: a 1.5 px ring, its
 * ::before), sky at the top left and rose at the bottom right as the
 * stylesheet's diagonal has it, a lap in 4 s while `turning` says so.
 */
export const glassRim = (turning: TurningRimOptions['turning']) =>
  turningRim({ turning, lapMs: () => 4000, sky: 308, inset: 0.75 });
