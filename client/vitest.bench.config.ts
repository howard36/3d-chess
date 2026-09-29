import { defineConfig } from 'vitest/config';

// `npx vitest bench --config vitest.bench.config.ts` (or bench/run.mjs at the
// repo root, which also writes the report). The benchmarks time pure code, so
// they run in plain Node: no jsdom, no test setup file.
export default defineConfig({
  test: {
    environment: 'node',
    benchmark: {
      include: ['bench/**/*.bench.ts'],
    },
  },
});
