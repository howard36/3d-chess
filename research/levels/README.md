# The players' strength

Every player the computer has (`client/src/ai/levels.ts`: Easy, Medium and Hard, and the two the
game does not offer, the engine on a budget of positions and the expert) on one Elo scale, how
long each takes over a move, how the levels err and how varied they are, how the levels came to
play as people do, and the tools to measure them again. None of this ships.

The levels as they were before they played as people do are still here as references
(`players.ts`): `easy0`, `medium0` and `hard0` (the old Hard: the engine on the clock, `hard0:d1`
its search to one ply). The scale's 0 is `medium0`.

## The tools

- `match.ts`, run by `run.mjs` over the machine's cores: a match between two players as the game
  plays them (`chooseMove`: the level's choice, its noise and blind spots, a fresh search each
  move), A White in the even games, to mate, stalemate, threefold repetition, the fifty-move
  rule, 400 plies, or resignation (both sides have scored it ten pawns or more apart three moves
  running, or the mover sees itself mated). One JSON line a game, the score on stderr. A player
  is a name from `LEVELS` or a candidate from `players.ts`, with a budget of positions
  (`expert@40000`: the budget the search stops short of as the clock would, see below) or a
  depth (`hard0:d2`: the old Hard's search to two plies, whatever the time), then optionally more
  of its level as JSON (`medium{"maxDepth":2}`). `MATCH=other.mjs` plays another build of it.

  ```sh
  cd client && npx rolldown ../research/levels/match.ts --file ../research/levels/match.mjs --format esm --platform node
  cd ../research/levels && node run.mjs expert@40000 hardFixed@40000 400 860000 4 > x5.jsonl 2> x5.txt
  ```

- `results.txt`: every match's score, its wins, draws and losses, and each player's mean time and
  positions a move in it (with all of the match's workers sharing the machine, so slower than a
  search alone).
- `fit.py`: every player on one Elo scale, fitted to all of `results.txt` at once (Bradley–Terry
  on the games' scores, a draw half; the old Medium at 0 unless another anchor is named).
- `knowledge.py`: the beginner's and the advanced player's numbers, fitted to the expert's
  evaluation (below).
- `marks.ts` and `variety.ts` (bundled as `match.ts` is): how a player errs, as the game's review
  marks its games against itself, quiet positions and tense ones apart; and how often it plays the
  same move in the same position from one game to the next.
- `speed.mjs` (with `speed.ts`): how long each player takes over a move in a Chromium worker, as
  the game runs it, on 118 positions from Medium's games against itself; the same player names,
  and `name=N` for a search of exactly N positions. `CHROMIUM=/path/to/chromium node speed.mjs
hard hardFixed expert@40000`.

## The levels as people play

Easy, Medium and Hard play as a beginner, an advanced player and an expert (ARCHITECTURE.md
"Playing the computer"): each knows as much of the game as one would, looks as far ahead, and
overlooks what is hard to see on five levels, more in a fight; Easy about 500 Elo below the old
Medium, Medium level with it, Hard about 500 above.

**What each knows** (`knowledge.py`, fitted on research/evaluation's 75,235 training positions):
a subset of the 58 evaluation numbers, fitted by least squares in expected score to the expert's
evaluation, the rest left at nothing. Error against the expert (rms, expected score):

| Evaluation                                      |    rms | rms cp |
| ----------------------------------------------- | -----: | -----: |
| the expert's numbers, its four extra terms off  | 0.0193 |   16.6 |
| advanced, fitted (47 numbers)                   | 0.0195 |   17.0 |
| advanced, the expert's with the rest struck out | 0.0258 |   27.9 |
| the hand-set numbers (the old levels)           | 0.0297 |   28.3 |
| beginner, fitted (11 numbers)                   | 0.0371 |   39.3 |

The advanced player's fitted numbers agree with the expert as closely as the expert's own do
without its extra terms; striking numbers out instead costs a third more error.

**Tuning** (`players.ts` has the candidates, `results.txt` every match): each level's character
fixed (its knowledge, how far it looks, what it overlooks), then one dial turned by matches
against players near its target on the scale (`hard0:d1`, `hard0:d2`, `easy0`, `hardFixed@10000`,
`@40000`), 120–160 games each. What the rounds showed:

- Errors of perception cost far less strength than choosing badly. A 3-ply player with the
  advanced numbers that overlooks nothing is +359; overlooking every hard move it can, still +120;
  the old Medium, the same 3 plies, lost some 500 Elo to its random choice. So Medium chooses
  more freely in a fight (margin, temperature and noise scaled by tension), and still mostly errs
  by not seeing.
- At one ply, the shallow search is what holds Easy. Against the reference `hard0:d1` it moved
  only from −523 to −636 between overlooking little (from hardness 0.4, up to 60%) and every
  hard move it can. Against the new Medium, overlooking from 0.1 (up to 90%) it was −458 and
  overlooking all it can −594; choosing steadily (margin 30, no noise) and following captures
  to 8 plies, −313. The game's Easy overlooks from 0.05 (up to 95%) and chooses as freely as
  Medium: −526.
- Hard: the expert's numbers on 15,000 positions +491 ± 34 (25,000: +645).
- The references and the old Medium disagree. Against the old Medium itself the new levels do
  better than the references foretold (Medium +54 where they said about +10, Easy −336 where
  they said −470, Hard on 15,000 positions +402 where they said +491): players that err by not
  seeing do better against one that errs by choosing at random than the scale's other players
  suggest. So the last round tuned against the old Medium directly for Medium (its target is
  the old Medium's strength as a player meets it), then Easy and Hard against the new Medium (the
  gap a player feels between two levels), 300 to 400 games each.

The levels as the game has them (`results.txt`, the last rounds):

| Match                          | Games | Score        |  Elo |
| ------------------------------ | ----: | ------------ | ---: |
| Medium against the old Medium  |   400 | 50.2% ± 2.4% |   +2 |
| Easy against Medium            |   400 | 4.6% ± 1.0%  | −526 |
| Easy against the old Medium    |   300 | 5.2% ± 1.3%  | −506 |
| Hard against Medium            |   300 | 95.0% ± 1.2% | +512 |
| Hard against the old Medium    |   300 | 97.8% ± 0.8% | +662 |
| Easy against the old Easy      |   200 | 82.0% ± 2.7% | +263 |
| Hard against `hardFixed@40000` |   200 | 49.3% ± 3.3% |   −5 |

In a Chromium worker (`speed.mjs`) they take a median of 2 ms a move (Easy, 250 positions), 14 ms
(Medium, 10,000) and 32 ms (Hard, 26,000; p90 42 ms), where the old ones took 5, 24 and 1,280 ms.

Hard beats the old Medium by more than it beats the new one though the two Mediums are level
with each other: the old one's random blunders are what Hard punishes best. The gaps a player
feels are the ones between the levels as they are now: Easy about 525 below Medium, Hard about
510 above. Fitted with every other match (`fit.py`), the old Medium at 0: Easy −550 ± 26, Medium
+3 ± 13, Hard +617 ± 28.

**How the levels err** (`marks.ts`: 10 games of each level against itself, 6 of each old one,
every position reviewed as the game's review does), per 100 moves:

| Level          | Games | Brilliant | Inaccuracies | Mistakes | Blunders | Blunders, quiet | Blunders, tense |
| -------------- | ----: | --------: | -----------: | -------: | -------: | --------------: | --------------: |
| Easy           |    10 |       0.1 |         14.1 |      2.9 |      4.4 |      0.6 of 326 |     10.6 of 282 |
| Medium         |    10 |       0.3 |         11.5 |      2.3 |      1.9 |        0 of 200 |      3.1 of 574 |
| Hard           |    10 |       0.7 |          5.1 |      0.5 |      0.3 |      0.2 of 444 |      0.3 of 392 |
| the old Easy   |     6 |       0.2 |         11.2 |      5.6 |      5.1 |         0 of 71 |     11.0 of 181 |
| the old Medium |     6 |       0.2 |          7.1 |      0.6 |      1.9 |      0.4 of 246 |      4.1 of 217 |

(quiet: tension at most 0.6, few captures to make and few pieces attacked; tense: at least 1; per
100 moves of each.) Easy and Medium blunder in a fight and hardly ever in a quiet position; Hard
hardly ever at all.

**How varied they are** (`variety.ts`: 120 positions from games, each level moving 8 times in
each as in 8 different games): how often it played its most frequent move there.

| Level  | Before (`easy0`, `medium0`, the engine on 15,000 positions) | Now       |
| ------ | ----------------------------------------------------------- | --------- |
| Easy   | 30% (6.1 different moves of 8)                              | 41% (5.1) |
| Medium | 40% (5.2)                                                   | 49% (4.4) |
| Hard   | 79% (2.1)                                                   | 66% (3.0) |

The old Easy and Medium varied by choosing badly at random; the new ones vary less from one move
to the next but err less in quiet positions, and Hard varies more than it did. Each game also has
a style of its own and blind spots of its own, which a single position does not show.

## The old Hard on a budget of positions

The old Hard (`hard0`, the engine at full stretch) thought by the clock (up to 1.8 s, no new iteration after 45% of it), so it plays as strong
as the machine is fast. `hardFixed` keeps the clock's rules with a clock that counts positions:
its 1.8 million stand for its 1.8 s at a million positions a second, which is how fast the engine
searches in a Chromium worker on the machine these were measured on. It plays the same on any
device, quicker on a faster one, slower on a slower one.

In a Chromium worker on this machine (`speed.mjs`), the old Hard on the clock takes a median 1.28 s over
a move (10th to 90th percentile 0.89–1.80 s) and searches 1.21 million positions; `hardFixed`
1.33 s (0.90–2.04 s) and 1.30 million. By the scale's slope (below) its 7% fewer positions
are worth some 20 Elo.

On the cloud machines that played `l9`, three games at once, the old Hard on the clock managed only
about a million positions a move, a quarter fewer than `hardFixed`, and `hardFixed` beat it
66.3% ± 2.8% (208 games, +118 ± 42 Elo): on the clock it is as strong as its machine.

## The scale, with the old levels

The first 5,610 games over 15 pairings (`results.txt`), fitted together; ± one standard error. The
old levels are far apart, so the scale is bridged by the old Hard's search to a fixed depth
(`hard0:d1`, `hard0:d2`) and on budgets of positions. Time is the median a move in a Chromium worker (`speed.mjs`).

| Player                     |    Elo |   ± | Time a move | Positions a move |
| -------------------------- | -----: | --: | ----------: | ---------------: |
| `easy0` (the old Easy)     |   −897 |  65 |        5 ms |             4.6k |
| `hard0:d1` (one ply)       |    −86 |  16 |             |                  |
| `medium0` (the old Medium) |      0 |     |       23 ms |              25k |
| `hard0:d2`                 |   +191 |  18 |             |                  |
| `hardFixed@10000`          |   +303 |  22 |       10 ms |               9k |
| `hardFixed@40000`          |   +651 |  33 |       33 ms |              31k |
| `expert@40000`             |   +864 |  36 |       37 ms |              33k |
| `hardFixed@160000`         |   +968 |  37 |      128 ms |             122k |
| `expert@80000`             | +1,041 |  40 |       67 ms |              62k |
| `expert@160000`            | +1,290 |  49 |      133 ms |             128k |
| `hardFixed@640000`         | +1,368 |  46 |      457 ms |             453k |
| `hard0`, the `l9` machines | +1,496 |  54 |             |            1.00M |
| `hardFixed` (1.8M)         | +1,614 |  49 |    1,330 ms |            1.30M |

The expert against the old levels: on 40k, 80k and 160k positions +1,760 ± 75, +1,938 ± 77 and
+2,187 ± 82 over the old Easy, +864, +1,041 and +1,290 over the old Medium, and −750 ± 35, −572 ± 36 and
−324 ± 18 under `hardFixed` (the differences' own errors). On a budget the search stops short of
it, as the clock would (no new iteration after 45% of it); a search of exactly 40k, 80k and 160k
positions takes the expert 44, 88 and 175 ms. The expert on the engine's whole budget (`expert`)
has not been matched.

- Each fourfold in the engine's budget is worth about 350 Elo (10k→40k +348, 40k→160k +317, 160k→640k
  +399; 640k→1.8M, 2.8 times as many, +246).
- At the same budget the expert beats the engine 74.9% ± 2.0% at 40k (400 games; research/evaluation's
  75.2% against the same evaluation at the research's settings): it plays as well as the engine does on
  about 2.7 times its positions at 40k and 3.3 times at 160k.
- These are self-play ratings, between players that share a search: chained across a span this
  wide they overstate the gaps a person would feel. The old Easy's rests on 6 wins in 800 games
  against the two players nearest it (`hard0:d1`, a one-ply search, and `medium0`), so on the logistic
  curve's tail more than on its error.
- The old Hard on the clock, on this machine, searched about 7% fewer positions than `hardFixed`
  (above), some 20 Elo by the budget's slope: the old Hard here ≈ +1,590.
