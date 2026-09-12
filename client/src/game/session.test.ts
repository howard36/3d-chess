import { describe, expect, it } from 'vitest';
import { hasSessionSince, selectErrors, selectOpponentOnline, selectSeat } from './session';
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

describe('selectErrors / hasSessionSince', () => {
  const log: WebSocketMessage[] = [
    { type: 'error', code: 'invalid_game', message: 'Cannot join' },
    { type: 'game_created', gameId: 'ABC', color: 'white' },
    { type: 'presence', color: 'black', online: true },
  ];

  it('lists server errors in order', () => {
    expect(selectErrors(log).map((e) => e.code)).toEqual(['invalid_game']);
  });

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
