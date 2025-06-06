import WS from 'jest-websocket-mock';
import 'jest-websocket-mock'; // Keep for side effects (matchers)
import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'; // Import vitest functions
import { useGameSocket } from './useGameSocket';

// Silence console.error for expected errors (like closing sockets)
beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {}); // Use vi.spyOn
});
afterAll(() => {
  // Restore the original implementation
  vi.mocked(console.error).mockRestore(); // Restore spy properly
});

describe('useGameSocket', () => {
  let server: WS;
  const gameId = 'test-game';
  const WS_URL = 'wss://howard-modal-labs--3d-chess-backend-serve.modal.run/ws';

  beforeEach(() => {
    server = new WS(WS_URL);
  });

  afterEach(() => {
    WS.clean();
  });

  it('sends create_game and receives game_created', async () => {
    const { result } = renderHook(() => useGameSocket());

    // Wait for connection
    await server.connected;

    // Send create_game
    act(() => {
      result.current.send({ type: 'create_game' });
    });

    // Server should receive the message
    // jest-websocket-mock matchers might rely on Jest's expect
    // We might need to adapt this assertion if it fails
    await expect(server).toReceiveMessage(JSON.stringify({ type: 'create_game' }));

    // Server sends game_created
    act(() => {
      server.send(JSON.stringify({ type: 'game_created', id: gameId }));
    });

    // Wait for the message to be received by the hook
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(result.current.lastMessage?.data).toBe(
      JSON.stringify({ type: 'game_created', id: gameId }),
    );
  });
});
