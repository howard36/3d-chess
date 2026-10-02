// How a checkmate plays out, chosen on the mate preview page (/mate) and read
// by the scene (Board, the mated king) and the screen (when the result card
// comes, and how). Kept apart from the scene, so the screen can read it
// without loading three.js. Remembered in localStorage.
import { useSyncExternalStore } from 'react';

export const MATE_STYLES = ['classic', 'teeter', 'lines', 'shatter', 'wave'] as const;
export type MateStyle = (typeof MATE_STYLES)[number];

export const MATE_STYLE_LABELS: Record<MateStyle, string> = {
  classic: 'Classic',
  teeter: 'Teeter',
  lines: 'Lines',
  shatter: 'Shatter',
  wave: 'Wave',
};

/**
 * Each style's beats, in ms after the mating move lands: how long the king
 * holds (rocking, or while the lines are drawn) before he falls or breaks,
 * and how long the final board is held after he strikes before the result
 * card comes. The card docks in the bottom right corner, leaving the board in
 * view, except in the classic sequence.
 */
export const MATE_TIMING: Record<MateStyle, { beforeMs: number; holdMs: number; docked: boolean }> =
  {
    classic: { beforeMs: 0, holdMs: 0, docked: false },
    teeter: { beforeMs: 900, holdMs: 700, docked: true },
    lines: { beforeMs: 650, holdMs: 700, docked: true },
    shatter: { beforeMs: 600, holdMs: 900, docked: true },
    wave: { beforeMs: 0, holdMs: 1300, docked: true },
  };

const KEY = 'mate-style';

const read = (): MateStyle => {
  try {
    const value = localStorage.getItem(KEY);
    if ((MATE_STYLES as readonly string[]).includes(value ?? '')) return value as MateStyle;
  } catch {
    // localStorage can throw (private mode, disabled storage)
  }
  return 'teeter';
};

let style = read();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Chooses how checkmates play from now on. */
export const setMateStyle = (next: MateStyle) => {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Kept for this page only
  }
  style = next;
  listeners.forEach((listener) => listener());
};

/** The chosen style (as of now, outside React). */
export const mateStyle = () => style;

/** The chosen style. */
export const useMateStyle = () => useSyncExternalStore(subscribe, () => style);
