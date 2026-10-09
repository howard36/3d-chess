// Writes bench/longGame.json, the browser bench's long game (bench/longGame.ts).
//   npx vite-node scripts/long-game.ts
import { writeFileSync } from 'node:fs';
import { generateLongGame, LONG_GAME_PLIES } from '../bench/longGame';

const moves = generateLongGame(LONG_GAME_PLIES);
writeFileSync(new URL('../bench/longGame.json', import.meta.url), JSON.stringify(moves) + '\n');
console.log(`wrote ${moves.length} plies`);
