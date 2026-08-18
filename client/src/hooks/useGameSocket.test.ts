import WS from 'jest-websocket-mock';
import { renderHook, act, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { useGameSocket } from './useGameSocket';

// Silence console.error for expected errors (like closing sockets)
beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  vi.mocked(console.error).mockRestore();
});

describe('useGameSocket', () => {
  let server: WS;
  const WS_URL = 'wss://howard36--3d-chess-backend-serve.modal.run/ws';

  beforeEach(() => {
    server = new WS(WS_URL);
  });

  afterEach(() => {
    WS.clean();
  });

  it('queues messages sent before the socket opens and flushes them on open', async () => {
    const { result } = renderHook(() => useGameSocket());

    // Send immediately, before the connection has opened
    act(() => {
      result.current.send({ type: 'create_game' });
    });

    await server.connected;
    await expect(server).toReceiveMessage(JSON.stringify({ type: 'create_game' }));
  });

  it('sends immediately once open and receives messages', async () => {
    const { result } = renderHook(() => useGameSocket());
    await server.connected;

    act(() => {
      result.current.send({ type: 'join_game', gameId: 'ABC123' });
    });
    await expect(server).toReceiveMessage(
      JSON.stringify({ type: 'join_game', gameId: 'ABC123' }),
    );

    act(() => {
      server.send(JSON.stringify({ type: 'game_created', gameId: 'ABC123' }));
    });
    await waitFor(() => {
      expect(result.current.messages).toContainEqual({ type: 'game_created', gameId: 'ABC123' });
    });
  });

  it('keeps every message when several arrive in quick succession', async () => {
    const { result } = renderHook(() => useGameSocket());
    await server.connected;

    act(() => {
      server.send(JSON.stringify({ type: 'game_start', color: 'white' }));
      server.send(JSON.stringify({ type: 'move_made', by: 'white', from: 'Aa2', to: 'Aa3' }));
      server.send(JSON.stringify({ type: 'move_made', by: 'black', from: 'Ee4', to: 'Ee3' }));
    });

    await waitFor(() => {
      expect(result.current.messages).toEqual([
        { type: 'game_start', color: 'white' },
        { type: 'move_made', by: 'white', from: 'Aa2', to: 'Aa3' },
        { type: 'move_made', by: 'black', from: 'Ee4', to: 'Ee3' },
      ]);
    });
  });

  it('reconnects after an unexpected drop, bumps the session, and keeps the log', async () => {
    const { result } = renderHook(() => useGameSocket());
    await server.connected;
    act(() => {
      server.send(JSON.stringify({ type: 'game_start', color: 'white' }));
    });
    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });
    expect(result.current.status).toBe('connected');
    const firstSession = result.current.sessionId;
    expect(firstSession).toBeGreaterThan(0);
    expect(result.current.sessionStartIndex).toBe(0);

    // The server drops the connection (network blip, Modal timeout, ...)
    act(() => {
      server.close();
    });
    await waitFor(() => {
      expect(result.current.status).toBe('reconnecting');
    });

    // The server comes back; the hook's retry loop finds it by itself
    server = new WS(WS_URL);
    await server.connected;
    await waitFor(
      () => {
        expect(result.current.status).toBe('connected');
      },
      { timeout: 3000 },
    );
    // New socket = new server-side session, starting after the retained log
    expect(result.current.sessionId).toBe(firstSession + 1);
    expect(result.current.sessionStartIndex).toBe(1);
    expect(result.current.messages).toHaveLength(1);
  });

  it('flushes queued messages on reconnect but drops stale moves', async () => {
    const { result } = renderHook(() => useGameSocket());
    await server.connected;
    act(() => {
      server.close();
    });
    await waitFor(() => {
      expect(result.current.status).toBe('reconnecting');
    });

    // Sent while disconnected: the move must not survive into the next
    // session (the game may have moved on), the rejoin must.
    act(() => {
      result.current.send({ type: 'move', from: 'Ab2', to: 'Ab3' });
      result.current.send({ type: 'rejoin_game', gameId: 'ABC123', color: 'white' });
    });

    server = new WS(WS_URL);
    await server.connected;
    await expect(server).toReceiveMessage(
      JSON.stringify({ type: 'rejoin_game', gameId: 'ABC123', color: 'white' }),
    );
    expect(server.messages).not.toContainEqual(
      JSON.stringify({ type: 'move', from: 'Ab2', to: 'Ab3' }),
    );
  });

  it('surfaces a malformed server frame as an error message instead of throwing', async () => {
    const { result } = renderHook(() => useGameSocket());
    await server.connected;
    act(() => {
      server.send('this is not JSON');
    });
    await waitFor(() => {
      expect(result.current.messages).toContainEqual({
        type: 'error',
        code: 'invalid_message',
        message: 'Received a malformed message from the server',
      });
    });
  });

  it('reset() drops the session messages and opens a fresh connection', async () => {
    const { result } = renderHook(() => useGameSocket());
    await server.connected;

    act(() => {
      server.send(JSON.stringify({ type: 'game_created', gameId: 'OLD001' }));
    });
    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.messages).toEqual([]);
    // A new connection is established and works
    await server.connected;
    act(() => {
      result.current.send({ type: 'create_game' });
    });
    await expect(server).toReceiveMessage(JSON.stringify({ type: 'create_game' }));
  });
});
