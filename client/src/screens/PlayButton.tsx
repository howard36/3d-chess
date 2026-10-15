import React from 'react';
import { rimGradient, rimPoints } from './rim';

// The main action of a screen: the pill of starlight (.landing-play,
// .lobby-go). With `rim`, where it stands alone on the scene and the action
// is one to urge, a rim of the level colours turns round it at one pace
// (./rim.ts), a lap in 9s, in 1.4s while it waits (aria-disabled); in a card
// of the rimmed glass it goes without. The rim is painted here, a frame at a
// time, on the animation frames (so the showcase's virtual clock records
// it); with less motion asked for it stands still at rest. Until then, and
// wherever script does not run, the stylesheet's straight gradient stands in.

const LAP_MS = 9000;
const BUSY_LAP_MS = 1400;
/** A stalled frame (a background tab) resumes the turn, never jumps it. */
const MAX_STEP_MS = 100;

const reducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  ref?: React.Ref<HTMLButtonElement>;
  /** The turning rim of the level colours, for an action to urge standing alone. */
  rim?: boolean;
};

export const PlayButton: React.FC<Props> = ({ ref, className, rim = false, ...props }) => {
  const own = React.useRef<HTMLButtonElement>(null);
  React.useImperativeHandle(ref, () => own.current!, []);
  React.useLayoutEffect(() => {
    const el = own.current;
    if (!el || !rim) return;
    let points: ReturnType<typeof rimPoints> = [];
    let size = '';
    let turn = 0;
    const paint = () => {
      if (points.length) el.style.setProperty('--landing-rim', rimGradient(points, turn));
    };
    const measure = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (`${w}x${h}` === size || !w || !h) return;
      size = `${w}x${h}`;
      points = rimPoints(w, h);
      paint();
    };
    measure();
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    resize?.observe(el);
    let frame = 0;
    let last: number | null = null;
    const step = (now: number) => {
      if (last !== null) {
        const lap = el.getAttribute('aria-disabled') === 'true' ? BUSY_LAP_MS : LAP_MS;
        turn = (turn + Math.min(now - last, MAX_STEP_MS) / lap) % 1;
        paint();
      }
      last = now;
      frame = requestAnimationFrame(step);
    };
    if (!reducedMotion()) frame = requestAnimationFrame(step);
    return () => {
      resize?.disconnect();
      cancelAnimationFrame(frame);
      el.style.removeProperty('--landing-rim');
    };
  }, [rim]);
  return (
    <button
      ref={own}
      className={className ? `landing-play lobby-go ${className}` : 'landing-play lobby-go'}
      data-rim={rim || undefined}
      {...props}
    />
  );
};
