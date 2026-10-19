// How long each player takes over a move in the browser: bundled into a
// worker by speed.mjs. The positions are the old Medium's games against
// itself (medium0, players.ts: seeded, and to its depth whatever the time, so
// the same everywhere), every 8th ply from the 8th to the 120th; each player
// moves in every one of them.
//
// A player is named as match.ts names one (`expert@40000`: the expert on a
// budget of 40,000 positions, which it stops short of as the clock would), or
// `name=N`: a search of exactly N positions (maxNodes).
import { chooseMove } from '../../client/src/ai/choose';
import type { WireMove } from '../../client/src/ai/position';
import { parsePlayer } from './players';

export interface Row {
  player: string;
  ply: number;
  ms: number;
  nodes: number;
  depth: number;
}

function positions(): WireMove[][] {
  const old = parsePlayer('medium0');
  const out: WireMove[][] = [];
  for (let g = 0; g < 8; g++) {
    const records: WireMove[] = [];
    for (let ply = 0; ply < 124; ply++) {
      const m = chooseMove(records, old.name, 5000 + g * 997 + ply, {
        level: { ...old.level, timeMs: 1e9 },
      });
      if (!m) break;
      records.push(m.move);
      if (ply >= 8 && ply % 8 === 0) out.push(records.slice());
    }
  }
  return out;
}

function time(players: string[]): Row[] {
  const all = positions();
  // Warm the JIT on both sets of numbers
  chooseMove(all[0], 'hard', 1, { maxNodes: 50_000 });
  chooseMove(all[0], 'expert', 1, { maxNodes: 50_000 });
  const rows: Row[] = [];
  for (const player of players) {
    // name=N: exactly N positions; otherwise a player as match.ts names one
    const [spec, n] = player.split('=');
    const { name, level } = parsePlayer(spec);
    const options =
      n !== undefined
        ? { maxNodes: Number(n), level: { ...level, nodes: undefined, timeMs: 1e9 } }
        : { level };
    all.forEach((records, i) => {
      const t = performance.now();
      const m = chooseMove(records, name, 100 + i, { ...options, game: i + 1 })!;
      const ms = performance.now() - t;
      rows.push({ player, ply: records.length, ms, nodes: m.nodes, depth: m.depth });
    });
  }
  return rows;
}

onmessage = (e: MessageEvent<string[]>) => postMessage(time(e.data));
