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
  const WS_URL = 'wss://howard-modal-labs--3d-chess-backend-serve.modal.run/ws';

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
