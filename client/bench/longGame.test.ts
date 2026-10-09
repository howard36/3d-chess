import { describe, expect, it } from 'vitest';
import { deriveHistory } from '../src/game/history';
import type { WebSocketMessage } from '../src/types/messages';
import { generateLongGame, LONG_GAME_PLIES } from './longGame';
import longGame from './longGame.json';

// The browser bench plays and seeds this game: it must be a live game at
// every ply, by the rules as they stand (a change to the rules or the draws
// that ends it fails here, not in a bench run minutes in).
describe('the bench’s long game', () => {
  it('is the generator’s game (rerun scripts/long-game.ts after a rules change)', () => {
    expect(longGame).toEqual(generateLongGame(LONG_GAME_PLIES));
  });

  it('is legal and never over: no mate, stalemate, repetition or fifty moves', () => {
    const log: WebSocketMessage[] = [
      { type: 'game_state', color: 'white', started: true, moves: [] },
    ];
    let history = deriveHistory(log);
    longGame.forEach((text, i) => {
      const [from, to] = text.split('-');
      log.push({ type: 'move_made', by: i % 2 === 0 ? 'white' : 'black', from, to });
      history = deriveHistory([...log], history);
      expect(history.replayFailedAt, `ply ${i + 1}`).toBeNull();
      expect(history.gameOver, `ply ${i + 1}`).toBeNull();
      // Quiet: nothing taken
      expect(history.captured.white.length + history.captured.black.length).toBe(0);
    });
    expect(history.appliedMoveCount).toBe(LONG_GAME_PLIES);
  });
});
