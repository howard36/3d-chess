import { useEffect, useRef, useState } from 'react';
import type { WebSocketMessage } from '../types/messages';

const WS_URL: string =
  import.meta.env.VITE_WS_URL ?? 'wss://howard36--3d-chess-backend-serve.modal.run/ws';

export interface GameSocket {
  send: (msg: WebSocketMessage) => void;
  /** All messages received on this session, in arrival order (append-only). */
  messages: WebSocketMessage[];
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
  const [messages, setMessages] = useState<WebSocketMessage[]>([]);
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
    setMessages([]);
    setGeneration((g) => g + 1);
  };

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    socketRef.current = ws;

    ws.onopen = () => {
      const queued = outgoingQueueRef.current;
      outgoingQueueRef.current = [];
      for (const msg of queued) {
        ws.send(JSON.stringify(msg));
      }
    };

    ws.onmessage = (event) => {
      hasActivityRef.current = true;
      // The server only sends schema-conformant JSON; a parse failure here is a
      // protocol violation and should surface as an error rather than be swallowed.
      const parsed = JSON.parse(event.data) as WebSocketMessage;
      setMessages((prev) => [...prev, parsed]);
    };

    return () => {
      ws.close();
      socketRef.current = null;
    };
  }, [generation]);

  return { send, messages, reset };
}
