import { describe, expect, it } from 'vitest';
import { deriveHistory } from '../src/game/history';
import type { WebSocketMessage } from '../src/types/messages';
import { sharedGames } from './fixtures';
import { TACTICAL_PLIES, tacticalGame } from './tacticalGame';
import game from './tacticalGame.json';

// The browser bench plays this game and names its captures and checks in
// the report: it must stay the fixture's game, live at every ply, with what
// the bench counts on (a change to the rules that alters it fails here, not
// in a bench run minutes in).
describe('the bench’s tactical game', () => {
  it('is the decisive game’s opening (rerun scripts/long-game.ts after a fixture change)', () => {
    expect(game).toEqual(tacticalGame());
    expect(game).toHaveLength(TACTICAL_PLIES);
    // (A promotion would need its piece picked by hand, and the text has no room for it)
    const records = sharedGames().decisive.records.slice(0, TACTICAL_PLIES);
    expect(records.filter((r) => r.promotion)).toEqual([]);
  });

  it('is legal and never over, and both sides capture and White checks', () => {
    const log: WebSocketMessage[] = [
      { type: 'game_state', color: 'white', started: true, moves: [] },
    ];
    let history = deriveHistory(log);
    const taken = { white: 0, black: 0 };
    let whiteChecks = 0;
    game.forEach(({ move, capture, check }, i) => {
      const [from, to] = move.split('-');
      const by = i % 2 === 0 ? 'white' : 'black';
      log.push({ type: 'move_made', by, from, to });
      history = deriveHistory([...log], history);
      expect(history.replayFailedAt, `ply ${i + 1}`).toBeNull();
      expect(history.gameOver, `ply ${i + 1}`).toBeNull();
      const tookNow =
        history.captured.white.length + history.captured.black.length !== taken.white + taken.black;
      expect(capture, `ply ${i + 1} takes a piece`).toBe(tookNow);
      expect(check, `ply ${i + 1} gives check`).toBe(
        history.board.inCheck(by === 'white' ? 'black' : 'white'),
      );
      taken.white = history.captured.white.length;
      taken.black = history.captured.black.length;
      if (by === 'white' && check) whiteChecks++;
    });
    expect(taken.white).toBeGreaterThan(0);
    expect(taken.black).toBeGreaterThan(0);
    expect(whiteChecks).toBeGreaterThan(0);
  });
});
