// How a player errs, as a game's review marks it: games of the player against itself (as the
// game plays it, a new game seed each), every position reviewed as the review does
// (analysePosition), each move graded (game/analysis.ts). Prints the marks per 100 moves, and
// the blunders per 100 moves in quiet positions (tension at most 0.6: few captures to make, few
// pieces attacked) and in tense ones (at least 1).
//
// usage: node marks.mjs <player> [games] [seed]   (players as match.ts names them)
import { analysePosition, chooseMove, tension } from '../../client/src/ai/choose';
import { Position } from '../../client/src/ai/position';
import type { WireMove } from '../../client/src/ai/position';
import { gradeMoves } from '../../client/src/game/analysis';
import { parsePlayer } from './players';

const [spec, n = '8', seed = '1'] = process.argv.slice(2);
const { name, level } = parsePlayer(spec);
const marks: Record<string, number> = {};
const quiet = { moves: 0, blunders: 0 };
const tense = { moves: 0, blunders: 0 };
let moves = 0;
for (let g = 0; g < Number(n); g++) {
  const game = Number(seed) * 1000 + g;
  const records: WireMove[] = [];
  for (let ply = 0; ply < 200; ply++) {
    const m = chooseMove(records, name, game * 1000 + ply, { level, game });
    if (!m) break;
    records.push(m.move);
    // A game decided: no need to play out the mate
    if (Math.abs(m.score) > 2000 && ply > 20) break;
  }
  const analyses = records.map((_, i) => analysePosition(records.slice(0, i)));
  analyses.push(analysePosition(records));
  const grades = gradeMoves(records, analyses);
  grades.forEach((grade, i) => {
    moves++;
    if (grade) marks[grade] = (marks[grade] ?? 0) + 1;
    const t = tension(Position.fromRecords(records.slice(0, i)));
    const bucket = t <= 0.6 ? quiet : t >= 1 ? tense : null;
    if (bucket) {
      bucket.moves++;
      if (grade === 'blunder') bucket.blunders++;
    }
  });
}
const per100 = (k: number, of = moves) => ((100 * k) / Math.max(1, of)).toFixed(1);
console.log(
  `${spec}: ${moves} moves in ${n} games; per 100 moves ` +
    ['brilliant', 'inaccuracy', 'mistake', 'blunder']
      .map((g) => `${g} ${per100(marks[g] ?? 0)}`)
      .join(', ') +
    `; blunders per 100 quiet moves ${per100(quiet.blunders, quiet.moves)} (of ${quiet.moves}), ` +
    `per 100 tense ${per100(tense.blunders, tense.moves)} (of ${tense.moves})`,
);
