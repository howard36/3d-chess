// Conversions between engine Move objects and the wire-format messages
// defined by the WebSocket schema (server/schema.json).

import { fromZXY, toZXY } from './coords';
import { PIECE_TO_PROMOTION, PROMOTION_TO_PIECE } from './pieces';
import type { Move } from './board';
import type { Move as MoveMessage, MoveMade, Promotion } from '../types/messages';

/** Convert a received move_made message into an engine Move. */
export function moveFromMessage(msg: MoveMade): Move {
  return {
    from: fromZXY(msg.from),
    to: fromZXY(msg.to),
    promotion: msg.promotion ? PROMOTION_TO_PIECE[msg.promotion] : undefined,
  };
}

/** Convert a local engine Move into a move message to send to the server. */
export function moveToMessage(move: Move): MoveMessage {
  let promotion: Promotion | undefined;
  if (move.promotion) {
    promotion = PIECE_TO_PROMOTION[move.promotion];
    if (!promotion) {
      throw new Error(`Piece type ${move.promotion} is not a valid promotion`);
    }
  }
  return {
    type: 'move',
    from: toZXY(move.from),
    to: toZXY(move.to),
    promotion,
  };
}
