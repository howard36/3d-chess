// Reference outputs from the JS engine for the C port's verification, by the
// levels' numbers, or the expert's with EXPERT=1 (check them against the C
// port with handset.txt and round3_final.txt).
import {
  EXPERT_WEIGHTS,
  LEVEL_WEIGHTS,
  Position,
  moveFrom,
  moveTo,
  movePromotion,
} from '../../client/src/ai/position';
import { Searcher } from '../../client/src/ai/search';
import { evaluate } from '../../client/src/ai/evaluate';
import { writeFileSync } from 'node:fs';

const mode = process.argv[2];
const count = Number(process.argv[3] ?? 200);
const nodes = Number(process.argv[4] ?? 20000);
const weights = process.env.EXPERT === '1' ? EXPERT_WEIGHTS : LEVEL_WEIGHTS;
let seed = 12345;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x80000000;
};
const lines: string[] = [];
const out: string[] = [];
const buf = new Int32Array(1024);
for (let g = 0; g < count; g++) {
  const pos = Position.start(weights);
  const len = Math.floor(rand() * (mode === 'search' ? 60 : 160));
  const rec: number[] = [];
  let ok = true;
  for (let i = 0; i < len; i++) {
    const n = pos.legalMoves(buf);
    if (n === 0) {
      ok = false;
      break;
    }
    // prefer captures sometimes, to reach sparse endgames
    let m = buf[Math.floor(rand() * n)];
    pos.make(m);
    rec.push(moveFrom(m), moveTo(m), movePromotion(m));
  }
  const line = `${rec.length / 3} ${rec.join(' ')}`;
  lines.push(line);
  if (mode === 'moves') {
    const list = new Int32Array(1024);
    const e = pos.generate(list, 0);
    out.push(Array.from(list.slice(0, e)).join(' '));
    const en = pos.generate(list, 0, true);
    out.push(
      `${en}|${evaluate(pos)} ${evaluate(pos, false)} ${pos.inCheck() ? 1 : 0} ${pos.repeated() ? 1 : 0}`,
    );
  } else {
    const r = new Searcher(pos).search({
      maxDepth: 64,
      timeMs: 1e12,
      maxNodes: nodes,
      margin: 0,
      quiescence: 64,
      now: () => 0,
    });
    out.push(`${r.move} ${r.score} ${r.depth} ${r.nodes}`);
  }
}
writeFileSync(process.argv[5], lines.join('\n') + '\n');
writeFileSync(process.argv[6], out.join('\n') + '\n');
