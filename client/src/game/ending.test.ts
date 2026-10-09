import { describe, expect, it } from 'vitest';
import { selectDrawOffer, selectEnding, withEnding } from './ending';
import { deriveHistory } from './history';
import type { GameState, MoveMade, WebSocketMessage } from '../types/messages';

const state = (over: Partial<GameState> = {}): GameState => ({
  type: 'game_state',
  color: 'white',
  started: true,
  moves: [],
  ...over,
});
const made: MoveMade = { type: 'move_made', by: 'white', from: 'Bc2', to: 'Cc2' };

describe('selectEnding', () => {
  it('is null while the players have decided nothing', () => {
    expect(selectEnding([])).toBeNull();
    expect(selectEnding([state(), made, { type: 'draw_offered', by: 'white', ply: 1 }])).toBeNull();
  });

  it('reads a resignation or an agreed draw, live or from a snapshot', () => {
    expect(
      selectEnding([state(), { type: 'game_ended', result: 'resignation', winner: 'black' }]),
    ).toEqual({ result: 'resignation', winner: 'black' });
    expect(selectEnding([state({ ending: { result: 'agreement' } })])).toEqual({
      result: 'agreement',
    });
    // A later snapshot supersedes what came before it
    expect(selectEnding([{ type: 'game_ended', result: 'agreement' }, state(), made])).toBeNull();
  });

  it('hands back the previous result while it says the same', () => {
    const log: WebSocketMessage[] = [state(), { type: 'game_ended', result: 'agreement' }];
    const first = selectEnding(log);
    const again = selectEnding(
      [...log, { type: 'presence', color: 'black', online: false }],
      first,
    );
    expect(again).toBe(first);
    const other = selectEnding(
      [state({ ending: { result: 'resignation', winner: 'white' } })],
      first,
    );
    expect(other).not.toBe(first);
    expect(other).toEqual({ result: 'resignation', winner: 'white' });
  });
});

describe('withEnding', () => {
  it('folds the ending in, unless the board ended the game first', () => {
    const history = deriveHistory([state()]);
    expect(withEnding(history, null)).toBe(history);
    const resigned = withEnding(history, { result: 'resignation', winner: 'white' });
    expect(resigned.gameOver).toEqual({ result: 'resignation', winner: 'white' });
    // The board and the record are the replay's own
    expect(resigned.board).toBe(history.board);
    expect(resigned.moveRecords).toBe(history.moveRecords);
    const mated = {
      ...history,
      gameOver: { result: 'checkmate' as const, winner: 'black' as const },
    };
    expect(withEnding(mated, { result: 'agreement' })).toBe(mated);
  });
});

describe('selectDrawOffer', () => {
  const none = { standing: null, declined: null, canOffer: true };

  it('has none to begin with', () => {
    expect(selectDrawOffer([], 0)).toEqual(none);
    expect(selectDrawOffer([state()], 0)).toEqual(none);
  });

  it('stands until declined, and is made once a move', () => {
    const offered: WebSocketMessage[] = [state(), { type: 'draw_offered', by: 'white', ply: 0 }];
    expect(selectDrawOffer(offered, 0)).toEqual({
      standing: 'white',
      declined: null,
      canOffer: false,
    });
    expect(
      selectDrawOffer([...offered, { type: 'draw_declined', by: 'black', ply: 0 }], 0),
    ).toEqual({ standing: null, declined: 'white', canOffer: false });
  });

  it('lapses with a move, whichever order the two arrive in', () => {
    const offer = { type: 'draw_offered', by: 'black', ply: 0 } as const;
    expect(selectDrawOffer([state(), offer, made], 1)).toEqual(none);
    expect(selectDrawOffer([state(), made, offer], 1)).toEqual(none);
    // An offer made after the move stands, whichever arrives first
    const later = { type: 'draw_offered', by: 'black', ply: 1 } as const;
    expect(selectDrawOffer([state(), later, made], 1).standing).toBe('black');
  });

  it('comes back with a snapshot', () => {
    expect(selectDrawOffer([state({ drawOffer: { by: 'black', ply: 2 } })], 2).standing).toBe(
      'black',
    );
    expect(
      selectDrawOffer([state({ drawOffer: { by: 'black', ply: 2, declined: true } })], 2),
    ).toEqual({ standing: null, declined: 'black', canOffer: false });
    // ...and is gone once a move has been played since
    expect(selectDrawOffer([state({ drawOffer: { by: 'black', ply: 2 } })], 3)).toEqual(none);
  });
});
