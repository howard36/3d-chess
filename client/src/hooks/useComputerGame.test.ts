import { act, renderHook, waitFor } from '@testing-library/react';
import { COMPUTER_UNLOADED, useComputerGame } from './useComputerGame';
import { ChunkLoadError } from '../lib/cachedImport';
import type { ComputerGameOptions } from './useComputerGame';
import { loadComputerGame, saveComputerGame } from '../lib/computerGames';
import type { Computer, ComputerMove } from '../ai/computer';
import type { Color } from '../types/messages';

afterEach(() => localStorage.clear());

const reply = (from: string, to: string): ComputerMove => ({
  move: { from, to },
  score: 0,
  depth: 1,
  nodes: 1,
  forced: false,
  obvious: false,
  ply: 0,
  tension: 1,
});

/**
 * A computer that answers from a script, recording what it was asked: moves,
 * and what it makes of a position (`scores`, centipawns for the side to move).
 */
const scripted = (
  answers: (ComputerMove | null | 'fail' | 'unloaded')[],
  scores: (number | 'fail' | 'unloaded')[] = [],
) => {
  const asked: number[] = [];
  const assessed: number[] = [];
  let disposed = false;
  let made = 0;
  const computer: Computer = {
    think: (records) => {
      asked.push(records.length);
      const a = answers.shift();
      if (a === 'unloaded') return Promise.reject(new ChunkLoadError(new Error('Failed to fetch')));
      return a === 'fail' ? Promise.reject(new Error('no')) : Promise.resolve(a ?? null);
    },
    assess: (records) => {
      assessed.push(records.length);
      const s = scores.shift() ?? 0;
      if (s === 'unloaded') return Promise.reject(new ChunkLoadError(new Error('Failed to fetch')));
      return s === 'fail' ? Promise.reject(new Error('no')) : Promise.resolve(s);
    },
    analyse: () => Promise.reject(new Error('not asked in a game')),
    dispose: () => {
      disposed = true;
    },
  };
  const make = () => {
    made++;
    return computer;
  };
  return { computer: make, asked, assessed, disposed: () => disposed, made: () => made };
};

const newGame = (color: Color, id = 'g1') =>
  saveComputerGame({ id, color, difficulty: 'easy', started: false, moves: [] });

const options = (computer: () => Computer): ComputerGameOptions => ({
  computer,
  pace: () => 0,
  drawAnswerMs: 0,
});

it('opens holding the seat, the computer seated at once, and answers like a server', async () => {
  newGame('white');
  const ai = scripted([reply('Dc4', 'Cc4')]);
  const { result, unmount } = renderHook(() => useComputerGame('g1', options(ai.computer)));
  expect(result.current.status).toBe('connected');
  expect(result.current.sessionId).toBe(1);
  // From the first render, as a rejoin's answer: the page never draws a
  // moment without its seat (and so without its lobby or its board)
  expect(result.current.messages).toEqual([
    { type: 'game_state', color: 'white', started: false, moves: [] },
    { type: 'game_start', color: 'white' },
  ]);
  expect(loadComputerGame('g1')!.started).toBe(true);
  act(() => {
    result.current.send({ type: 'move', from: 'Bc2', to: 'Cc2' });
  });
  await waitFor(() => expect(result.current.messages).toHaveLength(4));
  expect(result.current.messages.slice(2)).toEqual([
    { type: 'move_made', by: 'white', from: 'Bc2', to: 'Cc2' },
    { type: 'move_made', by: 'black', from: 'Dc4', to: 'Cc4' },
  ]);
  expect(ai.asked).toEqual([1]);
  // Kept in the browser, move by move
  expect(loadComputerGame('g1')!.moves).toHaveLength(2);
  unmount();
  expect(ai.disposed()).toBe(true);
});

it('moves first playing White, and comes back to the game after a reload', async () => {
  newGame('black');
  const ai = scripted([reply('Bc2', 'Cc2')]);
  const first = renderHook(() => useComputerGame('g1', options(ai.computer)));
  await waitFor(() => expect(first.result.current.messages).toHaveLength(3));
  expect(first.result.current.messages[2]).toMatchObject({ by: 'white', from: 'Bc2' });
  first.unmount();

  // A reload: the stored game comes back under way, with its move
  const again = renderHook(() => useComputerGame('g1', options(scripted([]).computer)));
  expect(again.result.current.messages).toEqual([
    {
      type: 'game_state',
      color: 'black',
      started: true,
      moves: [{ by: 'white', from: 'Bc2', to: 'Cc2' }],
    },
  ]);
  // A rejoin is answered the same way
  act(() => {
    again.result.current.send({ type: 'rejoin_game', gameId: 'g1', color: 'black' });
  });
  expect(again.result.current.messages[1]).toMatchObject({ type: 'game_state', started: true });
});

it('holds its move while asked to', async () => {
  newGame('black');
  const ai = scripted([reply('Bc2', 'Cc2')]);
  const { result, rerender } = renderHook(
    ({ hold }) => useComputerGame('g1', { ...options(ai.computer), hold }),
    { initialProps: { hold: true } },
  );
  await new Promise((r) => setTimeout(r, 30));
  expect(ai.asked).toEqual([]);
  expect(result.current.messages).toHaveLength(2);
  rerender({ hold: false });
  await waitFor(() => expect(result.current.messages).toHaveLength(3));
  expect(ai.asked).toEqual([0]);
});

it('plays a legal move of its own when its search fails or answers nothing', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  for (const answer of ['fail', null] as const) {
    localStorage.clear();
    newGame('black', 'g2');
    const ai = scripted([answer]);
    const { result, unmount } = renderHook(() => useComputerGame('g2', options(ai.computer)));
    await waitFor(() => expect(result.current.messages).toHaveLength(3));
    expect(result.current.messages[2]).toMatchObject({ type: 'move_made', by: 'white' });
    unmount();
  }
  // Both say so: a failed search, and one that found no move where the rules
  // have one (its board and the engine disagree)
  expect(error).toHaveBeenCalledTimes(2);
  expect(error.mock.calls[1][0]).toMatch(/found no move/);
  error.mockRestore();
});

it('makes no move when its code did not load, and says so', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  newGame('black', 'g2');
  const ai = scripted(['unloaded']);
  const { result } = renderHook(() => useComputerGame('g2', options(ai.computer)));
  await waitFor(() => expect(result.current.messages).toHaveLength(3));
  expect(result.current.messages[2]).toEqual({
    type: 'error',
    code: 'invalid_message',
    message: COMPUTER_UNLOADED,
  });
  // (and nothing played for it: the game waits for the reload)
  expect(loadComputerGame('g2')!.moves).toEqual([]);
  expect(error).toHaveBeenCalledOnce();
  error.mockRestore();
});

it('answers no draw offer when its code did not load, and says so', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  newGame('white');
  const ai = scripted([], ['unloaded']);
  const { result } = renderHook(() => useComputerGame('g1', options(ai.computer)));
  await waitFor(() => expect(result.current.messages).toHaveLength(2));
  act(() => {
    result.current.send({ type: 'offer_draw' });
  });
  await waitFor(() => expect(result.current.messages).toHaveLength(4));
  // Not a decline it never weighed up: the notice a missing search gives
  expect(result.current.messages[3]).toEqual({
    type: 'error',
    code: 'invalid_message',
    message: COMPUTER_UNLOADED,
  });
  expect(result.current.messages.some((m) => m.type === 'draw_declined')).toBe(false);
  error.mockRestore();
});

it('waits out the computer’s thinking time before its move lands', async () => {
  vi.useFakeTimers();
  try {
    newGame('black');
    const ai = scripted([reply('Bc2', 'Cc2')]);
    const { result } = renderHook(() =>
      useComputerGame('g1', { computer: ai.computer, pace: () => 1500 }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.messages.map((m) => m.type)).toEqual(['game_state', 'game_start']);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(result.current.messages).toHaveLength(3);
  } finally {
    vi.useRealTimers();
  }
});

it('refuses for a game it does not hold', () => {
  const { result } = renderHook(() => useComputerGame('nope', options(scripted([]).computer)));
  expect(result.current.messages).toEqual([]);
  act(() => {
    result.current.send({ type: 'look_game', gameId: 'nope' });
  });
  expect(result.current.messages[0]).toMatchObject({ type: 'error', code: 'invalid_game' });
  // The connection's controls do nothing: there is no connection
  result.current.reconnect();
  result.current.reset();
  expect(result.current.messages).toHaveLength(1);
});

it('lets the player resign, and keeps the ending', async () => {
  newGame('white');
  const ai = scripted([]);
  const { result, unmount } = renderHook(() => useComputerGame('g1', options(ai.computer)));
  act(() => {
    result.current.send({ type: 'resign' });
  });
  expect(result.current.messages[2]).toEqual({
    type: 'game_ended',
    result: 'resignation',
    winner: 'black',
  });
  expect(loadComputerGame('g1')!.ending).toEqual({ result: 'resignation', winner: 'black' });
  unmount();
  // A reload opens on the game as it ended
  const again = renderHook(() => useComputerGame('g1', options(scripted([]).computer)));
  expect(again.result.current.messages[0]).toMatchObject({
    type: 'game_state',
    ending: { result: 'resignation', winner: 'black' },
  });
});

it('declines a draw unless it stands clearly worse, answering before it plays on', async () => {
  newGame('black');
  // White (the computer) to move: offered a draw as it starts to think, it
  // drops that thought, weighs the offer up (from its own side), declines,
  // and only then plays
  const ai = scripted([reply('Bc2', 'Cc2'), reply('Bc2', 'Cc2')], [40]);
  const { result } = renderHook(() => useComputerGame('g1', options(ai.computer)));
  act(() => {
    result.current.send({ type: 'offer_draw' });
  });
  expect(result.current.messages[2]).toEqual({ type: 'draw_offered', by: 'black', ply: 0 });
  await waitFor(() => expect(result.current.messages).toHaveLength(5));
  expect(result.current.messages.slice(3)).toEqual([
    { type: 'draw_declined', by: 'white', ply: 0 },
    { type: 'move_made', by: 'white', from: 'Bc2', to: 'Cc2' },
  ]);
  expect(ai.assessed).toEqual([0]);
  expect(ai.asked).toEqual([0, 0]);
  expect(loadComputerGame('g1')!.drawOffer).toEqual({ by: 'black', ply: 0, declined: true });
});

it('drops a thought it no longer needs with its worker, so an offer waits on nothing', async () => {
  newGame('black');
  // White (the computer) to move: offered a draw before its search answers
  const made: { disposed: boolean; assessed: number }[] = [];
  const computer = (): Computer => {
    const me = { disposed: false, assessed: 0 };
    made.push(me);
    return {
      think: () => new Promise(() => {}),
      assess: () => {
        me.assessed++;
        return Promise.resolve(40);
      },
      analyse: () => Promise.reject(new Error('not asked in a game')),
      dispose: () => {
        me.disposed = true;
      },
    };
  };
  const { result } = renderHook(() => useComputerGame('g1', options(computer)));
  act(() => {
    result.current.send({ type: 'offer_draw' });
  });
  await waitFor(() => expect(result.current.messages[3]).toMatchObject({ type: 'draw_declined' }));
  // The busy one went, and a fresh one weighed the offer up
  expect(made).toEqual([
    { disposed: true, assessed: 0 },
    { disposed: false, assessed: 1 },
  ]);
});

it('keeps one computer for the game: its replies and an offer weighed after them', async () => {
  newGame('white');
  // (each one made anew is a worker started and its tables built, at the first search)
  const ai = scripted([reply('Dc4', 'Cc4'), reply('Dd4', 'Cd4')], [0]);
  const { result, unmount } = renderHook(() => useComputerGame('g1', options(ai.computer)));
  act(() => {
    result.current.send({ type: 'move', from: 'Bc2', to: 'Cc2' });
  });
  await waitFor(() => expect(result.current.messages).toHaveLength(4));
  act(() => {
    result.current.send({ type: 'move', from: 'Bd2', to: 'Cd2' });
  });
  await waitFor(() => expect(result.current.messages).toHaveLength(6));
  act(() => {
    result.current.send({ type: 'offer_draw' });
  });
  await waitFor(() => expect(result.current.messages[7]).toMatchObject({ type: 'draw_declined' }));
  expect([ai.asked, ai.assessed]).toEqual([[1, 3], [4]]);
  expect([ai.made(), ai.disposed()]).toEqual([1, false]);
  unmount();
  expect(ai.disposed()).toBe(true);
});

it('accepts a draw when it stands clearly worse', async () => {
  newGame('white');
  // The player (White) to move: the score is the player's, so the computer is 300 down
  const ai = scripted([], [300]);
  const { result } = renderHook(() => useComputerGame('g1', options(ai.computer)));
  act(() => {
    result.current.send({ type: 'offer_draw' });
  });
  await waitFor(() => expect(result.current.messages).toHaveLength(4));
  expect(result.current.messages[3]).toEqual({ type: 'game_ended', result: 'agreement' });
  expect(loadComputerGame('g1')!.ending).toEqual({ result: 'agreement' });
  // Nothing more after it
  act(() => {
    result.current.send({ type: 'move', from: 'Bc2', to: 'Cc2' });
  });
  expect(result.current.messages[4]).toMatchObject({ type: 'error', code: 'game_over' });
});

it('holds its move while an offer stands, and lets a move cancel the offer', async () => {
  vi.useFakeTimers();
  try {
    newGame('white');
    const ai = scripted([reply('Dc4', 'Cc4')], ['fail']);
    const { result } = renderHook(() =>
      useComputerGame('g1', { computer: ai.computer, pace: () => 0, drawAnswerMs: 1000 }),
    );
    act(() => {
      result.current.send({ type: 'offer_draw' });
    });
    // The player plays on before the computer has answered: the offer lapses
    act(() => {
      result.current.send({ type: 'move', from: 'Bc2', to: 'Cc2' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(result.current.messages.map((m) => m.type)).toEqual([
      'game_state',
      'game_start',
      'draw_offered',
      'move_made',
      'move_made',
    ]);
    expect(ai.asked).toEqual([1]);
  } finally {
    vi.useRealTimers();
  }
});

it('plays a legal move of its own when its search answers a move the rules refuse', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  newGame('black');
  // White's rook cannot reach Aa4 over its own pawn
  const ai = scripted([reply('Aa1', 'Aa4')]);
  const { result } = renderHook(() => useComputerGame('g1', options(ai.computer)));
  await waitFor(() => expect(result.current.messages).toHaveLength(3));
  expect(result.current.messages[2]).toMatchObject({ type: 'move_made', by: 'white' });
  expect(result.current.messages[2]).not.toMatchObject({ from: 'Aa1', to: 'Aa4' });
  expect(error).toHaveBeenCalledOnce();
  error.mockRestore();
});

it('declines when it cannot weigh the position up', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  newGame('black');
  const ai = scripted([], ['fail']);
  const { result } = renderHook(() =>
    useComputerGame('g1', { ...options(ai.computer), hold: true }),
  );
  act(() => {
    result.current.send({ type: 'offer_draw' });
  });
  await waitFor(() => expect(result.current.messages).toHaveLength(4));
  expect(result.current.messages[3]).toMatchObject({ type: 'draw_declined' });
  expect(error).toHaveBeenCalledOnce();
  error.mockRestore();
});

it('takes a move back: the computer drops what it was thinking over, then answers anew', async () => {
  newGame('white');
  let answerFirst: (m: ComputerMove) => void = () => {};
  const asked: number[] = [];
  const computer: Computer = {
    think: (records) => {
      asked.push(records.length);
      return asked.length === 1
        ? new Promise((resolve) => (answerFirst = resolve))
        : Promise.resolve(reply('Dd4', 'Cd4'));
    },
    assess: () => Promise.resolve(0),
    analyse: () => Promise.reject(new Error('not asked in a game')),
    dispose: () => {},
  };
  const { result } = renderHook(() =>
    useComputerGame(
      'g1',
      options(() => computer),
    ),
  );
  act(() => {
    result.current.send({ type: 'move', from: 'Bc2', to: 'Cc2' });
  });
  await waitFor(() => expect(asked).toEqual([1]));
  // Taken back while it thinks: the game as it now stands, as a rejoin's answer
  act(() => result.current.takeBack());
  expect(result.current.messages[3]).toEqual({
    type: 'game_state',
    color: 'white',
    started: true,
    moves: [],
  });
  expect(loadComputerGame('g1')!.moves).toEqual([]);
  // Its answer to the move taken back never lands
  await act(async () => answerFirst(reply('Dc4', 'Cc4')));
  expect(result.current.messages).toHaveLength(4);
  // Nothing more to take back
  act(() => result.current.takeBack());
  expect(result.current.messages).toHaveLength(4);
  // The player moves again, and the computer answers that
  act(() => {
    result.current.send({ type: 'move', from: 'Bd2', to: 'Cd2' });
  });
  await waitFor(() => expect(result.current.messages).toHaveLength(6));
  expect(result.current.messages[5]).toMatchObject({ by: 'black', from: 'Dd4', to: 'Cd4' });
  expect(loadComputerGame('g1')!.moves).toHaveLength(2);
});
