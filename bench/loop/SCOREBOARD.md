# Scoreboard

Primary benchmarks (CLAUDE.md "Performance"), browser tier of `bench/run.mjs`, headless Chromium 141 + SwiftShader, 4 vCPU. Median over runs; spread = (max − min) / median.

## Run 20260930-0240

### Base 92ce041 — 5 browser runs (`--only browser --repeat 5`), 2026-09-30 02:48–03:10Z

| Row | base median | base spread | base n |
| --: | --: | --: | --: |
| desktop · create button enabled | 69 ms | 13% | 5 |
| phone, 4× CPU, Fast 4G · create button enabled | 657 ms | 2% | 5 |
| join: navigation → Join button | 236 ms | 19% | 5 |
| navigation → record shown (announcer = H) · H = 2000 | 227 ms | 16% | 5 |
| join: click → joiner’s first frame | 5.69 s | 87% | 5 |
| joiner’s first render() call | 838 ms | 137% | 5 |
| Enter → mover’s first frame with the move | 525 ms | 75% | 5 |
| Enter → opponent’s first frame with the move | 485 ms | 43% | 5 |
| click → first frame with the piece held | 251 ms | 46% | 5 |

Also on base (client tier, 5 rounds): S1 whole piece set build+bake cold 70.1 + 7.1 ms; E1 select middlegame queen 5.79 µs. Server tier: 5 repeats, unchanged by this run (no server code touched).
Note: "join: click → joiner's first frame" is bimodal (≈2.7 s, or 8.7–12.2 s when the first setup run meets cold program links).

### Commit 2 — backdrop cache: A/B vs base, 3 interleaved pairs (browser: setup, move-latency, select, render), 03:47–04:10Z

| Row | Base | Head | Change | Pairs (head/base) |
| :-- | --: | --: | --: | :-- |
| Enter → mover's first frame with the move | 400 ms | 279 ms | −29% | 0.95 0.67 0.56 |
| Enter → opponent's first frame with the move | 489 ms | 262 ms | −36% | 0.54 0.79 0.61 |
| click → first frame with the piece held | 206 ms | 175 ms | −16% | 0.72 1.09 0.75 |
| phone: orbit (fps, higher better) | 4.78 | 6.25 | +31% | 1.31 1.43 1.20 |
| mover: longest render() call (main thread) | 1.70 ms | 1.95 ms | +23% (worse) | 1.26 1.09 1.34 |
| join: click → joiner's first frame | 2.70 s | 6.07 s | bimodal (cold links), not called | 0.63 0.99 2.70 |

Full report: `ab1-backdrop-cache.md`. Frame raster (e2e profile, 1280×720): plain 195–200 ms, cached 128–135 ms; 0 of 3.7 M bytes differ.

### Commit 3 — no frame for a board render that changes nothing: A/B vs commit 2 (9917f49), 3 pairs (move-latency, select), 04:20–04:40Z

| Row | Commit 2 | Head | Change | Pairs (head/base) |
| :-- | --: | --: | --: | :-- |
| Enter → mover's first frame with the move | 319 ms | 256 ms | −17% | 0.67 0.76 1.12 |
| Enter → opponent's first frame with the move | 296 ms | 311 ms | −1.7% | 1.09 1.05 0.83 |
| click → first frame with the piece held | 185 ms | 158 ms | −18% | 0.86 0.72 0.88 |

Count: disabling the board asks for 0 frames (was 126; Board.test). Report: `ab2-board-frames.md`. Rule called nothing better or worse (noise).

### Commit 4 — glaze variants: A/B vs fb2d7e5, 3 pairs (move-latency, select, render), 04:33–04:55Z

| Row | Before | Head | Change | Pairs (head/base) |
| :-- | --: | --: | --: | :-- |
| Enter → mover's first frame with the move | 282 ms | 293 ms | −2.8% (mean of ratios) | 0.96 1.12 0.85 |
| Enter → opponent's first frame with the move | 287 ms | 255 ms | −9.1% | 1.10 0.79 0.86 |
| click → first frame with the piece held | 165 ms | 167 ms | +11% (one outlier pair) | 1.48 0.92 1.01 |
| phone: orbit, knight selected (fps) | 3.74 | 4.12 | +12% **better** | 1.20 1.07 1.10 |
| desktop: orbit, knight selected (fps) | 4.65 | 5.17 | +9.9% | 1.14 0.99 1.18 |

Page probe (e2e, both pages drawing): frame 343 → 294 ms; 1 byte of 4 M differs, by 1. Report: `ab3-glaze-variants.md`.

### Commit 6 — the lobby's garden from the copy too: A/B vs 40c0fa8, 4 pairs (setup), 04:58–05:12Z

| Row | Before | Head | Change | Pairs (head/base) |
| :-- | --: | --: | --: | :-- |
| join: click → joiner's first frame | 5.82 s | 2.50 s | −45% | 1.30 0.43 0.38 0.43 |
| join: click → game_start received | 571 ms | 58.9 ms | −77% | 1.67 0.10 0.08 0.20 |
| joiner: long tasks total, click → frame | 5.46 s | 1.96 s | −52% | 1.33 0.37 0.32 0.35 |
| joiner: shader programs linked, click → frame | 17 | 12 | −18% | 1.29 0.71 0.71 0.71 |
| join: click → creator's first frame | 2.19 s | 2.20 s | −6.2% | 0.66 0.90 1.03 1.26 |
| create: click → share link shown | 2.05 s | 1.95 s | −0.3% | 0.78 0.60 1.14 1.85 |

Not called by the rule (the cold path still showed in 1 of 4 head runs). Reading: both pages share one GPU process in the bench; the lobbies' idle frames now cost the tower only, so the joiner's context creation and links wait less. Report: `ab4-lobby-cache.md`.
