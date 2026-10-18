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
(`joint_start.txt`; the path, every eighth step, in `joint_traj.jsonl`). It is self-play: each
pair is two copies of the current numbers, nudged in opposite random directions, playing each other
from one opening with colours swapped, and the numbers move towards the copy that scored better.
Its start scored 54.4% ± 1.4% at 40k; after 2,544 pairs 63.6% ± 1.3%, and 67.2% ± 1.8% at 160k.

**Piece values within the evaluation.** One multiplier per piece on all of its terms (tables,
constant included, mobility, pressure, the bishop pair, its value for ordering; `spsa_k.py`,
`fit_k.py`), set three ways. The average worth of each piece (base and positional credit, in
average pawns; `engine worth`) shows where each lands:

| Five values                                                             |    N |    B |    R |    U |    Q | Strength at 40k |
| ----------------------------------------------------------------------- | ---: | ---: | ---: | ---: | ---: | --------------- |
| Hand-set evaluation                                                     | 3.02 | 2.80 | 2.24 | 1.33 | 8.71 | 50%             |
| Material that predicts the winner (`research/piece-values/`), scaled in | 3.13 | 3.07 | 2.85 | 1.20 | 11.2 | 44.0% ± 1.4%    |
| The same, constants moved instead                                       | 3.13 | 3.07 | 2.84 | 1.20 | 11.2 | 42.6% ± 1.4%    |
| Tuned for strength (SPSA, 3,000 pairs at 20k)                           | 3.26 | 2.73 | 2.35 | 1.39 | 8.48 | 54.8% ± 1.4%    |
| Fitted to results (12,000 games, one position each)                     | 3.23 | 2.82 | 2.29 | 1.08 | 9.64 | 47.2% ± 1.4%    |
| The final evaluation (all numbers, below)                               | 3.28 | 2.83 | 2.32 | 1.45 | 8.77 | 68.7% ± 0.9%    |

On held-out positions from those 12,000 games, the multipliers fitted to results predict the
winner better than the hand-set evaluation (squared error −0.76 ± 0.31 thousandths), the
strength-tuned ones no better (+0.25 ± 0.30), nor the final evaluation's numbers. Strength
and prediction agree on the knight, bishop and rook, and part on the unicorn and queen. The
whole 58 fitted to results on the same independent positions (`fit_search.py --K`) predict
better too (−0.84 ± 0.49) but drop mobility, and score 46.7% ± 1.4% at 40k (fitted to every position of 2,587
games instead, 29%).

**The whole evaluation fitted to results.** The same 57 numbers as the strength run (passed pawns
held at 0), fitted to the results of those 9,600 positions (`fit_search.py --ext --K 0.671`,
`fitR_ext.txt`). With the new terms, fitting to results gains some strength where the 53 alone
lost it: 58.6% ± 1.4% against the hand-set evaluation at 40k, where the strength run's start (the
hand-set numbers and the screened terms) scored 54.4% ± 1.4%. Against the strength-tuned
evaluation it scored 40.1% ± 1.8% (600 games), as their scores against the hand-set predict. On
the 2,400 held-out positions (each evaluation's scale fitted on the rest) it predicts better than
the hand-set (−1.14 ± 0.63 thousandths); the strength-tuned one does not (−0.18 ± 0.35).

**From a whole evaluation to five values.** Of those 57 numbers, 34 belong to one piece each (its
tables, mobility, pressure on the king, and the bishop pair), 16 to pawns and 3 to the king; the
danger blend, the shield and the threat are shared. Three ways to read five values off a whole
evaluation:

- Own numbers (`attrib.py`): what each piece's own numbers are worth where it stands (the
  evaluation's drop when it is taken off with every other number set to 0), in what the pawn's own
  numbers are worth, the three phases weighted equally. It uses the attribution and leaves out the
  shared terms; for the hand-set evaluation it is the average worth above, within 0.02.
- Removal (`engine removal`): the evaluation's drop when one piece alone is taken off, from its
  owner's view, over 22,000 positions from self-play, in pawns (the same drop for a pawn), the
  three phases weighted equally. `attrib.py` splits it by the numbers it comes from (exactly: the
  evaluation is linear in each group of numbers once the lead term is held). Each piece's value is
  91–95% its own numbers (84–97% its two constants) and 7–9% the lead term, itself in proportion
  to the pieces' values. No other piece's numbers move a value by more than 0.01 pawns, and the
  shared terms at most 0.10 (the shield, for the queen). The numbers do not mix the pieces up.
- Projection (`engine evdump`, `distill.py`): the material-only model (pawn 1, a logistic scale)
  fitted on the 12,000 positions to the evaluation's own verdict (its score, scaled to fit the
  results) instead of the result, the phases weighted equally. The same model fitted to the
  results is the reference: what material alone says on these positions.

| Whole evaluation                  | Own numbers: N, B, R, U, Q   | Removal: N, B, R, U, Q       | Projection: N, B, R, U, Q     |
| --------------------------------- | ---------------------------- | ---------------------------- | ----------------------------- |
| Hand-set                          | 3.02, 2.82, 2.24, 1.33, 8.70 | 3.14, 2.93, 2.34, 1.36, 9.01 | 2.92, 2.76, 2.24, 1.30, 8.54  |
| Tuned for strength                | 3.28, 2.86, 2.32, 1.44, 8.84 | 3.30, 2.89, 2.35, 1.41, 8.78 | 3.12, 2.76, 2.31, 1.36, 8.47  |
| Fitted to results                 | 3.19, 2.86, 2.42, 1.07, 9.31 | 3.22, 2.91, 2.46, 1.08, 9.35 | 3.05, 2.80, 2.31, 1.09, 9.07  |
| Fitted to results, no new terms   | 3.21, 2.80, 2.35, 1.02, 9.27 | 3.29, 2.91, 2.44, 1.06, 9.46 | 3.10, 2.79, 2.28, 1.06, 9.11  |
| Material alone, fitted to results | —                            | —                            | 3.19, 2.90, 2.36, 1.11, 10.65 |

The projections are good to ±0.02 (the queen ±0.08); material alone to ±0.10, 0.09, 0.08, 0.05
and 0.71. The three conversions agree. Strength and results agree on the knight, bishop and rook
(within 0.1 pawn) and differ on the unicorn (strength about 1.4, results 1.1) and the queen
(strength lower by 0.4 to 0.6). The evaluation fitted to results reads as material alone does on
the same positions, but for the queen (9.1 against 10.7 ± 0.7). These positions come from natural
games at 20k nodes, where an imbalance arises in play; `research/piece-values/` imposed its
imbalances at random in stronger play, and its rook (2.84) and bishop (3.07) stand higher. Compare
values within one set of positions.

The projection does not depend on the positions chosen. `engine augment` keeps each position that
is quiet by the evaluation's own capture search (the evaluation cannot see a hanging piece; the
capture search can) and adds up to two copies with one random piece besides the kings taken off,
each still legal and quiet (21,400 copies of 11,200 positions; `distill_aug.py`). With the copies
the values move by at most 0.05, the queen by 0.15: tuned for strength 3.15, 2.78, 2.32, 1.37,
8.55; fitted to results 3.09, 2.82, 2.34, 1.10, 9.12. The copies alone read the same. Labelled by
80k-node searches instead of the evaluation (75,000 positions, the hand-set evaluation), the
hand-set reads 2.93, 2.80, 2.26, 1.30, 8.59, as its static evaluation does.

## The result

The final numbers (`joint_final.txt`, as `evaluate.ts` holds them) against the hand-set
evaluation:

| Budget                                | Games | Score        | Elo  |
| ------------------------------------- | ----: | ------------ | ---- |
| 40k nodes                             | 2,000 | 68.7% ± 0.9% | +136 |
| 80k nodes                             | 1,000 | 70.4% ± 1.3% | +151 |
| 160k nodes                            |   500 | 71.2% ± 1.8% | +157 |
| 36.2k against 40k (equal time, below) | 2,000 | 65.9% ± 0.9% | +114 |
| 34.6k against 40k                     | 1,000 | 62.7% ± 1.4% | +90  |
| 40k nodes, the new terms switched off | 1,000 | 64.1% ± 1.3% | +101 |

The gain holds as the search deepens. The board keeps the new terms as moves are played
(`position.ts`), and the JS search runs at 0.93× the positions a second it did before
(interleaved runs of `search` on the same positions); the equal-time rows charge it more.
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
# the whole evaluation fitted to results (positions with results, one per game: lines "board side label")
python3 fit_search.py train.lab test.lab handset.txt fitR_ext.txt --ext --K 0.671 --lam 1e-6 --iters 60
# five values from a whole evaluation: removal and its split by numbers, and projection
./engine removal @joint_final.txt < positions.txt
python3 attrib.py joint_final.txt positions.txt
./engine evdump @joint_final.txt < all.lab > ev_final.txt && python3 distill.py --results ev_final.txt
./engine augment @joint_final.txt 7 2 < all.lab > aug_final.txt && python3 distill_aug.py aug_final.txt
# evaluate.ts from a numbers file, and the port against the JS engine (from client/, after npm ci)
python3 gen_eval_ts.py numbers.txt ../../client/src/ai/evaluate.ts joint_final.txt
npx vite-node ../research/evaluation/ref.ts moves 3000 0 in.txt js.txt
PV_EVAL=@joint_final.txt ../research/evaluation/engine moves < in.txt | cmp - js.txt
npx vite-node ../research/evaluation/ref.ts search 150 30000 in.txt js.txt
PV_EVAL=@joint_final.txt ../research/evaluation/engine search 30000 64 < in.txt | cmp - js.txt
```

A match of 1,000 games takes about 20 minutes at 40k nodes on 4 cores, and twice that for each
doubling of nodes.
