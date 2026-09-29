import { useEffect, useState } from 'react';

// How finely the canvas draws. The cost of a frame is almost all fill (the
// scene's JavaScript is the same at any size, and its glow and glass layers
// are drawn over each other), so the canvas takes the screen's own ratio up
// to 2x, within a budget of pixels: a phone draws at 2x, a large
// high-density window at a little less.

/** Most device pixels the canvas draws: 1920x1080 at 1.47x, 2560x1600 at 1.19x. */
export const PIXEL_BUDGET = 4.5e6;

/**
 * The finest ratio drawn. A 3x phone draws at 2x and is scaled up: 3x would
 * be 2.25 times the pixels, for the GPU and the battery, for little to see.
 */
export const MAX_PIXEL_RATIO = 2;

/**
 * The pixel ratio for a canvas of `width` x `height` CSS pixels on a screen
 * of `deviceRatio`: the screen's own, up to MAX_PIXEL_RATIO, unless that draws
 * more than PIXEL_BUDGET device pixels. Never under one device pixel per CSS
 * pixel (or the screen's own ratio, where that is lower), which would blur.
 */
export function budgetPixelRatio(width: number, height: number, deviceRatio: number): number {
  const wanted = Math.min(deviceRatio > 0 ? deviceRatio : 1, MAX_PIXEL_RATIO);
  const area = width * height;
  if (!(area > 0)) return wanted;
  return Math.max(Math.min(wanted, Math.sqrt(PIXEL_BUDGET / area)), Math.min(wanted, 1));
}

const current = () =>
  typeof window === 'undefined'
    ? 1
    : budgetPixelRatio(window.innerWidth, window.innerHeight, window.devicePixelRatio);

/**
 * The pixel ratio for a canvas that fills the window (budgetPixelRatio),
 * kept up to date as the window is resized, zoomed or moved to another
 * screen. For the Canvas's `dpr`: r3f applies that prop again whenever the
 * Canvas renders, so the ratio has to come in through it.
 */
export function usePixelBudget(): number {
  const [ratio, setRatio] = useState(current);
  useEffect(() => {
    // A window moved to a screen of another density fires no resize: watch
    // for the density leaving the current one, then for the new one
    let density: MediaQueryList | undefined;
    const update = () => {
      setRatio(current());
      density?.removeEventListener?.('change', update);
      density = window.matchMedia?.(`(resolution: ${window.devicePixelRatio}dppx)`);
      density?.addEventListener?.('change', update);
    };
    update();
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      density?.removeEventListener?.('change', update);
    };
  }, []);
  return ratio;
}
