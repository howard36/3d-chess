// One worker's share of a match between two of the computer's players, as
// the game plays them (chooseMove), one JSON line a game on stdout.
//
// A player is a level or player name (client/src/ai/levels.ts), optionally
// with a budget of positions or a fixed depth: `expert@40000` is the expert
// on 40,000, `hard:d3` Hard's search to 3 plies whatever the time. `hard`
// thinks by the clock, so it plays as strong as the machine is fast.
//
// usage: node match.mjs <A> <B> <games> <worker> <workers> <seed>
//   games i = worker, worker + workers, ...; A has White in even games.
import { chooseMove } from '../../client/src/ai/choose';
import { FIFTY_MOVE_PLIES, REPETITIONS } from '../../client/src/engine/draws';
import { Position } from '../../client/src/ai/position';
import type { WireMove } from '../../client/src/ai/position';
import { MATE_BOUND } from '../../client/src/ai/search';
import { parsePlayer } from './players';

const [a, b, games, worker, workers, seed] = process.argv.slice(2);

const players = [parsePlayer(a), parsePlayer(b)];

/** Resigned: both sides have scored the game this lopsided for this many moves running. */
const RESIGN = 1000;
const RESIGN_MOVES = 3;
const MAX_PLIES = 400;

const buf = new Int32Array(1024);
for (let g = Number(worker); g < Number(games); g += Number(workers)) {
  const gameSeed = Number(seed) + g;
  // Even games: A has White
  const white = g % 2 === 0 ? 0 : 1;
  const records: WireMove[] = [];
  const pos = Position.start();
  const seen = new Map<string, number>();
  const stats = [
    { ms: 0, nodes: 0, moves: 0 },
    { ms: 0, nodes: 0, moves: 0 },
  ];
  // For each side (0 White), its last scores, its own view
  const scores: number[][] = [[], []];
  let result = '';
  let reason = '';
  for (let ply = 0; ; ply++) {
    const side = ply % 2;
    const who = side === 0 ? white : 1 - white;
    const p = players[who];
    if (pos.legalMoves(buf) === 0) {
      result = pos.inCheck() ? (side === 0 ? '0-1' : '1-0') : '1/2';
      reason = pos.inCheck() ? 'mate' : 'stalemate';
      break;
    }
    if (pos.halfmoves >= FIFTY_MOVE_PLIES) {
      result = '1/2';
      reason = 'fifty';
      break;
    }
    if (ply >= MAX_PLIES) {
      result = '1/2';
      reason = 'length';
      break;
    }
    const t = performance.now();
    const m = chooseMove(records, p.name, gameSeed * 1000 + ply, {
      level: p.level,
      game: gameSeed,
    })!;
    stats[who].ms += performance.now() - t;
    stats[who].nodes += m.nodes;
    stats[who].moves++;
    records.push(m.move);
    pos.make(pos.findMove(m.move));
    const key = `${pos.hashLo},${pos.hashHi}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n >= REPETITIONS) {
      result = '1/2';
      reason = 'repetition';
      break;
    }
    // Resignation: the mover and the other side agree, a few moves running
    scores[side].push(m.score);
    const mine = scores[side].slice(-RESIGN_MOVES);
    const theirs = scores[1 - side].slice(-RESIGN_MOVES);
    const lost = (s: number[]) => s.length === RESIGN_MOVES && s.every((x) => x <= -RESIGN);
    const won = (s: number[]) => s.length === RESIGN_MOVES && s.every((x) => x >= RESIGN);
    if ((lost(mine) && won(theirs)) || m.score <= -MATE_BOUND) {
      result = side === 0 ? '0-1' : '1-0';
      reason = 'resigned';
      break;
    }
  }
  const aScore = result === '1/2' ? 0.5 : (result === '1-0') === (white === 0) ? 1 : 0;
  console.log(
    JSON.stringify({
      g,
      a,
      b,
      white: white === 0 ? a : b,
      result,
      reason,
      plies: records.length,
      aScore,
      stats,
    }),
  );
}
