import WS from 'jest-websocket-mock';
import { render, renderHook, act, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameSocket, WS_URL } from './useGameSocket';
import { resetEarlySocketForTests, startEarlySocket, takeEarlySocket } from '../lib/earlySocket';
import { ROLE_KEY_PREFIX } from '../lib/playerRole';
import { CLIENT_ID_KEY } from '../lib/clientId';

// The socket a built page opens from index.html before the app has loaded
// (lib/earlySocket.ts), and its adoption by useGameSocket.

const keys = { role: ROLE_KEY_PREFIX, clientId: CLIENT_ID_KEY };

describe('the early socket', () => {
  let server: WS;

  beforeEach(() => {
    server = new WS(WS_URL);
    resetEarlySocketForTests();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    WS.clean();
    delete window.__earlySocket;
    window.history.pushState({}, '', '/');
  });

  it('rejoins the seat stored for the game on its address, and keeps what comes back', async () => {
    window.history.pushState({}, '', '/game/ABC123');
    localStorage.setItem(`${ROLE_KEY_PREFIX}ABC123`, 'black');
    startEarlySocket(WS_URL, keys);
    await server.connected;
    const rejoin = JSON.parse((await server.nextMessage) as string);
    expect(rejoin).toMatchObject({
      type: 'rejoin_game',
      gameId: 'ABC123',
      color: 'black',
      takeover: true,
    });
    // The app's own id for this tab, kept for it
    expect(rejoin.clientId).toBe(sessionStorage.getItem(CLIENT_ID_KEY));
    server.send(JSON.stringify({ type: 'game_state', color: 'black', started: true, moves: [] }));
    expect(window.__earlySocket!.received).toHaveLength(1);
  });

  it('asks which seats are free on a game with no seat stored, and nothing elsewhere', async () => {
    window.history.pushState({}, '', '/game/XYZ789');
    startEarlySocket(WS_URL, keys);
    await server.connected;
    await expect(server).toReceiveMessage(JSON.stringify({ type: 'look_game', gameId: 'XYZ789' }));
    WS.clean();
    server = new WS(WS_URL);
    window.history.pushState({}, '', '/new');
    startEarlySocket(WS_URL, keys);
    await server.connected;
    expect(window.__earlySocket!.sent).toBeNull();
  });

  it('is adopted once, while it is connecting or open', async () => {
    startEarlySocket(WS_URL, keys);
    expect(takeEarlySocket()).not.toBeNull();
    expect(takeEarlySocket()).toBeNull();
    resetEarlySocketForTests();
    startEarlySocket(WS_URL, keys);
    await server.connected;
    window.__earlySocket!.socket.close();
    expect(takeEarlySocket()).toBeNull();
  });

  it('gives the app its messages in the first render, as its first session, the request sent', async () => {
    window.history.pushState({}, '', '/game/ABC123');
    localStorage.setItem(`${ROLE_KEY_PREFIX}ABC123`, 'black');
    startEarlySocket(WS_URL, keys);
    await server.connected;
    await server.nextMessage;
    const state = { type: 'game_state', color: 'black', started: true, moves: [] };
    server.send(JSON.stringify(state));
    const { result } = renderHook(() => useGameSocket());
    expect(result.current.messages).toEqual([state]);
    expect(result.current.status).toBe('connected');
    expect(result.current.sessionId).toBe(1);
    expect(result.current.sessionStartIndex).toBe(0);
    expect(
      result.current.sentThisSession!((m) => m.type === 'rejoin_game' && m.gameId === 'ABC123'),
    ).toBe(true);
    // What comes after, on the same socket: no second socket
    act(() => {
      server.send(JSON.stringify({ type: 'move_made', by: 'white', from: 'Ab1', to: 'Aa3' }));
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    expect(server.server.clients()).toHaveLength(1);
  });

  it('starts its session when it opens after the first render', async () => {
    window.history.pushState({}, '', '/game/XYZ789');
    startEarlySocket(WS_URL, keys);
    const { result } = renderHook(() => useGameSocket());
    expect(result.current.status).toBe('connecting');
    await server.connected;
    await waitFor(() => expect(result.current.status).toBe('connected'));
    expect(result.current.sessionId).toBe(1);
    // (the hook took the socket over before it opened: the app asks for itself)
    expect(result.current.sentThisSession!((m) => m.type === 'look_game')).toBe(false);
    act(() => {
      result.current.send({ type: 'look_game', gameId: 'XYZ789' });
    });
    await expect(server).toReceiveMessage(JSON.stringify({ type: 'look_game', gameId: 'XYZ789' }));
    expect(result.current.sentThisSession!((m) => m.type === 'look_game')).toBe(true);
    expect(server.server.clients()).toHaveLength(1);
  });

  it('sends what the app asked for before taking over a socket that opened asking nothing', async () => {
    // Storage that throws: the page's script leaves the request to the app
    window.history.pushState({}, '', '/game/XYZ789');
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    startEarlySocket(WS_URL, keys);
    await server.connected;
    getItem.mockRestore();
    expect(window.__earlySocket!.sent).toBeNull();
    // A screen's effect asks in the first commit, before the hook's own effect has run
    const Screen = ({ send }: { send: (m: { type: 'look_game'; gameId: string }) => void }) => {
      useEffect(() => {
        send({ type: 'look_game', gameId: 'XYZ789' });
      }, [send]);
      return null;
    };
    const App = () => {
      const socket = useGameSocket();
      return <Screen send={socket.send} />;
    };
    render(<App />);
    await expect(server).toReceiveMessage(JSON.stringify({ type: 'look_game', gameId: 'XYZ789' }));
  });

  it('does not take the page as its script left it when the address cannot be read', async () => {
    window.history.pushState({}, '', '/game/%E0%A4%A');
    startEarlySocket(WS_URL, keys);
    await server.connected;
    expect(window.__earlySocket!.sent).toBeNull();
  });
});
