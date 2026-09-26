import React from 'react';
import type { WebSocketMessage } from '../types/messages';
import type { GameSocket } from './useGameSocket';

interface Pending {
  msg: WebSocketMessage;
  /** Session the request went out on; null while it waits in the queue. */
  sentOn: number | null;
  /** Session that was current when it was queued (the queue flushes on the next). */
  queuedAt: number;
}

/**
 * Sends a request whose answer must not be lost to a dropped connection
 * (create_game, join_game), and sends it again on every new socket session
 * until `answered` turns true. The server forgets a socket the moment it
 * drops, so a request that went out on a socket that died before replying
 * gets no answer on the next one unless it is repeated there. Both requests
 * are safe to repeat: a second create_game only leaves an unused game behind,
 * and the server hands a repeated join_game from the same client its seat.
 */
export function useResendOnReconnect(
  { send, sessionId, status }: Pick<GameSocket, 'send' | 'sessionId' | 'status'>,
  answered: boolean,
) {
  const [pending, setPending] = React.useState<Pending | null>(null);

  const request = React.useCallback(
    (msg: WebSocketMessage) => {
      const sent = send(msg);
      setPending({ msg, sentOn: sent ? sessionId : null, queuedAt: sessionId });
    },
    [send, sessionId],
  );

  React.useEffect(() => {
    if (!pending || answered || status !== 'connected') return;
    if (pending.sentOn === null) {
      // The socket's open handler flushed the queue: it went out on this one
      if (sessionId !== pending.queuedAt) setPending({ ...pending, sentOn: sessionId });
      return;
    }
    if (pending.sentOn !== sessionId) {
      send(pending.msg);
      setPending({ ...pending, sentOn: sessionId });
    }
  }, [pending, answered, status, sessionId, send]);

  React.useEffect(() => {
    if (answered) setPending(null);
  }, [answered]);

  return request;
}
