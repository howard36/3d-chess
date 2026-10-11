# Probe: programs linked per tutorial step (U1)

`bench/loop/tools/learnlinks.mjs`, against `vite preview` builds of base 454bd45 (port 4174) and the branch with U1 (port 4173), alternated base, head, head, base, twice; Chromium 141 headless shell, SwiftShader, 1280×800. Each cell: programs linked after clicking "Next", and the long tasks (> 50 ms) in the 4 s after the click, summed (ms). 2026-10-09 ~17:15Z.

| Run | Rook | Bishop | Unicorn | Queen | King | Knight | Pawn | Black |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| base 1 | 1 · 498 | 4 · 303 | 4 · 333 | 4 · 303 | 4 · 483 | 4 · 365 | 4 · 334 | 4 · 349 |
| head 1 | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 |
| head 2 | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 |
| base 2 | 0 · 0 | 4 · 442 | 4 · 311 | 4 · 313 | 4 · 377 | 4 · 394 | 4 · 316 | 4 · 335 |
| base 3 | 0 · 0 | 4 · 263 | 4 · 284 | 4 · 468 | 4 · 342 | 4 · 383 | 4 · 321 | 4 · 358 |
| head 3 | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 |
| head 4 | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 |
| base 4 | 0 · 0 | 4 · 392 | 4 · 563 | 4 · 271 | 4 · 326 | 4 · 336 | 4 · 312 | 4 · 345 |

Base: the four programs are the glass (`vec2 uv = vCell`), the two rims (`vec3 c = vRimCam`) and the labels' sprite (`diffuseColor`); median 342 ms of long tasks per step (n = 28). Head: none, 0 ms (n = 32). The start page: 29 links over 90 s on both (same times within ±1.5 s): the demo's passes did not relink in that window, so that half of the reviewer's claim is not confirmed.

## Re-check on the merged tree (main with #115 and #116), 2026-10-09 ~19:15Z

Branch 7919c24 (port 4173) against main 91b6db5 (port 4174), alternated main, head, head, main; same probe.

| Run | Rook | Bishop | Unicorn | Queen | King | Knight | Pawn | Black |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| main 1 | 0 · 0 | 3 · 339 | 4 · 291 | 4 · 324 | 4 · 330 | 4 · 374 | 4 · 478 | 4 · 286 |
| head 1 | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 |
| head 2 | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 |
| main 2 | 1 · 1320 | 4 · 246 | 4 · 259 | 4 · 399 | 4 · 326 | 4 · 349 | 4 · 289 | 4 · 343 |

Holds. Same session, `tools/nowebgl.mjs` on the merged tree: the branch's start page shows its buttons, the tutorial its words, a computer game takes a typed move and answers (move count 2), and the body is gray-900 before any script; main's `/computer` with WebGL off shows no side choice (the error page).
