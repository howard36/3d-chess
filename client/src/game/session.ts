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

// The answers that mean a request went through (a game created, joined,
// rejoined or looked at, a move recorded), or that the game has moved on
// (the opponent's move): any refusal before one of them is over.
const ANSWERS: ReadonlySet<WebSocketMessage['type']> = new Set([
  'game_created',
  'game_joined',
  'game_start',
  'game_state',
  'game_info',
  'move_made',
]);

export interface StandingError {
  error: ServerError;
  /** Its place in the log (a dismissal names the error it dismissed). */
  index: number;
}

/**
 * The refusal that still stands at the end of the log, looking no further
 * back than `fromIndex` (where the page's own requests begin): the latest
 * error, unless a later answer has overtaken it. seat_in_use is not one: the
 * page answers it with a dialog of its own.
 */
export function selectStandingError(
  messages: WebSocketMessage[],
  fromIndex: number,
): StandingError | null {
  for (let i = messages.length - 1; i >= Math.max(0, fromIndex); i--) {
    const m = messages[i];
    if (m.type === 'error') {
      if (m.code !== 'seat_in_use') return { error: m, index: i };
    } else if (ANSWERS.has(m.type)) return null;
  }
  return null;
}

/**
 * Whether a request sent when the log was `fromIndex` long was refused with
 * one of `codes`: only its own answer counts, not an earlier request's.
 */
export const refusedSince = (
  messages: WebSocketMessage[],
  fromIndex: number,
  codes: readonly ServerError['code'][],
) => messages.slice(fromIndex).some((m) => m.type === 'error' && codes.includes(m.code));

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

/**
 * Whether this page saw its game start: the log's first word that play has
 * begun is the live game_start, not a rejoin's snapshot of a game already
 * under way (a reload, a second visit). The game's entrance plays in full
 * for the first and briefly for the second.
 */
export const startedLive = (messages: WebSocketMessage[]) =>
  messages.find((m) => m.type === 'game_start' || (m.type === 'game_state' && m.started))?.type ===
  'game_start';
