// What a bench file tells the report besides its timings: the workloads it
// ran (pieces, moves, log sizes) and any table it measured by hand. Written
// as JSON into BENCH_META_DIR when the orchestrator (bench/run.mjs) sets it;
// a plain `vitest bench` run skips it.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Table {
  title: string;
  intro: string;
  columns: string[];
  rows: string[][];
  align?: ('l' | 'r' | 'c')[];
  notes?: string[];
  /** Each row's primary number, for comparing runs (bench/run.mjs --compare); null: none. */
  metrics?: (Metric | null)[];
}

export interface Metric {
  /** The row's identity across runs (defaults to its first cell); never a measured value. */
  key?: string;
  value: number;
  unit: 'ms' | 'per_s' | 'bytes' | 'fps';
  better: 'lower' | 'higher';
}

export interface Sidecar {
  /** Each bench group's introduction (what real-world path it models), keyed by its name. */
  intros?: Record<string, string>;
  /** Workload descriptions, keyed by the bench group they belong to. */
  workloads?: Record<string, Table>;
  /** Tables measured by hand (work tinybench cannot time on its own). */
  tables?: Table[];
  /** Free-form facts for the findings (counts, checksums). */
  facts?: Record<string, string | number | boolean>;
}

/** Writes this file's sidecar (`key` names it) when the orchestrator asked for one. */
export function emit(key: string, sidecar: Sidecar): void {
  const dir = process.env.BENCH_META_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${key}.json`), JSON.stringify(sidecar, null, 2));
}

/** 3 significant figures, with a unit picked by size: 412 ns, 38.2 µs, 1.23 ms, 2.41 s. */
export function duration(ms: number): string {
  const sig = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
  if (ms < 1e-3) return `${sig(ms * 1e6)} ns`;
  if (ms < 1) return `${sig(ms * 1e3)} µs`;
  if (ms < 1000) return `${sig(ms)} ms`;
  return `${sig(ms / 1000)} s`;
}

/** Order statistics of a sample (ms). */
export function summarize(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  return {
    n: sorted.length,
    min: sorted[0],
    median: at(0.5),
    p95: at(0.95),
    max: sorted[sorted.length - 1],
    mean,
  };
}
