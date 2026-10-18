// How far this player's finger lands from what it means (three/tapIntent.ts),
// learned from the choices they make in the magnifier and kept in the
// browser, so a steady hand is asked less often. Storage that is off or full
// only means starting from the default again.

import type { SpreadRecord } from '../three/tapIntent';

const KEY = '3dchess:tap-spread';

export function loadTapSpread(): SpreadRecord | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<SpreadRecord> | null;
    const { n, sumSq } = value ?? {};
    if (typeof n !== 'number' || typeof sumSq !== 'number' || !(n >= 0) || !(sumSq >= 0)) {
      return null;
    }
    return { n, sumSq };
  } catch {
    return null;
  }
}

export function saveTapSpread(record: SpreadRecord): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // Kept for this visit only
  }
}
