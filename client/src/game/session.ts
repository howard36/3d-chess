// Session facts derived from the socket's message log: which seat this client
// holds, whether the game has started, whether the opponent is connected, and
// what the server has rejected. All cheap scans; see history.ts for the replay.

import type {
  Color,
  Error as ServerError,
  GameJoined,
  GameStart,
  GameState,
  WebSocketMessage,
} from '../types/messages';

export interface Seat {
  /** This client's colour, once the server has told us. */
  color: Color | null;
  /** Both seats are taken and play can begin. */
  started: boolean;
  /** The server confirmed our join (game_joined), whether or not play has begun. */
  joined: boolean;
  /**
   * The colour the server assigned this client in this session (game_joined
   * or game_start), as opposed to one replayed to it after a rejoin. This is
   * the value worth persisting for later rejoins.
   */
  assigned: Color | null;
}

/**
 * The seat this log establishes. game_start is authoritative for a live
 * session; a game_state reply (rejoin) carries the same information; the
 * server confirms a joiner's seat with game_joined before it broadcasts
 * game_start, so a drop between the two still leaves a known colour.
 */
export function selectSeat(messages: WebSocketMessage[]): Seat {
  let gameStart: GameStart | undefined;
  let gameJoined: GameJoined | undefined;
  let latestState: GameState | undefined;
  for (const m of messages) {
    if (m.type === 'game_start') gameStart ??= m;
    else if (m.type === 'game_joined') gameJoined ??= m;
    else if (m.type === 'game_state') latestState = m;
  }
  return {
    color: gameStart?.color ?? latestState?.color ?? gameJoined?.color ?? null,
    started: !!gameStart || !!latestState?.started,
    joined: !!gameJoined,
    assigned: gameJoined?.color ?? gameStart?.color ?? null,
  };
}

/**
 * Whether the opponent is connected, from the latest presence message about
 * them. The server sends one on every (re)join, so after a reconnect the
 * newest message is current; null until the first one arrives.
 */
export function selectOpponentOnline(messages: WebSocketMessage[], color: Color | null) {
  if (!color) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.type === 'presence' && m.color !== color) return m.online;
  }
  return null;
}

export const selectErrors = (messages: WebSocketMessage[]): ServerError[] =>
  messages.filter((m): m is ServerError => m.type === 'error');

/**
 * True if the log holds, at or after `fromIndex`, a message that establishes
 * this socket's server-side session (created, joined or rejoined a game).
 * The server forgets a socket the moment it drops, so a fresh socket without
 * one of these must rejoin.
 */
export const hasSessionSince = (messages: WebSocketMessage[], fromIndex: number) =>
  messages
    .slice(fromIndex)
    .some(
      (m) =>
        m.type === 'game_created' ||
        m.type === 'game_joined' ||
        m.type === 'game_start' ||
        m.type === 'game_state',
    );
