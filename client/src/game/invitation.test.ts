import { describe, expect, it } from 'vitest';
import { selectInvitation } from './invitation';
import type { WebSocketMessage } from '../types/messages';

const info = (seats: ('white' | 'black')[], gameId = 'G1'): WebSocketMessage => ({
  type: 'game_info',
  gameId,
  seats,
});

describe('selectInvitation', () => {
  it('is opening until the server answers the look', () => {
    expect(selectInvitation([], 'G1', false)).toEqual({ state: 'opening' });
  });

  it('offers the seat the host left free', () => {
    expect(selectInvitation([info(['white'])], 'G1', false)).toEqual({
      state: 'open',
      seat: 'black',
    });
    expect(selectInvitation([info(['black'])], 'G1', false)).toEqual({
      state: 'open',
      seat: 'white',
    });
  });

  it('ignores another game’s answer', () => {
    expect(selectInvitation([info(['white'], 'OTHER')], 'G1', false)).toEqual({
      state: 'opening',
    });
  });

  it('is joining once accepted, for the offered seat', () => {
    expect(selectInvitation([info(['white'])], 'G1', true)).toEqual({
      state: 'joining',
      seat: 'black',
    });
    // Accepted before the look was answered (a drop): the seat follows later
    expect(selectInvitation([], 'G1', true).state).toBe('joining');
  });

  it('says a game with both seats taken is full', () => {
    expect(selectInvitation([info(['white', 'black'])], 'G1', false)).toEqual({ state: 'full' });
    expect(
      selectInvitation(
        [info(['white']), { type: 'error', code: 'game_full', message: 'Game full' }],
        'G1',
        true,
      ),
    ).toEqual({ state: 'full' });
  });

  it('says a missing game is gone', () => {
    expect(
      selectInvitation(
        [{ type: 'error', code: 'invalid_game', message: 'No such game' }],
        'G1',
        false,
      ),
    ).toEqual({ state: 'gone' });
  });
});
