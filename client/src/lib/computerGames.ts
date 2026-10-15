// Games against the computer, kept in the browser: there is no server
// record, so this is the only copy. Written after every move and read back
// on a reload; a game whose last write was refused (storage full or off) is
// kept in memory instead, so it plays on for this visit from its latest
// move, not from the last copy storage took.

import type { ComputerGame } from '../game/computerGame';
import { isDifficulty } from '../ai/levels';
import type { Difficulty } from '../ai/levels';
import type { Color } from '../types/messages';
import { setStoredRole } from './playerRole';

const keyFor = (gameId: string) => `3dchess:computer:${gameId}`;
/** The games whose last write storage refused: newer than its copy. */
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
  const held = memory.get(gameId);
  if (held) return held;
  try {
    const raw = localStorage.getItem(keyFor(gameId));
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isGame(parsed, gameId)) return parsed;
      // The only copy of a game, unreadable: say so (the page says only that there is none)
      console.warn(`The stored game ${gameId} is not one this page can read.`, parsed);
    }
  } catch (cause) {
    console.warn(`The stored game ${gameId} could not be read.`, cause);
  }
  return null;
}

export function saveComputerGame(game: ComputerGame): void {
  try {
    localStorage.setItem(keyFor(game.id), JSON.stringify(game));
    memory.delete(game.id);
  } catch (cause) {
    // The game goes on from memory; a reload loses what storage refused
    if (!memory.has(game.id)) {
      console.warn('Storage refused this game: it is kept for this visit only.', cause);
    }
    memory.set(game.id, game);
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

/** Starts a game against the computer, `color` the player's: stored, seat and all. Its id. */
export function createComputerGame(color: Color, difficulty: Difficulty): string {
  const id = newComputerGameId();
  saveComputerGame({ id, color, difficulty, started: false, moves: [] });
  setStoredRole(id, color);
  return id;
}
