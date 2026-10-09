import { useCallback, useEffect, useRef, useState } from 'react';
import type { WebSocketMessage } from '../types/messages';
import { DEFAULT_WS_URL, takeEarlySocket } from '../lib/earlySocket';
import type { EarlySocket } from '../lib/earlySocket';

export const WS_URL: string = import.meta.env.VITE_WS_URL ?? DEFAULT_WS_URL;

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

/** A message as received (the server only sends schema-conformant JSON). */
const parse = (data: string): WebSocketMessage => {
  try {
    return JSON.parse(data) as WebSocketMessage;
  } catch {
    // A parse failure is a protocol violation: surfaced like any server
    // error instead of letting the exception kill the message handler
    return {
      type: 'error',
      code: 'invalid_message',
      message: 'Received a malformed message from the server',
    };
  }
};

type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'replaced';

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
   * Whether a message like this was sent on the current session (by send(),
   * or by the page's inline script before the app loaded: earlySocket.ts),
   * so a screen asks the server once per session.
   */
  sentThisSession?: (match: (msg: WebSocketMessage) => boolean) => boolean;
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
  // The socket the page opened before the app loaded, if any (first mount only)
  const [early] = useState<{ socket: EarlySocket; open: boolean; seen: number } | null>(() => {
    const e = takeEarlySocket();
    return e
      ? { socket: e, open: e.socket.readyState === WebSocket.OPEN, seen: e.received.length }
      : null;
  });
  const socketRef = useRef<WebSocket | null>(null);
  // Messages passed to send() before the socket is open; flushed on open.
  const outgoingQueueRef = useRef<WebSocketMessage[]>([]);
  // True once this session has sent or received anything (reset() is a no-op otherwise).
  const hasActivityRef = useRef(
    !!early && (early.socket.received.length > 0 || !!early.socket.sent),
  );
  // Mirrors messages.length so socket callbacks can read it without stale closures.
  const messageCountRef = useRef(early?.seen ?? 0);
  const sessionCounterRef = useRef(early?.open ? 1 : 0);
  // What was sent on the current session
  const sentRef = useRef<WebSocketMessage[]>(
    early?.open && early.socket.sent ? [early.socket.sent] : [],
  );
  // Consecutive failed/dropped connections, for backoff; cleared on open.
  const attemptRef = useRef(0);
  // An early socket's messages so far are this log's first
  const [messages, setMessages] = useState<WebSocketMessage[]>(() =>
    early ? early.socket.received.slice(0, early.seen).map(parse) : [],
  );
  const [status, setStatus] = useState<ConnectionStatus>(early?.open ? 'connected' : 'connecting');
  const [session, setSession] = useState(
    early?.open ? { id: 1, startIndex: 0 } : { id: 0, startIndex: 0 },
  );
  // Bumping the generation tears down the current socket and opens a new one.
  const [generation, setGeneration] = useState(0);

  // Stable identities: consumers list these in effect dependencies, and App
  // depends on `reset` running once per navigation, not once per render.
  const send = useCallback((msg: WebSocketMessage) => {
    hasActivityRef.current = true;
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg));
      sentRef.current.push(msg);
      return true;
    }
    outgoingQueueRef.current.push(msg);
    return false;
  }, []);

  const sentThisSession = useCallback(
    (match: (msg: WebSocketMessage) => boolean) => sentRef.current.some(match),
    [],
  );

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

  // The early socket, adopted once (the effect's first run)
  const adoptRef = useRef(early);

  useEffect(() => {
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const adopted = adoptRef.current;
      adoptRef.current = null;
      const usable =
        adopted &&
        (adopted.socket.socket.readyState === WebSocket.CONNECTING ||
          adopted.socket.socket.readyState === WebSocket.OPEN);
      const ws = usable ? adopted.socket.socket : new WebSocket(WS_URL);
      socketRef.current = ws;

      // Sends what was queued before the socket was open, but moves (below)
      const flush = () => {
        const queued = outgoingQueueRef.current.filter((m) => m.type !== 'move');
        outgoingQueueRef.current = [];
        for (const msg of queued) {
          ws.send(JSON.stringify(msg));
          sentRef.current.push(msg);
        }
      };
      const opened = () => {
        if (disposed || socketRef.current !== ws) return;
        attemptRef.current = 0;
        sentRef.current = [];
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
        flush();
      };
      ws.onopen = opened;

      ws.onmessage = (event) => {
        // A superseded socket (reset, replaced) may still deliver a reply in
        // flight; it belongs to a session this log no longer describes.
        if (disposed || socketRef.current !== ws) return;
        hasActivityRef.current = true;
        const parsed = parse(String(event.data));
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

      if (adopted && !usable) {
        // Closed before it could be taken over: what was queued on its session
        // is asked again on the next one
        outgoingQueueRef.current = [];
      }
      if (usable && adopted) {
        // What the early socket did between the first render and now
        const { received, sent } = adopted.socket;
        if (ws.readyState === WebSocket.OPEN && !adopted.open) {
          // Opened since: its session starts here (its request already sent)
          opened();
          if (sent) sentRef.current.push(sent);
          hasActivityRef.current ||= !!sent;
        } else if (adopted.open) {
          // Open since the first render: what the screens asked for before
          // this effect ran (their effects run first) goes out now
          flush();
        }
        const late = received.slice(adopted.seen).map(parse);
        if (late.length) {
          hasActivityRef.current = true;
          messageCountRef.current += late.length;
          setMessages((prev) => [...prev, ...late]);
        }
      }
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
    sentThisSession,
    reconnect,
    reset,
  };
}
