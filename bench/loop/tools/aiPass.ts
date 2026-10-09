// Probe (not committed): Hard's search time per move, base vs head, same positions.
import { chooseMove as headChoose } from '/home/user/3d-chess-improve/client/src/ai/choose';
import { chooseMove as baseChoose } from '/home/user/3d-chess-base/client/src/ai/choose';

const plies = Number(process.argv[2] ?? 40);
const records: Parameters<typeof headChoose>[0][number][] = [];
// A game to probe: medium against itself, quickly
for (let i = 0; i < plies; i++) {
  const m = headChoose(records, 'medium', 1000 + i, { level: { timeMs: 60 } });
  if (!m) break;
  records.push(m.move);
}
const rows: { ply: number; side: string; ms: number; depth: number; move: string; obvious: boolean }[] = [];
for (let ply = 0; ply < records.length; ply++) {
  const pos = records.slice(0, ply);
  const order = ply % 2 ? ['head', 'base'] : ['base', 'head'];
  for (const side of order) {
    const choose = side === 'head' ? headChoose : baseChoose;
    const t = performance.now();
    const m = choose(pos, 'hard', 7 + ply)!;
    const ms = performance.now() - t;
    rows.push({ ply, side, ms, depth: m.depth, move: JSON.stringify(m.move), obvious: m.obvious });
  }
}
console.log(JSON.stringify(rows));
