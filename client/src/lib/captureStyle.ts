// How a captured piece leaves the board, chosen in the HUD (CapturePicker)
// and played by the scene (CaptureFx). Kept apart from the scene, so the
// screen can read and set it without loading three.js. Remembered in
// localStorage; a replay count lets the picker play the last move again.
import { useSyncExternalStore } from 'react';

export const CAPTURE_STYLES = ['topple', 'burn', 'crumble', 'shatter', 'sink'] as const;
export type CaptureStyle = (typeof CAPTURE_STYLES)[number];

export const CAPTURE_STYLE_LABELS: Record<CaptureStyle, string> = {
  topple: 'Topple',
  burn: 'Burn',
  crumble: 'Crumble',
  shatter: 'Shatter',
  sink: 'Sink',
};

const KEY = 'capture-style';

const read = (): CaptureStyle => {
  try {
    const value = localStorage.getItem(KEY);
    if ((CAPTURE_STYLES as readonly string[]).includes(value ?? '')) return value as CaptureStyle;
  } catch {
    // localStorage can throw (private mode, disabled storage)
  }
  return 'topple';
};

let state = { style: read(), replay: 0 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Chooses how captures play from now on. */
export const setCaptureStyle = (style: CaptureStyle) => {
  try {
    localStorage.setItem(KEY, style);
  } catch {
    // Kept for this page only
  }
  state = { ...state, style };
  emit();
};

/** Plays the last move again, its capture with it. */
export const replayLastMove = () => {
  state = { ...state, replay: state.replay + 1 };
  emit();
};

/** The chosen style and the replay count. */
export const useCaptureStyle = () => useSyncExternalStore(subscribe, () => state);
