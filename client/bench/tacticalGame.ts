// The game the browser bench (scripts/bench-browser.mjs) plays move by move
// to time a move landing: the opening of the client tier's decisive game
// (bench/fixtures.ts), real play by the tactical policy, with captures by
// both sides and a check, so the landing of a capture (the taken piece's
// topple) and of a check are timed as well as quiet moves. White's moves are
// clicked on the board, Black's come from a socket.
// Written out to tacticalGame.json by `npx vite-node scripts/long-game.ts`;
// tacticalGame.test.ts checks the file against the fixture and the rules.

import { fromZXY } from '../src/engine/coords';
import { sharedGames } from './fixtures';

/** Plies of the decisive game the bench plays: up to Black's answer to White's check. */
export const TACTICAL_PLIES = 32;

export interface TacticalPly {
  /** As the move box takes it (`Ad2-Ac3`). */
  move: string;
  /** Whether it takes a piece, and whether it gives check. */
  capture: boolean;
  check: boolean;
}

export function tacticalGame(): TacticalPly[] {
  const { records, positions } = sharedGames().decisive;
  return records.slice(0, TACTICAL_PLIES).map((r, i) => ({
    move: `${r.from}-${r.to}`,
    capture: !!positions[i].getPiece(fromZXY(r.to)),
    check: positions[i + 1].inCheck(i % 2 === 0 ? 'black' : 'white'),
  }));
}
