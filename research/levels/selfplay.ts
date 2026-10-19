// Games of a level against itself as the game plays them: chooseMove for each
// side, each side a style and blind spots of its own (its own game seed), the
// game decided by the game's own rules (deriveHistory: mate, stalemate, the
// kings alone, the same position a third time, fifty moves), at most 1,000
// plies, no resignation or agreed draw. One JSON line a game.
//
// usage: node selfplay.mjs <level> <first game> <games> > games.jsonl
//   game g: its seeds from g alone, so a game can be played again exactly
import { chooseMove } from '../../client/src/ai/choose';
import type { Player } from '../../client/src/ai/levels';
import { deriveHistory } from '../../client/src/game/history';
import type { GameHistory } from '../../client/src/game/history';
import type { WireMove } from '../../client/src/ai/position';
import type { WebSocketMessage } from '../../client/src/types/messages';

const [level, first, count] = process.argv.slice(2);
const MAX_PLIES = 1000;

for (let g = Number(first); g < Number(first) + Number(count); g++) {
  const records: WireMove[] = [];
  const log: WebSocketMessage[] = [];
  let history: GameHistory | null = null;
  const moves: string[] = [];
  const scores: number[] = [];
  const depths: number[] = [];
  let nodes = 0;
  const start = performance.now();
  for (let ply = 0; ply < MAX_PLIES; ply++) {
    const side = ply % 2;
    const m = chooseMove(records, level as Player, (g * 1000003 + ply * 7919 + 12345) | 0, {
      game: g * 2 + side,
    });
    if (!m) break;
    records.push(m.move);
    log.push({ type: 'move_made', by: side ? 'black' : 'white', ...m.move } as WebSocketMessage);
    history = deriveHistory(log, history);
    moves.push(`${m.move.from}-${m.move.to}${m.move.promotion ? `=${m.move.promotion}` : ''}`);
    scores.push(m.score);
    depths.push(m.depth);
    nodes += m.nodes;
    if (history.gameOver) break;
  }
  const over = history?.gameOver;
  const winner = over?.winner ?? null;
  console.log(
    JSON.stringify({
      level,
      game: g,
      result: over ? over.result : 'length',
      winner,
      score: winner === 'white' ? '1-0' : winner === 'black' ? '0-1' : '1/2',
      plies: moves.length,
      secs: Math.round(performance.now() - start) / 1000,
      nodes,
      moves,
      scores,
      depths,
    }),
  );
}
