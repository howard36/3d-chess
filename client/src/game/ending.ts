// How the players themselves end a game, derived from the socket's message
// log alongside the replayed record (history.ts): a resignation or an agreed
// draw, and the draw offer standing between them.
//
// Like the moves, both come from the LATEST game_state snapshot plus the
// messages after it. Each draw message names the ply it was made at, and an
// offer stands only while that is still the number of moves played, so a
// move cancels it with no message of its own, and the result does not depend
// on the order in which a move and an offer made at the same time arrive.

import type { Color, DrawOffer, GameState, WebSocketMessage } from '../types/messages';
import type { GameHistory, GameOver } from './history';

/** The snapshot the record starts from, and the messages after it, newest first. */
const sinceSnapshot = (messages: readonly WebSocketMessage[]) => {
  const after: WebSocketMessage[] = [];
  let snapshot: GameState | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.type === 'game_state') {
      snapshot = m;
      break;
    }
    after.push(m);
  }
  return { snapshot, after };
};

/**
 * The game's end by resignation or agreement, or null while the players have
 * decided nothing. Pass the previous result to get it back unchanged (the
 * same object) while it says the same: the result card and the board key off
 * its identity, as they do off deriveHistory's.
 */
export function selectEnding(
  messages: readonly WebSocketMessage[],
  prev?: GameOver | null,
): GameOver | null {
  const { snapshot, after } = sinceSnapshot(messages);
  const ended = after.find((m) => m.type === 'game_ended');
  const source = ended?.type === 'game_ended' ? ended : snapshot?.ending;
  if (!source) return null;
  const next: GameOver = source.winner
    ? { result: source.result, winner: source.winner }
    : { result: source.result };
  return prev && prev.result === next.result && prev.winner === next.winner ? prev : next;
}

/**
 * The replayed game with the players' decision folded in: an ending on the
 * board (a mate, a draw by the rules) stands first, since it came with a move
 * before either player could resign or agree. The same object while neither
 * changes.
 */
export function withEnding(history: GameHistory, ending: GameOver | null): GameHistory {
  if (!ending || history.gameOver) return history;
  return { ...history, gameOver: ending };
}

export interface DrawOfferState {
  /** Who offered the draw that stands now, if one does. */
  standing: Color | null;
  /** Who offered the draw since the last move that was declined, if one was. */
  declined: Color | null;
  /** A draw can be offered now: none has been since the last move. */
  canOffer: boolean;
}

/**
 * The draw offer since the last move (when `plies` moves have been played),
 * from the log: who stands behind it, or whose was declined. A draw can be
 * offered once a move, by either side.
 */
export function selectDrawOffer(
  messages: readonly WebSocketMessage[],
  plies: number,
): DrawOfferState {
  const { snapshot, after } = sinceSnapshot(messages);
  let offer: DrawOffer | null = snapshot?.drawOffer?.ply === plies ? snapshot.drawOffer : null;
  let declined = !!offer?.declined;
  for (const m of after) {
    if (m.type === 'draw_offered' && m.ply === plies) offer = { by: m.by, ply: m.ply };
    else if (m.type === 'draw_declined' && m.ply === plies) declined = true;
  }
  return {
    standing: offer && !declined ? offer.by : null,
    declined: offer && declined ? offer.by : null,
    canOffer: !offer,
  };
}
