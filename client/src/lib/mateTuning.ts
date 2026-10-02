// The mate's timings, tunable on the mate preview page (/mate). Kept
// apart from the scene, so the page can set them without loading three.js.
import { useSyncExternalStore } from 'react';

export interface MateTuning {
  /**
   * How long before the mating piece comes to rest its arrival counts (ms):
   * the glide eases in so slowly at its end that the piece looks landed a
   * moment before it is, and the knock lands then.
   */
  knockLeadMs: number;
  /** How fast the pulse of light spreads across the mated king's level (world units a second). */
  pulseSpeed: number;
  /** How fast the winners' wave of hops travels out from the king (world units a second). */
  waveSpeed: number;
  /** How long after the king strikes the floor the wave sets off (ms). */
  waveDelayMs: number;
}

export const MATE_TUNING_DEFAULTS: MateTuning = {
  knockLeadMs: 85,
  pulseSpeed: 4.2,
  waveSpeed: 14,
  waveDelayMs: 0,
};

let tuning = MATE_TUNING_DEFAULTS;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Changes some of the mate's timings (for this page). */
export const setMateTuning = (change: Partial<MateTuning>) => {
  tuning = { ...tuning, ...change };
  listeners.forEach((listener) => listener());
};

/** The mate's timings. */
export const useMateTuning = () => useSyncExternalStore(subscribe, () => tuning);
