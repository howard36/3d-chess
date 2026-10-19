import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
    coverage: {
      // The rules engine, the computer player and the log-derived game state
      // are gated; hooks and lib are reported for visibility only (no
      // threshold), so a dip there shows up in the table but does not fail
      // the run.
      include: [
        'src/engine/**/*.ts',
        'src/ai/**/*.ts',
        'src/game/**/*.ts',
        'src/hooks/**/*.ts',
        'src/lib/**/*.ts',
      ],
      exclude: ['**/*.test.ts'],
      thresholds: {
        // Each file on its own: a glob's total would carry an untested new
        // module under a well-tested whole
        perFile: true,
        'src/engine/**/*.ts': {
          statements: 90,
          branches: 90,
          functions: 90,
          lines: 90,
        },
        'src/ai/**/*.ts': {
          statements: 90,
          branches: 90,
          functions: 90,
          lines: 90,
        },
        'src/game/**/*.ts': {
          statements: 90,
          branches: 90,
          functions: 90,
          lines: 90,
        },
      },
    },
  },
});
