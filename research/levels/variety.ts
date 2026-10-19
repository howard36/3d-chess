// How varied a player is: in the same position, how often it plays the same move from one game
// to the next. Over positions from games (the engine's one-ply search against itself, freely, every 8th ply
// from the 10th to the 90th), the player moves `tries` times in each, each time as in another game
// (its own seed and game seed); prints how often it played its most frequent move there, and how
// many different moves it played, on average.
//
// usage: node variety.mjs <player> [tries]   (players as match.ts names them)
import { chooseMove } from '../../client/src/ai/choose';
import type { WireMove } from '../../client/src/ai/position';
import { parsePlayer } from './players';

const [spec, tries = '10'] = process.argv.slice(2);
const { name: player, level } = parsePlayer(spec);

const positions: WireMove[][] = [];
for (let g = 0; g < 12; g++) {
  const records: WireMove[] = [];
  for (let ply = 0; ply < 92; ply++) {
    const m = chooseMove(records, 'hardFixed', 3000 + 97 * g + ply, {
      level: { maxDepth: 1, timeMs: 1e9, nodes: undefined, temperature: 30, margin: 60 },
    });
    if (!m) break;
    records.push(m.move);
    if (ply >= 10 && ply % 8 === 2) positions.push(records.slice());
  }
}
let modal = 0;
let different = 0;
let played = 0;
for (const records of positions) {
  const counts = new Map<string, number>();
  for (let t = 0; t < Number(tries); t++) {
    const m = chooseMove(records, player, 1 + 7919 * t, { level, game: 1 + 104729 * t });
    if (!m) break;
    const key = `${m.move.from}${m.move.to}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) continue;
  modal += Math.max(...counts.values()) / Number(tries);
  different += counts.size;
  played++;
}
console.log(
  `${spec}: over ${played} positions, ${tries} games each: the same move ` +
    `${((100 * modal) / played).toFixed(0)}% of the time, ` +
    `${(different / played).toFixed(1)} different moves a position`,
);
