# Why "create: click → share link shown" is slow and noisy (run 20261001-0352)

Traced with the browser bench's new `createTrace` (setup section, raw): from the creator's
White click to the share link, the route and lobby beat changes, every long task, every
shader program linked (with its fragment shader's main) and every GPU wait.

Two `--only setup` runs per build gave 4 setups each, interleaved (base, head, head, base).
Three more runs gave 6 setups each for 150303c against 7f1e93c, interleaved.

| Build | Share link (ms) | Median | Programs linked after the pick | Median GPU wait |
| :-- | :-- | --: | --: | --: |
| 92ce041 | 1609 1420 1216 2554 1330 1243 | 1375 | 4 | ~670 |
| 150303c (#55) | 1296 2260 1516 1166 1705 1466 · 1011 1155 1837 1523 2595 2630 | 1520 | 4 | 783 |
| 7f1e93c (#56) | 2249 935 1357 824 2833 2925 | 1803 | 5 | 929 |
| branch (00db00a…) | 2655 1861 | — | 5 | 1090–1759 |

- The page draws only 3–4 frames between the click and the link: the side choice navigates
  to the game once the king's glide settles (`ChooseSide.tsx`: `created && settled`), and
  the glide's frames are held up by shader links.
- After the pick the lobby first draws, and so links: the held king's selection light
  (column, floor, motes; `scene/selection.tsx`), the landing band (`LobbyScene.tsx`,
  `uCentre`) and, since #56, the garden's copy (`backdropCache.tsx`). Each link waits on
  the GPU in `getProgramParameter` for 0.1–1.1 s in software rendering.
- The five slowest setups of 150303c vs 7f1e93c are exactly the five with the most GPU
  waiting. The run-to-run spread (0.8–2.9 s on one build) is the links' timing.
- No commit is a clear regression: the 2-pair A/Bs that called #55 +79% and the branch
  +108% vs 92ce041 were reading this spread. #56 adds one link (+150 ms median wait).

Fix to try: warm those programs in the lobby while the side choice waits for a click (as
WarmPrograms does for the game), so the pick's frames link nothing.
