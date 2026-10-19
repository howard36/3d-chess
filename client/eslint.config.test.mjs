// The lint rules that stand for CLAUDE.md's (eslint.config.js): each block
// that sets a rule's list replaces an earlier block's whole list, so a new
// block or a new rule is where one would quietly stop applying. Each case is
// a line the rules must refuse, or let pass, in a file of that part.
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: import.meta.dirname });
/** The messages of the rules that stand for CLAUDE.md's, for `code` as the file `path`. */
const refused = async (code, path) => {
  const [result] = await eslint.lintText(code, { filePath: path });
  return result.messages
    .filter((m) => /^no-restricted-/.test(m.ruleId ?? ''))
    .map((m) => m.message);
};

// (the parser and the plugins load on the first lint: seconds)
beforeAll(() => refused('', 'src/x.ts'), 60_000);

const R3F_STATE = 'window.__r3fState = null;\n';
const FOCUS = 'document.body.focus();\n';
const TIMER = 'setTimeout(() => {}, 0);\n';
const WALL = 'export const t = new Date();\n';
const SET_PIECE = 'declare const b: { setPiece: () => void };\nb.setPiece();\n';
const CANVAS = "import { Canvas } from '@react-three/fiber';\nexport const C = () => <Canvas />;\n";

it.each([
  // [what, code, files where it is refused, files where it passes]
  [
    '__r3fState is the game canvas’s alone',
    R3F_STATE,
    [
      'src/screens/Lobby.tsx',
      'src/screens/lobby/LobbyCanvas.tsx',
      'src/three/scene/x.tsx',
      'src/three/x.tsx',
      'src/lib/focus.ts',
      'src/screens/x.test.tsx',
    ],
    ['src/screens/GameCanvas.tsx'],
  ],
  [
    'focus the page moves goes through lib/focus.ts',
    FOCUS,
    ['src/screens/x.tsx', 'src/three/x.tsx', 'src/three/scene/x.tsx', 'src/screens/GameCanvas.tsx'],
    ['src/lib/focus.ts', 'src/screens/x.test.tsx'],
  ],
  [
    'the scene and the canvases animate on r3f’s clock, not a timer',
    TIMER,
    ['src/three/x.tsx', 'src/three/scene/x.tsx', 'src/screens/LearnCanvas.tsx'],
    ['src/screens/x.tsx', 'src/three/x.test.tsx'],
  ],
  [
    '… nor the wall clock',
    WALL,
    ['src/three/x.tsx', 'src/three/scene/x.tsx', 'src/screens/GameCanvas.tsx'],
    ['src/screens/x.tsx'],
  ],
  [
    'only the engine and the lessons set a piece',
    SET_PIECE,
    ['src/screens/x.tsx', 'src/three/x.tsx', 'src/three/scene/x.tsx'],
    ['src/engine/x.ts', 'src/game/lessons.ts', 'src/screens/x.test.tsx'],
  ],
  [
    'an app canvas renders on demand',
    CANVAS,
    ['src/screens/GameCanvas.tsx', 'src/screens/lobby/LobbyCanvas.tsx', 'src/three/x.tsx'],
    [],
  ],
])('%s', async (_, code, refusedIn, passedIn) => {
  for (const path of refusedIn)
    expect([path, (await refused(code, path)).length]).not.toEqual([path, 0]);
  for (const path of passedIn) expect([path, await refused(code, path)]).toEqual([path, []]);
});
