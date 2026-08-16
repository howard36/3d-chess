import { useEffect, useRef, useState } from 'react';
import type { WebSocketMessage } from '../types/messages';

const WS_URL: string =
  import.meta.env.VITE_WS_URL ?? 'wss://howard36--3d-chess-backend-serve.modal.run/ws';

/** Delay before reconnect attempt n (0-based): 0.5s, 1s, 2s, 4s, then 8s forever. */
const reconnectDelayMs = (attempt: number) => Math.min(500 * 2 ** attempt, 8000);

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting';

export interface GameSocket {
  send: (msg: WebSocketMessage) => void;
  /** All messages received on this session, in arrival order (append-only). */
  messages: WebSocketMessage[];
  /**
   * 'connecting' before the first socket of a session opens, 'reconnecting'
   * after an unexpected drop while the automatic retry loop runs.
   */
  status: ConnectionStatus;
  /**
   * Bumps each time a socket finishes opening (first connect and every
   * reconnect). The server keeps no memory of previous sockets, so each bump
   * means a claimed seat must be re-claimed via rejoin_game.
   */
  sessionId: number;
  /** Index into `messages` of the first message received on the current socket. */
  sessionStartIndex: number;
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

  const send = (msg: WebSocketMessage) => {
    hasActivityRef.current = true;
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg));
    } else {
      outgoingQueueRef.current.push(msg);
    }
  };

  const reset = () => {
    if (!hasActivityRef.current) return;
    hasActivityRef.current = false;
    outgoingQueueRef.current = [];
    messageCountRef.current = 0;
    attemptRef.current = 0;
    setMessages([]);
    setStatus('connecting');
    setGeneration((g) => g + 1);
  };

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

      ws.onclose = () => {
        if (disposed || socketRef.current !== ws) return;
        socketRef.current = null;
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
    reset,
  };
}
