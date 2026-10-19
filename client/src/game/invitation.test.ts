import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GAME_ID, selectInvitation } from './invitation';
import type { WebSocketMessage } from '../types/messages';

const info = (seats: ('white' | 'black')[], gameId = 'GAME01'): WebSocketMessage => ({
  type: 'game_info',
  gameId,
  seats,
});

describe('selectInvitation', () => {
  it('is opening until the server answers the look', () => {
    expect(selectInvitation([], 'GAME01', false)).toEqual({ state: 'opening' });
  });

  it('offers the seat the host left free', () => {
    expect(selectInvitation([info(['white'])], 'GAME01', false)).toEqual({
      state: 'open',
      seat: 'black',
    });
    expect(selectInvitation([info(['black'])], 'GAME01', false)).toEqual({
      state: 'open',
      seat: 'white',
    });
  });

  it('ignores another game’s answer', () => {
    expect(selectInvitation([info(['white'], 'OTHER')], 'GAME01', false)).toEqual({
      state: 'opening',
    });
  });

  it('is joining once accepted, for the offered seat', () => {
    expect(selectInvitation([info(['white'])], 'GAME01', true)).toEqual({
      state: 'joining',
      seat: 'black',
    });
    // Accepted before the look was answered (a drop): the seat follows later
    expect(selectInvitation([], 'GAME01', true).state).toBe('joining');
  });

  it('says a game with both seats taken is full', () => {
    expect(selectInvitation([info(['white', 'black'])], 'GAME01', false)).toEqual({
      state: 'full',
    });
    expect(
      selectInvitation(
        [info(['white']), { type: 'error', code: 'game_full', message: 'Game full' }],
        'GAME01',
        true,
      ),
    ).toEqual({ state: 'full' });
  });

  it('says a missing game is gone', () => {
    expect(
      selectInvitation(
        [{ type: 'error', code: 'invalid_game', message: 'No such game' }],
        'GAME01',
        false,
      ),
    ).toEqual({ state: 'gone' });
  });

  it('says an id the server would never make is gone, before any answer', () => {
    for (const id of ['abc123', 'ABC12', 'ABC1234', 'A'.repeat(5000), ''])
      expect(selectInvitation([], id, false)).toEqual({ state: 'gone' });
  });
});

describe('GAME_ID', () => {
  it('is the server’s rule: six capitals or digits', () => {
    const server = readFileSync(join(process.cwd(), '../server/modal_app.py'), 'utf8');
    expect(server).toContain('GAME_ID_CHARS = string.ascii_uppercase + string.digits\n');
    expect(server).toContain('GAME_ID = re.compile(f"[{GAME_ID_CHARS}]{{6}}")');
    expect(GAME_ID.source).toBe('^[A-Z0-9]{6}$');
    // (and the early socket's copy, written out in its self-contained script)
    const early = readFileSync(join(process.cwd(), 'src/lib/earlySocket.ts'), 'utf8');
    expect(early).toContain('/^\\/game\\/([A-Z0-9]{6})\\/?$/');
  });
});
