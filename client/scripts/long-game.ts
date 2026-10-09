// Writes the browser bench's games: bench/longGame.json (bench/longGame.ts)
// and bench/tacticalGame.json (bench/tacticalGame.ts).
//   npx vite-node scripts/long-game.ts
import { writeFileSync } from 'node:fs';
import { generateLongGame, LONG_GAME_PLIES } from '../bench/longGame';
import { tacticalGame } from '../bench/tacticalGame';

const write = (file: string, moves: unknown[]) => {
  writeFileSync(new URL(`../bench/${file}`, import.meta.url), JSON.stringify(moves) + '\n');
  console.log(`wrote ${file}: ${moves.length} plies`);
};
write('longGame.json', generateLongGame(LONG_GAME_PLIES));
write('tacticalGame.json', tacticalGame());
