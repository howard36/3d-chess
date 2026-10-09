import type { WebSocketMessage } from '../types/messages';

// The page's socket, opened before the app has loaded. A page load's first
// wait is the server: a reopened game's record, or a guest's invitation
// (which seats are free). The app opens its socket after React's first
// commit, and the socket's open is then handled after the scene's chunk has
// been evaluated, so its first request went out ~150 ms into the page. The
// built page instead runs `startEarlySocket` from an inline script in
// index.html (vite.config.ts), while the entry is still loading: it opens
// the socket, sends the page's first request on a game's address (the same
// one GameScreen would send: a rejoin with the seat stored for the game, or
// a look), and keeps what comes back. useGameSocket adopts it on its first
// mount (takeEarlySocket) as its first session: the messages, and the
// request already sent on it, which the screen then doesn't send again.

/** The game server, unless the build names another (VITE_WS_URL). */
export const DEFAULT_WS_URL = 'wss://howard36--3d-chess-backend-serve.modal.run/ws';

/** What the inline script leaves for the app. */
export interface EarlySocket {
  socket: WebSocket;
  /** The raw messages received so far, in order. */
  received: string[];
  /** The request sent on the socket as it opened, if any. */
  sent: WebSocketMessage | null;
}

declare global {
  interface Window {
    __earlySocket?: EarlySocket;
  }
}

/** The storage keys the app uses (playerRole.ts, clientId.ts), for the inline script. */
export interface EarlyKeys {
  role: string;
  clientId: string;
}

/**
 * The inline script's body: self-contained (vite.config.ts injects its
 * source), so it may use nothing from outside but its arguments.
 */
export function startEarlySocket(url: string, keys: EarlyKeys): void {
  try {
    const socket = new WebSocket(url);
    const early: EarlySocket = { socket, received: [], sent: null };
    window.__earlySocket = early;
    socket.onmessage = (event) => {
      early.received.push(String(event.data));
    };
    socket.onopen = () => {
      const match = /^\/game\/([^/]+)\/?$/.exec(location.pathname);
      if (!match) return;
      let message: WebSocketMessage;
      try {
        // (a malformed address: the app decides)
        const gameId = decodeURIComponent(match[1]);
        const color = localStorage.getItem(keys.role + gameId);
        if (color === 'white' || color === 'black') {
          let clientId = sessionStorage.getItem(keys.clientId);
          if (!clientId) {
            // (as the app's own, from where it can: else the app asks for itself)
            if (typeof crypto === 'undefined' || !('randomUUID' in crypto)) return;
            clientId = crypto.randomUUID();
            sessionStorage.setItem(keys.clientId, clientId);
          }
          message = { type: 'rejoin_game', gameId, color, clientId, takeover: true };
        } else message = { type: 'look_game', gameId };
      } catch {
        // Storage unavailable: the app decides
        return;
      }
      socket.send(JSON.stringify(message));
      early.sent = message;
    };
  } catch {
    // No early socket: the app opens its own
  }
}

let taken = false;

/**
 * The early socket, once (to the first caller), while it is still worth
 * adopting (connecting or open); null otherwise.
 */
export function takeEarlySocket(): EarlySocket | null {
  if (taken || typeof window === 'undefined') return null;
  taken = true;
  const early = window.__earlySocket;
  delete window.__earlySocket;
  if (!early) return null;
  const state = early.socket.readyState;
  if (state !== WebSocket.CONNECTING && state !== WebSocket.OPEN) return null;
  return early;
}

/** For tests: lets the next takeEarlySocket look again. */
export function resetEarlySocketForTests(): void {
  taken = false;
}
