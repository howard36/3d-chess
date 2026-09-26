import { useCallback, useEffect, useRef, useState } from 'react';
import type { WebSocketMessage } from '../types/messages';

export const WS_URL: string =
  import.meta.env.VITE_WS_URL ?? 'wss://howard36--3d-chess-backend-serve.modal.run/ws';

/**
 * Close code the server sends to a socket whose seat was reclaimed by a newer
 * connection (a rejoin from another tab, or a refreshed page). Mirrors
 * SEAT_REPLACED_CLOSE_CODE in server/modal_app.py. Unlike a network drop it
 * must NOT be retried: the retry would rejoin and evict the newer socket,
 * which would retry in turn, and the two tabs would fight forever.
 */
export const SEAT_REPLACED_CLOSE_CODE = 4001;

/** Delay before reconnect attempt n (0-based): 0.5s, 1s, 2s, 4s, then 8s forever. */
const reconnectDelayMs = (attempt: number) => Math.min(500 * 2 ** attempt, 8000);

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'replaced';

export interface GameSocket {
  /**
   * Send now if the socket is open (returns true), otherwise queue the message
   * for the next socket to open (returns false). A request sent now can still
   * go unanswered if the socket drops before the reply; callers that must
   * survive that re-send on the next session (see useResendOnReconnect).
   */
  send: (msg: WebSocketMessage) => boolean;
  /** All messages received on this session, in arrival order (append-only). */
  messages: WebSocketMessage[];
  /**
   * 'connecting' before the first socket of a session opens, 'reconnecting'
   * after an unexpected drop while the automatic retry loop runs, 'replaced'
   * after the server closed the socket because a newer connection took this
   * seat (no retry; see reconnect()).
   */
  status: ConnectionStatus;
  /**
   * Bumps each time a socket finishes opening (first connect and every
   * reconnect); 0 before the first one opens and again after reset(). The
   * server keeps no memory of previous sockets, so each bump means a claimed
   * seat must be re-claimed via rejoin_game.
   */
  sessionId: number;
  /** Index into `messages` of the first message received on the current socket. */
  sessionStartIndex: number;
  /**
   * Open a fresh socket after this one was replaced. Keeps the message log;
   * the new session id makes the screen rejoin, which reclaims the seat and
   * in turn replaces the other connection.
   */
  reconnect: () => void;
  /**
   * End the current game session: close the connection, drop its messages, and
   * open a fresh connection. Used when navigating back to the start screen so a
   * new game doesn't see the previous game's messages or server-side state.
   */
  reset: () => void;
}

export function useGameSocket(): GameSocket {
  const socketRef = useRef<WebSocket | null>(null);
  // Messages passed to send() before the socket is open; flushed on open.
  const outgoingQueueRef = useRef<WebSocketMessage[]>([]);
  // True once this session has sent or received anything (reset() is a no-op otherwise).
  const hasActivityRef = useRef(false);
  // Mirrors messages.length so socket callbacks can read it without stale closures.
  const messageCountRef = useRef(0);
  const sessionCounterRef = useRef(0);
  // Consecutive failed/dropped connections, for backoff; cleared on open.
  const attemptRef = useRef(0);
  const [messages, setMessages] = useState<WebSocketMessage[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [session, setSession] = useState({ id: 0, startIndex: 0 });
  // Bumping the generation tears down the current socket and opens a new one.
  const [generation, setGeneration] = useState(0);

  // Stable identities: consumers list these in effect dependencies, and App
  // depends on `reset` running once per navigation, not once per render.
  const send = useCallback((msg: WebSocketMessage) => {
    hasActivityRef.current = true;
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg));
      return true;
    }
    outgoingQueueRef.current.push(msg);
    return false;
  }, []);

  const reconnect = useCallback(() => {
    attemptRef.current = 0;
    setStatus('connecting');
    setGeneration((g) => g + 1);
  }, []);

  const reset = useCallback(() => {
    if (!hasActivityRef.current) return;
    hasActivityRef.current = false;
    outgoingQueueRef.current = [];
    messageCountRef.current = 0;
    attemptRef.current = 0;
    setMessages([]);
    setStatus('connecting');
    // No session until the fresh socket opens: a screen must not mistake the
    // old socket's session for its own and send on it as it is torn down.
    setSession({ id: 0, startIndex: 0 });
    setGeneration((g) => g + 1);
  }, []);

  useEffect(() => {
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const ws = new WebSocket(WS_URL);
      socketRef.current = ws;

      ws.onopen = () => {
        if (disposed || socketRef.current !== ws) return;
        attemptRef.current = 0;
        // A fresh socket is a fresh server-side session: the server has no
        // idea who this connection is until it creates/joins/rejoins a game.
        // Bumping the session id is what tells consumers to re-establish that.
        sessionCounterRef.current += 1;
        setSession({ id: sessionCounterRef.current, startIndex: messageCountRef.current });
        setStatus('connected');
        // A queued move was made against a board that may have moved on by
        // now, and it was never echoed so the board never showed it — dropping
        // it is consistent, the player just moves again. Session-establishing
        // messages (create/join/rejoin) are exactly what the queue is for.
        const queued = outgoingQueueRef.current.filter((m) => m.type !== 'move');
        outgoingQueueRef.current = [];
        for (const msg of queued) {
          ws.send(JSON.stringify(msg));
        }
      };

      ws.onmessage = (event) => {
        // A superseded socket (reset, replaced) may still deliver a reply in
        // flight; it belongs to a session this log no longer describes.
        if (disposed || socketRef.current !== ws) return;
        hasActivityRef.current = true;
        let parsed: WebSocketMessage;
        try {
          parsed = JSON.parse(event.data) as WebSocketMessage;
        } catch {
          // The server only sends schema-conformant JSON; a parse failure is a
          // protocol violation. Surface it like any server error instead of
          // letting the exception kill the message handler.
          parsed = {
            type: 'error',
            code: 'invalid_message',
            message: 'Received a malformed message from the server',
          };
        }
        messageCountRef.current += 1;
        setMessages((prev) => [...prev, parsed]);
      };

      ws.onclose = (event) => {
        if (disposed || socketRef.current !== ws) return;
        socketRef.current = null;
        if (event.code === SEAT_REPLACED_CLOSE_CODE) {
          // Deliberate eviction by a newer connection, not a network fault:
          // stay down until the user asks for the seat back (reconnect()).
          setStatus('replaced');
          return;
        }
        setStatus('reconnecting');
        retryTimer = setTimeout(connect, reconnectDelayMs(attemptRef.current++));
      };
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [generation]);

  return {
    send,
    messages,
    status,
    sessionId: session.id,
    sessionStartIndex: session.startIndex,
    reconnect,
    reset,
  };
}
