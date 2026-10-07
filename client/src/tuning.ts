// Tuning values a player can try out on the board: shown only once a page has
// been opened with `?tune` (remembered in this browser; `?tune=off` forgets
// it), so they never stand in anyone else's way. No three.js here: the HUD
// (in the entry) and the scene both read it.

/** How much of its light a level gives up while the pointer is on another. */
export const STEP_BACK_DEFAULT = 0.6;

const TUNE_KEY = 'tune';
const STEP_BACK_KEY = 'tune.stepBack';

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the value lasts as long as the page
  }
};

/** Whether the tuning controls show: `?tune` turns them on, `?tune=off` off. */
export const tuningOn = (search = typeof location === 'undefined' ? '' : location.search) => {
  const asked = new URLSearchParams(search).get(TUNE_KEY);
  if (asked !== null) write(TUNE_KEY, asked === 'off' ? null : '1');
  return read(TUNE_KEY) === '1';
};

const stored = () => {
  const v = Number(read(STEP_BACK_KEY));
  return read(STEP_BACK_KEY) !== null && v >= 0 && v <= 1 ? v : STEP_BACK_DEFAULT;
};

let stepBack = tuningOn() ? stored() : STEP_BACK_DEFAULT;
const listeners = new Set<() => void>();

export const getStepBack = () => stepBack;

export const setStepBack = (value: number) => {
  stepBack = Math.min(Math.max(value, 0), 1);
  write(STEP_BACK_KEY, String(stepBack));
  listeners.forEach((l) => l());
};

export const subscribeStepBack = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
