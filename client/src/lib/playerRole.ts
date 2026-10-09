// Per-game role persistence. The stored role is what lets a player leave and
// rejoin a game: it is written the moment the server tells us our color and
// read back on page load to auto-rejoin. localStorage is used instead of a
// cookie because the game server is cross-origin (a cookie would never reach
// it) and roles should survive the tab closing.

import type { Color } from '../types/messages';

/** The stored role's key, less its game id (also read by earlySocket.ts's inline script). */
export const ROLE_KEY_PREFIX = '3dchess:role:';
const keyFor = (gameId: string) => `${ROLE_KEY_PREFIX}${gameId}`;

export function getStoredRole(gameId: string): Color | null {
  try {
    const value = localStorage.getItem(keyFor(gameId));
    return value === 'white' || value === 'black' ? value : null;
  } catch {
    // localStorage can throw (private mode, disabled storage); treat as no role
    return null;
  }
}

export function setStoredRole(gameId: string, color: Color): void {
  try {
    localStorage.setItem(keyFor(gameId), color);
  } catch {
    // Losing persistence degrades reconnection, not the current session
  }
}

export function clearStoredRole(gameId: string): void {
  try {
    localStorage.removeItem(keyFor(gameId));
  } catch {
    // Nothing to clean up if storage is unavailable
  }
}
