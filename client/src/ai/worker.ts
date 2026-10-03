// The computer's thinking, off the page's thread: one request at a time, a
// move (or null, with no legal move) back for each (see computer.ts).

import { chooseMove } from './choose';
import type { ThinkReply, ThinkRequest } from './computer';

self.onmessage = (event: MessageEvent<ThinkRequest>) => {
  const { id, records, difficulty, seed } = event.data;
  let reply: ThinkReply;
  try {
    reply = { id, move: chooseMove(records, difficulty, seed) };
  } catch (e) {
    reply = { id, error: String(e) };
  }
  self.postMessage(reply);
};
