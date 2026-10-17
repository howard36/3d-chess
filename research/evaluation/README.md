# Tuning the evaluation for strength

How the numbers in `client/src/ai/evaluate.ts` were chosen, and the tools to tune them again.
None of this ships. The question: which evaluation makes the computer play best for the same
search, counted in positions searched (nodes), not time?

## The engine

`engine.c`, `search.c` and `main.c` are a C port of `client/src/ai` (`position.ts`,
`evaluate.ts`, `search.ts`), about 4× as fast, that searches node for node as the game does:
`ref.ts` writes the JS engine's move lists, evaluations and fixed-node searches for random
positions, and the port must reproduce them byte for byte. An evaluation is a file of numbers
(`@file`, `evalnums.py`): the 58 of the tables and weights (layout in `engine.c`,
`eval_features`), the six values the search orders captures and counts the lead by, and
optionally six extension terms and eleven fractional weights (`engine.h`, `EvalParams`).
`PV_EVAL=@file` makes the `moves` and `search` modes use it, for checking a port;
`gen_eval_ts.py` writes `evaluate.ts` from a numbers file, rounded as the game holds them.

Every match is the game's own search (a fresh table each move, no added pruning) at a fixed
number of nodes a move, each opening (eight plies chosen at random among the near-best) played
twice with colours swapped; scores are the candidate's, ± one standard error.

## What was tried

The hand-set evaluation had 58 numbers: piece-square tables per piece (a base, a slope per step
from the cube's centre, a penalty for staying home; middlegame and endgame, blended by the
game's phase), pawns by progress, the king's tables, mobility and pressure on the enemy king per
piece type, and the bishop pair.

**New terms, screened** (`screen.py`, 600 games each at 20k nodes, ± 1.8%): pieces attacked by a
pawn (25 cp each) 54.4%; pawns beside their own king (6 cp, at the king's danger) 53.2%; the
king's tables blended by the enemy's queen (half) rather than by the game's phase 52.7%, by the
enemy's pieces (half) 51.3%; passed pawns (2 and 6 cp per step of progress) 48.5%, left out.

**Fitting to deeper searches** (`fit_search.py`): 75,000 quiet positions from self-play and one
random move from them (so the data holds the positions after poor moves a search must judge),
labelled by 80k-node searches; the evaluation fitted to the labels lowered the held-out error
by 2% but scored 51.7% ± 1.8% at 20k: not enough.

**SPSA for strength** (`spsa64.py`): all 53 numbers that can matter and four new terms at once,
5,696 game pairs at 20k nodes, from the hand-set numbers with the screened terms
(`joint_start.txt`; the path, every eighth step, in `joint_traj.jsonl`). Its start scored
54.4% ± 1.4% at 40k; after 2,544 pairs 63.6% ± 1.3%, and 67.2% ± 1.8% at 160k.

**Piece values within the evaluation.** One multiplier per piece on all of its terms (tables,
constant included, mobility, pressure, the bishop pair, its value for ordering; `spsa_k.py`,
`fit_k.py`), set three ways. The average worth of each piece (base and positional credit, in
average pawns; `engine worth`) shows where each lands:

| Five values                                                    |    N |    B |    R |    U |    Q | Strength at 40k |
| -------------------------------------------------------------- | ---: | ---: | ---: | ---: | ---: | --------------- |
| Hand-set evaluation                                            | 3.02 | 2.80 | 2.24 | 1.33 | 8.71 | 50%             |
| Material that predicts the winner (`research/piece-values/`), scaled in | 3.13 | 3.07 | 2.85 | 1.20 | 11.2 | 44.0% ± 1.4%    |
| The same, constants moved instead                              | 3.13 | 3.07 | 2.84 | 1.20 | 11.2 | 42.6% ± 1.4%    |
| Tuned for strength (SPSA, 3,000 pairs at 20k)                  | 3.26 | 2.73 | 2.35 | 1.39 | 8.48 | 54.8% ± 1.4%    |
| Fitted to results (12,000 games, one position each)            | 3.23 | 2.82 | 2.29 | 1.08 | 9.64 | 47.2% ± 1.4%    |
| The final evaluation (all numbers, below)                      | 3.28 | 2.83 | 2.32 | 1.45 | 8.77 | 68.7% ± 0.9%    |

On held-out positions from those 12,000 games, the multipliers fitted to results predict the
winner better than the hand-set evaluation (squared error −0.76 ± 0.31 thousandths), the
strength-tuned ones no better (+0.25 ± 0.30), nor the final evaluation's numbers. Strength
and prediction agree on the knight, bishop and rook, and part on the unicorn and queen. The
whole 58 fitted to results on the same independent positions (`fit_search.py --K`) predict
better too (−0.84 ± 0.49) but drop mobility, and score 46.7% ± 1.4% at 40k (fitted to every position of 2,587
games instead, 29%).

## The result

The final numbers (`joint_final.txt`, as `evaluate.ts` holds them) against the hand-set
evaluation:

| Budget                                     | Games | Score        | Elo  |
| ------------------------------------------ | ----: | ------------ | ---- |
| 40k nodes                                  | 2,000 | 68.7% ± 0.9% | +136 |
| 80k nodes                                  | 1,000 | 70.4% ± 1.3% | +151 |
| 160k nodes                                 |   500 | 71.2% ± 1.8% | +157 |
| 36.2k against 40k (equal time, below)      | 2,000 | 65.9% ± 0.9% | +114 |
| 34.6k against 40k                          | 1,000 | 62.7% ± 1.4% | +90  |
| 40k nodes, the new terms switched off      | 1,000 | 64.1% ± 1.3% | +101 |

The gain holds as the search deepens. The JS search runs at 0.91× the old positions a second
(interleaved runs of `search` on the same positions), which the equal-time rows charge it.
Most of the gain is the retuned numbers; the new terms add some 35 Elo on top.
Every match's line is in `results.txt`.

## Reproducing

```sh
gcc -O2 -march=native -o engine main.c engine.c search.c -lm
# a candidate against the game's evaluation, 1,000 games at 40k nodes; score.py rescores a .raw
python3 screen.py --nodes 40000 --n 1000 --new @joint_final.txt --old 100,320,295,245,140,980 --tag f40
# SPSA for strength: all numbers and the extension terms; one multiplier per piece
python3 spsa64.py --start joint_start.txt --pairs 6000 --tag joint
python3 spsa_k.py --pairs 3000 --tag spsak
# independent positions with results (one per game), and the multipliers fitted to them
python3 gen_onepos.py --n 6000 --seed 1000000 --tag dataA
python3 fit_k.py dataA.pos dataB.pos --score joint_final.txt
# evaluate.ts from a numbers file, and the port against the JS engine (from client/, after npm ci)
python3 gen_eval_ts.py numbers.txt ../../client/src/ai/evaluate.ts joint_final.txt
npx vite-node ../research/evaluation/ref.ts moves 3000 0 in.txt js.txt
PV_EVAL=@joint_final.txt ../research/evaluation/engine moves < in.txt | cmp - js.txt
npx vite-node ../research/evaluation/ref.ts search 150 30000 in.txt js.txt
PV_EVAL=@joint_final.txt ../research/evaluation/engine search 30000 64 < in.txt | cmp - js.txt
```

A match of 1,000 games takes about 20 minutes at 40k nodes on 4 cores, and twice that for each
doubling of nodes.
