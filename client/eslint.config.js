import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

// A board changes only through the engine (a move applied makes a new one):
// screens and the scene never set a piece (CLAUDE.md: the board updates when
// the server echoes the move)
const NO_SET_PIECE = {
  property: 'setPiece',
  message:
    'Never mutate a board: apply a move (engine/board.ts); only the engine and the lessons build positions.',
};

// Only the game canvas names __r3fState (e2e projects clicks through it):
// published, read or defined, by name or by string. Kept in each block that
// sets no-restricted-syntax, as a later block's list replaces an earlier one's
const R3F_ONLY =
  'Only the game canvas (GameCanvas.tsx) publishes __r3fState: e2e projects clicks through it.';
const NO_R3F_STATE = [
  "Identifier[name='__r3fState']",
  'Literal[value=/__r3fState/]',
  'TemplateElement[value.raw=/__r3fState/]',
].map((selector) => ({ selector, message: R3F_ONLY }));

// CLAUDE.md "Gotchas": focus the page moves by itself goes through lib/focus.ts,
// so its ring shows only for a player on the keyboard (kept, like
// NO_R3F_STATE, in each block that sets no-restricted-syntax)
const FOCUS_FROM_CODE =
  'Focus the page moves goes through lib/focus.ts (autoFocusRef, focusFromCode).';
const NO_BARE_FOCUS = [
  { selector: "JSXAttribute[name.name='autoFocus']", message: FOCUS_FROM_CODE },
  { selector: "CallExpression[callee.property.name='focus']", message: FOCUS_FROM_CODE },
];

// The app's canvases draw on demand: the garden's copy, the frame pacer and
// the "no frame for a render that changes nothing" counts all depend on it
// (CLAUDE.md "The board", "Performance")
const ON_DEMAND = {
  selector:
    "JSXOpeningElement[name.name='Canvas']:not(:has(JSXAttribute[name.name='frameloop'][value.value='demand']))",
  message: 'An app canvas renders on demand: frameloop="demand".',
};

// The wall clock, read through any object too (globalThis.Date.now(),
// window.performance.now(), new globalThis.Date()): no-restricted-properties
// sees only a bare Date or performance
const WALL_CLOCK = [
  "NewExpression[callee.name='Date']",
  "NewExpression[callee.property.name='Date']",
  "MemberExpression[property.name='now'][object.property.name=/^(Date|performance)$/]",
].map((selector) => ({ selector, message: 'Animate on r3f’s clock, not the wall clock.' }));

/** A timer or a frame of the browser's own, on any object (window, globalThis, self). */
const TIMERS = ['setTimeout', 'setInterval', 'requestAnimationFrame', 'requestIdleCallback'];

export default defineConfig(
  // src/types/schema.ts is generated (npm run generate:types); don't lint it
  { ignores: ['dist', 'coverage', 'test-results', 'playwright-report', 'src/types/schema.ts'] },
  {
    extends: [js.configs.recommended, tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // These rules hold components to what the React Compiler needs to
      // memoise them, and the app is not compiled: its components read a
      // latest-value ref while rendering, mutate the three.js objects r3f
      // hands them (a uniform, a material) instead of making new ones each
      // frame, reset local state in an effect when an input changes, and pass
      // useMemo a named factory. Those are deliberate here (the scene's frames
      // and identities depend on them, CLAUDE.md "Performance"); taking these
      // rules on means adopting the compiler, a change of its own.
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/use-memo': 'off',
      'react-hooks/purity': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // CLAUDE.md's rules that a reader could otherwise only remember
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/schema', '**/schema.ts'],
              message: 'Wire types come from types/messages.ts, never the generated schema.ts.',
            },
          ],
        },
      ],
      'no-restricted-syntax': ['error', ...NO_R3F_STATE, ...NO_BARE_FOCUS],
      'no-restricted-properties': ['error', NO_SET_PIECE],
    },
  },
  {
    // The engine, and the tutorial's positions (game/lessons.ts), build boards
    files: ['src/engine/**', 'src/game/lessons.ts', '**/*.test.{ts,tsx}'],
    rules: { 'no-restricted-properties': 'off' },
  },
  { files: ['src/types/messages.ts'], rules: { 'no-restricted-imports': 'off' } },
  {
    files: ['src/lib/focus.ts', '**/*.test.{ts,tsx}'],
    rules: { 'no-restricted-syntax': ['error', ...NO_R3F_STATE] },
  },
  {
    // Animations run on r3f's clock, which the showcase's virtual clock drives;
    // a timer, a frame of the browser's own or the wall clock escapes it
    files: [
      'src/three/**/*.{ts,tsx}',
      'src/screens/**/*Canvas.tsx',
      'src/screens/LandingPreview.tsx',
    ],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...TIMERS.map((name) => ({
          name,
          message:
            'Animate on r3f’s clock (useFrame), not a timer or a frame of the browser’s own.',
        })),
      ],
      'no-restricted-properties': [
        'error',
        ...TIMERS.map((property) => ({
          property,
          message:
            'Animate on r3f’s clock (useFrame), not a timer or a frame of the browser’s own.',
        })),
        { object: 'Date', property: 'now', message: 'Animate on r3f’s clock, not the wall clock.' },
        {
          object: 'performance',
          property: 'now',
          message: 'Animate on r3f’s clock, not the wall clock.',
        },
        NO_SET_PIECE,
      ],
      'no-restricted-syntax': [
        'error',
        ...NO_R3F_STATE,
        ...NO_BARE_FOCUS,
        ...WALL_CLOCK,
        ON_DEMAND,
      ],
    },
  },
  {
    // The scene only draws: Board.tsx owns every interaction rule, and the
    // scene's marks render outside the clickable group (CLAUDE.md "The board")
    files: ['src/three/scene/**/*.tsx'],
    ignores: ['**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...NO_R3F_STATE,
        ...NO_BARE_FOCUS,
        ...WALL_CLOCK,
        {
          selector: 'JSXAttribute[name.name=/^on(Click|DoubleClick|ContextMenu|Wheel|Pointer)/]',
          message:
            'The scene only draws: Board.tsx owns every interaction (CLAUDE.md "The board").',
        },
      ],
    },
  },
  {
    // The scene's modules keep each part's components beside the constants and
    // helpers that go with it; an edit to the scene redraws the canvas anyway,
    // so component-only modules would buy nothing here.
    files: ['src/three/scene/**/*.{ts,tsx}', 'src/three/pieceMotion.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  // The one place that publishes __r3fState (after the blocks that restrict it)
  {
    files: ['src/screens/GameCanvas.tsx'],
    rules: {
      'no-restricted-syntax': ['error', ...NO_BARE_FOCUS, ...WALL_CLOCK, ON_DEMAND],
    },
  },
);
