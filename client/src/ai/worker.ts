// The computer's thinking, off the page's thread: one request at a time, a
// move (or null, with no legal move) back for each, or for a request to
// assess, what it makes of the position (see computer.ts).

import { assessPosition, chooseMove } from './choose';
import type { ThinkReply, ThinkRequest } from './computer';

self.onmessage = (event: MessageEvent<ThinkRequest>) => {
  const { id, records, difficulty, seed, assess } = event.data;
  let reply: ThinkReply;
  try {
    reply = assess
      ? { id, score: assessPosition(records) }
      : { id, move: chooseMove(records, difficulty, seed) };
  } catch (e) {
    reply = { id, error: String(e) };
  }
  self.postMessage(reply);
};
