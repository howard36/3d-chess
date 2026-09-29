// What an invitation says before its guest accepts it, from the message log:
// the server's answer to look_game (game_info: the seats already taken), and
// the refusals that can follow it or the join.

import type { Color, WebSocketMessage } from '../types/messages';

export type Invitation =
  /** Asked; no answer yet. */
  | { state: 'opening' }
  /** The host holds one seat; `seat` is the one offered. */
  | { state: 'open'; seat: Color }
  /** Accepted: the join is on its way for `seat`. */
  | { state: 'joining'; seat: Color }
  /** Both seats are taken. */
  | { state: 'full' }
  /** No such game (mistyped, or expired). */
  | { state: 'gone' };

const other = (c: Color): Color => (c === 'white' ? 'black' : 'white');

/**
 * The invitation to `gameId` as the log tells it. `joining` is whether the
 * guest has accepted (sent join_game) and not been refused.
 */
export function selectInvitation(
  messages: WebSocketMessage[],
  gameId: string,
  joining: boolean,
): Invitation {
  let seats: Color[] | null = null;
  let gone = false;
  let full = false;
  for (const m of messages) {
    if (m.type === 'game_info' && m.gameId === gameId) seats = m.seats;
    else if (m.type === 'error' && m.code === 'invalid_game') gone = true;
    else if (m.type === 'error' && m.code === 'game_full') full = true;
  }
  if (gone) return { state: 'gone' };
  if (full || (seats && seats.length >= 2)) return { state: 'full' };
  if (!seats || seats.length === 0)
    return joining ? { state: 'joining', seat: 'white' } : { state: 'opening' };
  const seat = other(seats[0]);
  return joining ? { state: 'joining', seat } : { state: 'open', seat };
}
