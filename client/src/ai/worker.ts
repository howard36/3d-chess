// The computer's thinking, off the page's thread: one request at a time, a
// move (or null, with no legal move) back for each, or for a request to
// assess, what it makes of the position, or to analyse, the position's best
// move and its worth (see computer.ts).

import { analysePosition, assessPosition, chooseMove } from './choose';
import type { ThinkReply, ThinkRequest } from './computer';

self.onmessage = (event: MessageEvent<ThinkRequest>) => {
  const { id, records, difficulty, seed, assess, analyse } = event.data;
  let reply: ThinkReply;
  try {
    reply = analyse
      ? { id, analysis: analysePosition(records) }
      : assess
        ? { id, score: assessPosition(records) }
        : { id, move: chooseMove(records, difficulty, seed) };
  } catch (e) {
    // (with its stack, which the page logs: where the search failed)
    reply = { id, error: e instanceof Error && e.stack ? e.stack : String(e) };
  }
  self.postMessage(reply);
};
