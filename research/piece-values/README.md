# Measuring the piece values

How the values behind the captured pieces' "+N" (`client/src/game/material.ts`) were
measured, and the tools to measure them again after a rule change. None of this ships: the
bots here exist only to play test games. The results are summarised in ARCHITECTURE.md
"Piece values".

## The bots

`engine.c`, `search.c` and `main.c` are a C port of `client/src/ai` (`position.ts`,
`evaluate.ts`, `search.ts`), about 4× as fast. With its improvements off it searches exactly
as the game does: `ref.ts` writes the JS engine's move lists, evaluations and fixed-node
searches for random positions, and the port must reproduce them byte for byte (same move,
score, depth and node count). Its default values (`DEFAULT_VALUES` in `main.c`) must match
`VALUE` in `evaluate.ts` for that check.

The test bots add, at equal nodes: the transposition table kept between moves (with the best
move of an interrupted iteration), 66% against the faithful port at 5,000 nodes a move; and
stronger pruning (`F_LMP`, `F_LMR`, `F_FUT`, `F_QSEE`, `F_RFP` in `search.c`; feature mask 31
is all of them), another +68 Elo at 5,000 nodes and +97 at 20,000, about a ply deeper.

Every budget is a number of positions searched (nodes), never time, so games are
reproducible and parallel runs cannot change each other's results.

## The method

Material is taken away at random, never by the bots' choice, so an imbalance carries no
compensation the side giving it up saw; then both sides, the same bot, play it out.

- From the start (`run_removal.py`, `run_targeted.py`): a random set of pieces removed from
  each side (common kinds cancelled, near-even imbalances favoured), eight plies chosen at
  random among the near-best for variety, each imbalance played twice with the colours
  swapped.
- From played positions (`gen_bases.py`, `pick_bases.py`, `run_e3.py`): quiet, level
  positions of self-play games, in three phases by the pieces left besides kings and pawns
  (1–5, 6–11, 12+), sampled by game; pawnless endings left out (no lone piece mates, so every
  imbalance there draws). Each imbalance is played twice from the same position with the
  removals swapped between the sides, so the position's own lean cancels.

`analysis.py` fits the result (a draw half a point) by logistic regression on the difference
in each kind of piece, a pawn fixed at 1: `logit P(first mover scores) = a + k·Σ v·d`, with
`a` and `k` per phase (`an_free.py`), or with the pieces' ratios fixed and one scale fitted
(`an_budget.py`). `an_trend.py` is the final fit: ratios shared by every budget, one scale per
budget. Bootstrap over games gives the ± (one standard deviation).

## Results (October 2026)

| Budget (nodes a move) | Games | A bishop, in pawns |
| --------------------- | ----- | ------------------ |
| 5,000                 | 6,000 | 3.39 ± 0.19        |
| 20,000                | 7,625 | 3.09 ± 0.10        |
| 80,000 (≈ Hard)       | 2,736 | 2.76 ± 0.13        |

Ratios to the bishop, the same at every budget and phase: knight 1.003 ± 0.013, rook
0.892 ± 0.012, unicorn 0.422 ± 0.013, queen 3.60 ± 0.05. At 80,000: queen 9.9, knight and
bishop 2.8, rook 2.5, unicorn 1.2 (fitted free at that budget alone: 9.8, 2.8, 2.8, 2.5,
1.1). Playing the same 3,000 games with the bots on the old values changed nothing (a bishop
3.36 against 3.35). Under 20,000 nodes the search itself moves the result (the faithful port
at 5,000 gave 2.7), so the shallow runs only show the trend.

The computer (`evaluate.ts`) keeps its own values: the faithful port with the measured ones
scored 45.9% ± 1.5% over 800 games at 40,000 nodes against its current ones (`val.py`).

## Reproducing

```sh
gcc -O2 -march=native -o engine main.c engine.c search.c -lm
# the port against the JS engine (from client/, after npm ci)
npx vite-node ../research/piece-values/ref.ts moves 3000 0 in.txt js.txt
../research/piece-values/engine moves < in.txt | cmp - js.txt
npx vite-node ../research/piece-values/ref.ts search 150 30000 in.txt js.txt
../research/piece-values/engine search 30000 64 < in.txt | cmp - js.txt
# the runs (4 workers; the bots' values in centipawns)
V='{"P":100,"N":280,"B":275,"R":245,"U":130,"Q":1000}'
python3 run_removal.py --n 3000 --nodes 5000 --tag e1b --seed 5 --values "$V"
python3 run_removal.py --n 3000 --nodes 5000 --tag e1c --seed 5   # the old values
python3 run_removal.py --n 6000 --nodes 20000 --tag e2 --seed 2 --values "$V"
python3 run_targeted.py --pairs "Q:RBNP,Q:RRBP,Q:NBUPP,Q:RBUPP,Q:RRNU,Q:NNBU" --reps 80 --nodes 20000 --tag eq --values "$V"
python3 gen_bases.py --n 800 --nodes 20000 --tag pool --dump 4 --offset 5000 --values "$V"
python3 pick_bases.py pool.raw pool_all.json   # keep the bases with pieces as pool.json
python3 run_e3.py --n 5000 --nodes 20000 --tag e3b --seed 33 --bases pool.json --strata 0.35,0.35,0.30 --values "$V"
python3 run_removal.py --n 1600 --nodes 80000 --tag e4a --seed 4 --values "$V"
python3 run_e3.py --n 1000 --nodes 80000 --tag e5 --seed 33 --bases pool.json --strata 0.35,0.35,0.30 --values "$V"
python3 run_e3.py --n 2000 --skip 1000 --nodes 80000 --tag e5b --seed 33 --bases pool.json --strata 0.35,0.35,0.30 --values "$V"
python3 an_trend.py                    # the final fit
python3 an_free.py e4a,e5,e5b          # the deepest budget alone
python3 disagree.py "e4a,e5,e5b" "[1,3,3,2.5,1.5,10]" "[1,2.8,2.8,2.5,1.2,9.9]"
python3 val.py 40000 800 "100,280,280,250,120,990" "100,320,295,245,140,980" val
```

The runs above were stopped early where time ran out (e2 at 2,149 games, e3b at 3,529,
e4a at 1,276, e5b at 460), and `e3`, an earlier run of the phase design with bases sampled
per position (pawnless ones dropped in the fit), adds 987 games at 20,000. A run of 1,000
games takes about 10 minutes at 20,000 nodes a move on 4 cores, and about 4× that at 80,000.
