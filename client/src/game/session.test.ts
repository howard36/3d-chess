import { describe, expect, it } from 'vitest';
import {
  hasSessionSince,
  refusedSince,
  selectOpponentOnline,
  selectSeat,
  selectStandingError,
  startedLive,
} from './session';
import type { WebSocketMessage } from '../types/messages';

describe('selectSeat', () => {
  it('knows nothing before the server has spoken', () => {
    expect(selectSeat([])).toEqual({ color: null, started: false, joined: false, assigned: null });
  });

  it('takes the colour and start from game_start', () => {
    expect(selectSeat([{ type: 'game_start', color: 'black' }])).toEqual({
      color: 'black',
      started: true,
      joined: false,
      assigned: 'black',
    });
  });

  it('confirms a joiner before the game starts', () => {
    expect(selectSeat([{ type: 'game_joined', color: 'black' }])).toEqual({
      color: 'black',
      started: false,
      joined: true,
      assigned: 'black',
    });
  });

  it('restores a seat from a game_state reply without treating it as newly assigned', () => {
    expect(selectSeat([{ type: 'game_state', color: 'white', started: true, moves: [] }])).toEqual({
      color: 'white',
      started: true,
      joined: false,
      assigned: null,
    });
    expect(
      selectSeat([{ type: 'game_state', color: 'white', started: false, moves: [] }]).started,
    ).toBe(false);
  });

  it('prefers game_start over a snapshot, and the latest snapshot over earlier ones', () => {
    const seat = selectSeat([
      { type: 'game_state', color: 'white', started: false, moves: [] },
      { type: 'game_state', color: 'white', started: true, moves: [] },
    ]);
    expect(seat.started).toBe(true);
    expect(
      selectSeat([
        { type: 'game_state', color: 'white', started: true, moves: [] },
        { type: 'game_start', color: 'black' },
      ]).color,
    ).toBe('black');
    expect(
      selectSeat([
        { type: 'game_joined', color: 'black' },
        { type: 'game_start', color: 'black' },
      ]).assigned,
    ).toBe('black');
  });
});

describe('selectOpponentOnline', () => {
  const messages: WebSocketMessage[] = [
    { type: 'presence', color: 'black', online: true },
    { type: 'presence', color: 'white', online: true },
    { type: 'presence', color: 'black', online: false },
  ];

  it('is unknown without a seat or without any presence message', () => {
    expect(selectOpponentOnline(messages, null)).toBeNull();
    expect(selectOpponentOnline([], 'white')).toBeNull();
  });

  it('reads the latest presence message about the other colour', () => {
    expect(selectOpponentOnline(messages, 'white')).toBe(false);
    expect(selectOpponentOnline(messages, 'black')).toBe(true);
  });
});

describe('selectStandingError', () => {
  const wrongTurn: WebSocketMessage = {
    type: 'error',
    code: 'wrong_turn',
    message: 'Not your turn',
  };
  const moved: WebSocketMessage = { type: 'move_made', by: 'white', from: 'Ba2', to: 'Ca2' };
  const presence: WebSocketMessage = { type: 'presence', color: 'black', online: false };

  it('is the latest error, with its place in the log', () => {
    const log: WebSocketMessage[] = [
      { type: 'game_start', color: 'white' },
      { type: 'error', code: 'invalid_message', message: 'Bad request' },
      wrongTurn,
      presence,
    ];
    expect(selectStandingError(log, 0)).toEqual({ error: wrongTurn, index: 2 });
    expect(selectStandingError([], 0)).toBeNull();
  });

  it.each([
    ['a move made', moved],
    ['a game created', { type: 'game_created', gameId: 'ABC', color: 'white' }],
    ['a seat joined', { type: 'game_joined', color: 'black' }],
    ['a game started', { type: 'game_start', color: 'black' }],
    ['a rejoin answered', { type: 'game_state', color: 'white', started: true, moves: [] }],
    ['a look answered', { type: 'game_info', gameId: 'ABC', seats: ['white'] }],
  ] as [string, WebSocketMessage][])('ends with %s after it', (_, answer) => {
    expect(selectStandingError([wrongTurn, answer], 0)).toBeNull();
    // ...but stands again for a refusal after that
    expect(selectStandingError([wrongTurn, answer, wrongTurn], 0)).toEqual({
      error: wrongTurn,
      index: 2,
    });
  });

  it('looks no further back than where the page began', () => {
    const log: WebSocketMessage[] = [
      { type: 'error', code: 'already_in_game', message: 'Already in a game' },
      presence,
    ];
    expect(selectStandingError(log, 0)?.index).toBe(0);
    expect(selectStandingError(log, 1)).toBeNull();
  });

  it('passes over seat_in_use, which has its own dialog', () => {
    const inUse: WebSocketMessage = {
      type: 'error',
      code: 'seat_in_use',
      message: 'This game is open in another tab',
    };
    expect(selectStandingError([inUse], 0)).toBeNull();
    expect(selectStandingError([wrongTurn, inUse], 0)).toEqual({ error: wrongTurn, index: 0 });
  });
});

describe('refusedSince', () => {
  const log: WebSocketMessage[] = [
    { type: 'error', code: 'invalid_rejoin', message: 'No such seat to rejoin' },
    { type: 'game_info', gameId: 'ABC', seats: ['white'] },
    { type: 'error', code: 'game_full', message: 'Game full' },
  ];

  it("reads a request's own answers only", () => {
    expect(refusedSince(log, 0, ['invalid_rejoin'])).toBe(true);
    expect(refusedSince(log, 1, ['invalid_rejoin'])).toBe(false);
    expect(refusedSince(log, 1, ['invalid_game', 'game_full'])).toBe(true);
    expect(refusedSince(log, 3, ['game_full'])).toBe(false);
  });
});

describe('hasSessionSince', () => {
  const log: WebSocketMessage[] = [
    { type: 'error', code: 'invalid_game', message: 'Cannot join' },
    { type: 'game_created', gameId: 'ABC', color: 'white' },
    { type: 'presence', color: 'black', online: true },
  ];

  it('finds a session-establishing message only at or after the given index', () => {
    expect(hasSessionSince(log, 0)).toBe(true);
    expect(hasSessionSince(log, 1)).toBe(true);
    expect(hasSessionSince(log, 2)).toBe(false);
    expect(hasSessionSince([{ type: 'game_joined', color: 'black' }], 0)).toBe(true);
    expect(hasSessionSince([{ type: 'game_start', color: 'black' }], 0)).toBe(true);
    expect(
      hasSessionSince([{ type: 'game_state', color: 'black', started: true, moves: [] }], 0),
    ).toBe(true);
  });
});

describe('startedLive', () => {
  const snapshot = (started: boolean): WebSocketMessage => ({
    type: 'game_state',
    color: 'white',
    started,
    moves: [],
  });

  it('is true when the game started while the page was open', () => {
    expect(startedLive([{ type: 'game_start', color: 'white' }])).toBe(true);
    // A creator who reloaded while waiting, then saw the opponent arrive
    expect(startedLive([snapshot(false), { type: 'game_start', color: 'white' }])).toBe(true);
    // A reconnect's snapshot after the live start changes nothing
    expect(startedLive([{ type: 'game_start', color: 'white' }, snapshot(true)])).toBe(true);
  });

  it('is false for a page that opened on a game already under way, or not yet started', () => {
    expect(startedLive([snapshot(true)])).toBe(false);
    expect(startedLive([snapshot(true), { type: 'game_start', color: 'white' }])).toBe(false);
    expect(startedLive([])).toBe(false);
  });
});
