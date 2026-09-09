import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/e2e/**',
      '**/coverage/**',
      '**/test-results/**',
    ],
    coverage: {
      // The rules engine is gated; hooks and lib are reported for visibility
      // only (no threshold), so a dip there shows up in the table but does
      // not fail the run.
      include: ['src/engine/**/*.ts', 'src/hooks/**/*.ts', 'src/lib/**/*.ts'],
      thresholds: {
        'src/engine/**/*.ts': {
          statements: 90,
          branches: 90,
          functions: 90,
          lines: 90,
        },
      },
    },
  },
});
