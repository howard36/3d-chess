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
`PV_EVAL=@file` makes the `moves` and `search` modes use it, for checking a port.

Every match is the game's own search (a fresh table each move, no added pruning) at a fixed
number of nodes a move, each opening (eight plies chosen at random among the near-best) played
twice with colours swapped.

```sh
gcc -O2 -march=native -o engine main.c engine.c search.c -lm
# a candidate against the game's evaluation, 1,000 games at 40k nodes
python3 screen.py --nodes 40000 --n 1000 --new @candidate.txt --old 100,320,295,245,140,980 --tag cand
# SPSA for strength: all numbers and the extension terms; one multiplier per piece
python3 spsa64.py --start start.txt --pairs 9000 --tag run
python3 spsa_k.py --pairs 3000 --tag runk
# independent positions with results (one per game), and five multipliers fitted to them
python3 gen_onepos.py --n 6000 --seed 1 --tag data1
python3 fit_k.py data1.pos --score candidate.txt
# the port against the JS engine (from client/, after npm ci)
npx vite-node ../research/evaluation/ref.ts moves 3000 0 in.txt js.txt
PV_EVAL=@numbers.txt ../research/evaluation/engine moves < in.txt | cmp - js.txt
```
