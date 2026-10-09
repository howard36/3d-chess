import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

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
    // The scene's modules keep each part's components beside the constants and
    // helpers that go with it; an edit to the scene redraws the canvas anyway,
    // so component-only modules would buy nothing here.
    files: ['src/three/scene/**/*.{ts,tsx}', 'src/three/pieceMotion.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
);
