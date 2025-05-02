import { useEffect, useRef } from 'react';

const WS_URL = 'wss://howard-modal-labs--3d-chess-backend-serve.modal.run/ws';

export function useGameSocket() {
  const socketRef = useRef<WebSocket | null>(null);
  const lastMessage = useRef<MessageEvent | null>(null);

  const send = (msg: any) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(msg));
    }
  };

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    socketRef.current = ws;

    ws.onmessage = (event) => {
      lastMessage.current = event;
    };

    return () => {
      ws.close();
      socketRef.current = null;
    };
  }, []);

  return { send, lastMessage };
}
