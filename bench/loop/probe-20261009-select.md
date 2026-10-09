# Probe: what the "click → first frame with the piece held" row times (V1)

`client/scripts/bench-browser.mjs --only select`, the branch's app, 2026-10-09 17:45–17:55Z, SwiftShader.

- With the frame taken after the page's own click event (not after a time read before `mouse.click`, whose pointer move can draw a hover frame first): 5 runs, 4 completed with **0 of 32** picks where a hover frame began before the click's, so the row was timing the right frame in those. **1 run of 5 failed loudly: a click after which no frame was drawn at all** (the click selected nothing): the old code would have timed whatever frame began after the press (the hover's) as "piece held".
- Every run's first pick is 3.2–4.7 s (the others 19–768 ms): its frame's render() blocks 1.6–2.5 s, then ~0.4 s, in `getProgramParameter`, with no program linked in the window. The section starts picking when the page is quiet, but the game's warm-up (WarmPrograms) has not finished: `data-warm` was unset at that moment and became `done` 7.8–8.9 s later. Waiting for it first (2 runs): first pick 107 and 388 ms, no GPU wait. So a pick in the first seconds after the entrance waits on the warm-up's links (next run's lead: ledger F5/W1).

| run | picks, ms (first … last) |
| :-- | :-- |
| 1 | 4312 74 119 368 464 120 113 26 |
| 2 | failed: no frame after the click |
| 3 | 3170 316 294 535 181 87 419 230 |
| 4 | 4132 90 38 668 298 300 768 267 |
| 5 | 4678 530 19 286 294 34 228 312 |
| after warm-up 1 | 107 376 315 359 281 329 331 258 |
| after warm-up 2 | 388 380 406 400 449 395 261 260 |
