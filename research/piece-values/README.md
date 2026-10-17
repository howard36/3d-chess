# Measuring the piece values

How the values behind the captured pieces' "+N" (`client/src/game/material.ts`) were measured,
and the tools to measure them again after a rule change. None of this ships: the bots here exist
only to play test games. ARCHITECTURE.md "Piece values" has the results in brief.

The question: which single value per piece makes White's total minus Black's best predict who
wins from a position, in every phase of the game, with both sides played well (better than the
game's Hard level)?

## The bots

`engine.c`, `search.c` and `main.c` are a C port of `client/src/ai` (`position.ts`,
`evaluate.ts`, `search.ts`), about 4× as fast. With its additions off it searches exactly as the
game does: `ref.ts` writes the JS engine's move lists, evaluations and fixed-node searches for
random positions, and the port must reproduce them byte for byte (same move, score, depth and
node count). `DEFAULT_VALUES` in `main.c` must match `VALUE` in `evaluate.ts` for that check.

The test bots keep the hash table between moves and add stronger pruning (`F_LMP`, `F_LMR`,
`F_FUT`, `F_QSEE`, `F_RFP` in `search.c`; feature mask 31 is all of them): about +200 Elo against
the faithful port at the same work. Every budget is a number of positions searched a move
(nodes), never time, so games are reproducible and runs sharing the machine cannot change each
other's results. Their strength (`ladder.py`): each 4× in nodes is worth about +375 Elo (20k beats
5k 89.9%, 80k beats 20k 89.6%); the game's Hard (the faithful port at 700k nodes, its nominal
budget) beats the 80k bot 76.5% (+205 Elo); 320k beats 80k 85.3% (+306 Elo), so it plays about 100 Elo above Hard.

## The method

**Imbalances imposed at random.** Material is taken away at random, never by a bot's choice, so
no imbalance comes with compensation the side giving it up saw; then both sides, the same bot,
play it out. A start must be quiet after the removal (`quiet.py`: no check, and a capture-only
search moves the evaluation by at most a pawn), so a game never begins with a free capture.

- From the start (`run_removal.py`): pieces removed from the starting position, then eight plies
  chosen at random among the near-best for variety.
- From played positions (`gen_bases.py`, `pick_bases.py`, `run_e3.py`): quiet, level positions of
  self-play games in three phases by the pieces left besides kings and pawns (12+, 6–11, and 1–5
  with pawns on both sides: in a pawnless ending no lone piece mates, so every imbalance draws).

Each imbalance is played twice from the same position with it swapped between the sides, so the
position's own lean cancels. Two designs:

- Random mixes (`run_removal.py`, `run_e3.py`): any pieces against any, so every piece's worth,
  and the ratios between pieces, come from them.
- Near-even trades of pieces for pawns (`run_scale.py`: bishop or knight against 3 pawns, unicorn
  against 1, rook against 2 or 3, two pieces against 4, and some games a pawn up): a game near 50%
  says most about where the balance lies, so these pin down a piece's worth in pawns.

**The fit** (`final_values.py`). In each phase, each piece's worth (the pawn's included) is its
effect on the log-odds of winning: `logit P(first mover scores) = a + k · Σ v·d`, with `d` the
difference in each kind of piece and a draw half a point. One set `v` is fitted for every phase at
once, each phase with its own `a` and `k` (how strongly material shows in the results there) and
an equal share of the weight; only then is the pawn set to 1. Bootstrap over games gives the ±
(one standard deviation). `an_candidates.py` scores whole value sets phase by phase: the
log-loss of the predictions, and how often the side the set puts ahead wins.

**Paired replays** (`rerun.py`): the same games replayed at another budget, so a change with
strength is measured on identical positions.

## Results (October 2026)

Pawn = 1, quiet starts only, each phase weighted equally (`final_values.py`,
`an_pool_levels.py`; ± one standard deviation):

| Games at                      | Games | Knight      | Bishop      | Rook        | Unicorn     | Queen      |
| ----------------------------- | ----- | ----------- | ----------- | ----------- | ----------- | ---------- |
| 20k                           | 8,130 | 3.30 ± 0.10 | 3.16 ± 0.09 | 2.83 ± 0.07 | 1.24 ± 0.05 | 11.4 ± 0.3 |
| 80k                           | 5,232 | 3.07 ± 0.09 | 3.04 ± 0.08 | 2.78 ± 0.07 | 1.18 ± 0.06 | 11.1 ± 0.6 |
| 320k                          | 1,526 | 3.13 ± 0.17 | 2.93 ± 0.17 | 2.89 ± 0.11 | 1.30 ± 0.12 | –          |
| **80k and 320k (the values)** | 6,758 | 3.13 ± 0.08 | 3.07 ± 0.08 | 2.84 ± 0.07 | 1.20 ± 0.05 | 11.2 ± 0.8 |

The shipped values are the last row rounded: queen 11.2, knight and bishop 3.1, rook 2.8,
unicorn 1.2 (the 320k games have no queen imbalance; its value comes from 80k).

- **Strength.** On identical games (`an_paired3.py`) a bishop is 3.14, 3.20 and 3.08 pawns at
  20k, 80k and 320k in the near-even trades, and 3.11, 3.00 and 3.40 (± 0.2–0.25) in the random
  removals from played positions: no trend between 20k and 320k. Only at 5k (3.4) does weak play
  move it.
- **Phases.** Fitted phase by phase, the values agree within a few tenths, but for the rook in
  endings with pawns (about 3.0) and the late-middlegame minor pieces (about 2.8). Scored phase
  by phase on the 80k and 320k games (`an_candidates.py`), the final set predicts best in every
  phase; the old values (queen 10, knight and bishop 3, rook 2.5, unicorn 1.5) lose 2.4 to 7.2
  millinats a game, and where the two sets read a game differently the side the final set puts
  ahead scored 54.4% ± 1.9% (679 games; 55.1% ± 1.7% in 865 at 20k).
- **Pawnless endings** were left out: no lone piece mates, so an extra rook there scored 0.50,
  against 0.91 with pawns on the board.

## The computer's own values

`evaluate.ts` scores material at its own constants (queen 9.8, knight 3.2, bishop 2.95, rook 2.45,
unicorn 1.4) plus positional terms; an average pawn earns 8 centipawns more in the middlegame and
29 in the endgame, a piece 10–35 for mobility (`decomp` in `main.c`). Tested at equal work
(`val.py`, 1,000 games at 40k, the game's own search):

- Constants chosen so each piece's average total worth matches the measured values
  (`fair_map.py`): 43.6% (80k values) and 45.8% (20k values) against the current constants.
- The whole evaluation (58 numbers) fitted to results of 2,587 self-play games (`texel.py`,
  `texel_select.py`): it predicts held-out results better, but plays at 29.0%, and the positional
  terms alone at 11.9%: in played games a king that walks out, or pieces crowding the enemy king,
  go with already winning, and the fit takes that for cause.
- The five constants tuned for strength by SPSA (`spsa.py`, 3,000 game pairs at 20k): 341, 291,
  256, 146, 981, which scored 51.3% ± 1.4% against the current ones: no clear gain.

So the computer keeps its constants: what predicts the result best is not what searches best
with these positional terms.

## Reproducing

```sh
gcc -O2 -march=native -o engine main.c engine.c search.c -lm
# the port against the JS engine (from client/, after npm ci)
npx vite-node ../research/piece-values/ref.ts moves 3000 0 in.txt js.txt
../research/piece-values/engine moves < in.txt | cmp - js.txt
npx vite-node ../research/piece-values/ref.ts search 150 30000 in.txt js.txt
../research/piece-values/engine search 30000 64 < in.txt | cmp - js.txt
```

The runs (4 workers; the bots' values in centipawns, which hardly matter: the same 3,000 games
with the old values gave a bishop of 3.36 pawns against 3.35):

```sh
V='{"P":100,"N":280,"B":275,"R":245,"U":130,"Q":1000}'
python3 gen_bases.py --n 800 --nodes 20000 --tag pool --dump 4 --offset 5000 --values "$V"
python3 pick_bases.py pool.raw pool_all.json   # keep the bases with pieces as pool.json
# 20k
python3 run_removal.py --n 6000 --nodes 20000 --tag e2 --seed 2 --values "$V"
python3 run_targeted.py --pairs "Q:RBNP,Q:RRBP,Q:NBUPP,Q:RBUPP,Q:RRNU,Q:NNBU" --reps 80 --nodes 20000 --tag eq --values "$V"
python3 run_e3.py --n 5000 --nodes 20000 --tag e3b --seed 33 --bases pool.json --strata 0.35,0.35,0.30 --values "$V"
# 80k
python3 run_removal.py --n 1600 --nodes 80000 --tag e4a --seed 4 --values "$V"
python3 run_e3.py --n 1000 --nodes 80000 --tag e5 --seed 33 --bases pool.json --strata 0.35,0.35,0.30 --values "$V"
python3 run_e3.py --n 2000 --skip 1000 --nodes 80000 --tag e5b --seed 33 --bases pool.json --strata 0.35,0.35,0.30 --values "$V"
python3 run_e3.py --n 1500 --nodes 80000 --tag e6 --seed 44 --bases pool.json --strata 0.34,0.33,0.33 --values "$V"
python3 run_scale.py --n 1600 --nodes 80000 --tag s80 --seed 101
python3 rerun.py --src s80 --nodes 20000 --tag s20
# 320k, replays of 80k games
python3 rerun.py --src s80 --nodes 320000 --limit 800 --tag s320b
python3 rerun.py --src e5 --nodes 320000 --tag e5x320
# strength
python3 ladder.py --a 20000,31,1 --b 5000,31,1 --n 400 --tag lad5_20 --seed 90000
python3 ladder.py --a 80000,31,1 --b 20000,31,1 --n 400 --tag lad20_80 --seed 91000
python3 ladder.py --a 320000,31,1 --b 80000,31,1 --n 300 --tag lad80_320 --seed 92000
python3 ladder.py --a 80000,31,1 --b 700000,0,0 --n 200 --tag hard80
# the fit
python3 final_values.py
python3 an_candidates.py e4a,e5,e5b,s80,e6,s320b,e5x320 '{"old":[3,3,2.5,1.5,10],"new":[3.1,3.1,2.8,1.2,11.2]}'
python3 an_paired3.py s20,s80,s320b   # the same games at three strengths
```

Runs written for `run_e3.py` before the quiet check (e3b, e5, e5b, s80) are filtered when read:
`an_phase2.py` drops starts whose `<tag>.qgap.json` gap is over a pawn (`main.c`'s `quiet` mode
writes it). Some runs were stopped early when time ran out; the fit uses what finished. A run of
1,000 games takes about 10 minutes at 20k nodes a move on 4 cores, and 4× that for each 4× in
nodes.
