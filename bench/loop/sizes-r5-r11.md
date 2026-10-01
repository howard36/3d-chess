# Chunk sizes for R5 and R11 (vite build, bytes; gzip -9)

| Build | scene chunk (rendererSetup-*.js) min | gz | entry (index-*.js) min | gz |
| :-- | --: | --: | --: | --: |
| 00db00a | 975,388 | 318,632 | 271,931 | 88,612 |
| + R5 (sculptor out) | 959,858 | 312,948 | 271,931 | 88,614 |
| + R11 (one scheduler) | 951,725 | 309,998 | 271,939 | 88,619 |

Other chunks (LobbyCanvas, GameCanvas, pixelBudget, CSS) within ±4 B. Built 2026-10-01 ~05:30Z with Node 24.21.0.
