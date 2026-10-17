// HS1 probe: Hard at its own clock (1,800 ms), base vs head vs base again,
// interleaved, on positions of the bench's decisive game. Prints one JSON row a search.
// Run: point the base import at a worktree of the base commit, bundle with
// `cd client && npx rolldown <this file> --file hard.mjs --format esm --platform node`,
// then `node hard.mjs > hard.json` (about 1.5 min; nothing else running).
import { chooseMove as headChoose } from '/home/user/wt/20261017-1252/client/src/ai/choose';
import { chooseMove as baseChoose } from '/path/to/base-worktree/client/src/ai/choose';
import { sharedGames } from '/home/user/wt/20261017-1252/client/bench/fixtures';

const { decisive } = sharedGames();
const plies: number[] = [];
for (let p = 8; p < decisive.records.length; p += 4) plies.push(p);
const rows = [];
for (const [i, ply] of plies.entries()) {
  const recs = decisive.records.slice(0, ply);
  const order = i % 2 ? ['head', 'base', 'base2'] : ['base2', 'base', 'head'];
  for (const side of order) {
    const choose = side === 'head' ? headChoose : baseChoose;
    const m = choose(recs, 'hard', 7 + ply)!;
    rows.push({ ply, side, depth: m.depth, nodes: m.nodes, move: `${m.move.from}-${m.move.to}` });
  }
  process.stderr.write('.');
}
console.log(JSON.stringify(rows));
