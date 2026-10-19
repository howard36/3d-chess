// How long each player takes over a move in the browser: bundled into a
// worker by speed.mjs. The positions are Medium's games against itself
// (seeded), every 8th ply from the 8th to the 120th; each player moves in
// every one of them.
//
// A player is a name with an optional budget, as in match.ts (`expert@40000`:
// the expert on a budget of 40,000 positions, which it stops short of as the
// clock would), or `name=N`: a search of exactly N positions (maxNodes).
import { chooseMove } from '../../client/src/ai/choose';
import type { Player } from '../../client/src/ai/levels';
import type { WireMove } from '../../client/src/ai/position';

export interface Row {
  player: string;
  ply: number;
  ms: number;
  nodes: number;
  depth: number;
}

function positions(): WireMove[][] {
  const out: WireMove[][] = [];
  for (let g = 0; g < 8; g++) {
    const records: WireMove[] = [];
    for (let ply = 0; ply < 124; ply++) {
      const m = chooseMove(records, 'medium', 5000 + g * 997 + ply, { level: { timeMs: 1e9 } });
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
    const exact = player.includes('=');
    const [name, n] = player.split(/[@=]/);
    const options = exact
      ? { maxNodes: Number(n), level: { nodes: undefined, timeMs: 1e9 } }
      : n
        ? { level: { nodes: Number(n) } }
        : {};
    all.forEach((records, i) => {
      const t = performance.now();
      const m = chooseMove(records, name as Player, 100 + i, options)!;
      const ms = performance.now() - t;
      rows.push({ player, ply: records.length, ms, nodes: m.nodes, depth: m.depth });
    });
  }
  return rows;
}

onmessage = (e: MessageEvent<string[]>) => postMessage(time(e.data));
