// Games against the computer, kept in the browser: there is no server
// record, so this is the only copy. Written after every move and read back
// on a reload; kept in memory too, so a game plays on (for this visit) where
// storage is refused.

import type { ComputerGame } from '../game/computerGame';
import { isDifficulty } from '../ai/levels';
import type { Difficulty } from '../ai/levels';

const keyFor = (gameId: string) => `3dchess:computer:${gameId}`;
const DIFFICULTY_KEY = '3dchess:computer-difficulty';
const memory = new Map<string, ComputerGame>();

const isGame = (value: unknown, gameId: string): value is ComputerGame => {
  const g = value as ComputerGame | null;
  return (
    !!g &&
    g.id === gameId &&
    (g.color === 'white' || g.color === 'black') &&
    isDifficulty(g.difficulty) &&
    typeof g.started === 'boolean' &&
    Array.isArray(g.moves)
  );
};

export function loadComputerGame(gameId: string): ComputerGame | null {
  try {
    const raw = localStorage.getItem(keyFor(gameId));
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isGame(parsed, gameId)) return parsed;
    }
  } catch {
    // Unreadable or refused: what this visit holds, if anything
  }
  return memory.get(gameId) ?? null;
}

export function saveComputerGame(game: ComputerGame): void {
  memory.set(game.id, game);
  try {
    localStorage.setItem(keyFor(game.id), JSON.stringify(game));
  } catch {
    // The game goes on; only a reload loses it
  }
}

/**
 * The games whose side choice is on screen as their page opens: the page
 * plays the computer's arrival over it (GameScreen's `computer.arriving`).
 * Held in memory, so a reload, or a visit from history, opens on the game
 * itself instead.
 */
const arriving = new Set<string>();
export const markArriving = (gameId: string) => void arriving.add(gameId);
export const isArriving = (gameId: string) => arriving.has(gameId);
export const doneArriving = (gameId: string) => void arriving.delete(gameId);

/** A new game's id: short, and never one a server game could have (they are upper case). */
export function newComputerGameId(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  let id = '';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  for (const b of bytes) id += alphabet[b % alphabet.length];
  return id;
}

/** The level last played (Medium the first time). */
export function getStoredDifficulty(): Difficulty {
  try {
    const value = localStorage.getItem(DIFFICULTY_KEY);
    if (isDifficulty(value)) return value;
  } catch {
    // Storage refused: the default
  }
  return 'medium';
}

export function setStoredDifficulty(difficulty: Difficulty): void {
  try {
    localStorage.setItem(DIFFICULTY_KEY, difficulty);
  } catch {
    // Remembered for this visit only by the page's own state
  }
}
