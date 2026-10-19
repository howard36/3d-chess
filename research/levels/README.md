# The players' strength

Every player the computer has (`client/src/ai/levels.ts`: Easy, Medium and Hard, and the two the
game does not offer, the engine on a budget of positions and the expert) on one Elo scale, how
long each takes over a move, how the levels err and how varied they are, how the levels came to
play as people do, and the tools to measure them again. None of this ships.

The levels as they were before they played as people do are still here as references
(`players.ts`): `easy0`, `medium0` and `hard0` (the old Hard: the engine on the clock, `hard0:d1`
its search to one ply). The scale puts the Medium the game's owner tied with at 1500
(`medium1500`: three plies, before Medium had a budget of positions), the player every other
rating is measured from.

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
  on the games' scores, a draw half), shifted to put `medium1500` at 1500 (another anchor:
  `fit.py medium0=0`).
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
overlooks what is hard to see on five levels, more in a fight: Easy 862, Medium 1,447 and Hard
2,049, Medium about halfway, on a scale with the Medium the game's owner tied with at 1500.

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
  to 8 plies, −313. Easy then overlooked from 0.05 (up to 95%) and chose as freely as Medium:
  −526; since, it overlooks every hard move it can, at temperature 30 (below).
- Hard: the expert's numbers on 15,000 positions +491 ± 34 (25,000: +645).
- The references and the old Medium disagree. Against the old Medium itself the new levels do
  better than the references foretold (Medium +54 where they said about +10, Easy −336 where
  they said −470, Hard on 15,000 positions +402 where they said +491): players that err by not
  seeing do better against one that errs by choosing at random than the scale's other players
  suggest. So the last round tuned against the old Medium directly for Medium (its target is
  the old Medium's strength as a player meets it), then Easy and Hard against the new Medium (the
  gap a player feels between two levels), 300 to 400 games each.

The levels as the game has them, every match fitted at once (`fit.py`; ± one standard error):

| Player                     |     Rating | Against `medium1500`, directly    |
| -------------------------- | ---------: | --------------------------------- |
| Easy                       |   862 ± 12 | 3.4% ± 0.9% over 400 games (−583) |
| Medium                     | 1,447 ± 10 | 42.6% ± 1.7% over 800 (−52)       |
| Hard                       | 2,049 ± 15 | 95.8% ± 0.7% over 800 (+544)      |
| `medium1500` (the anchor)  |       1500 |                                   |
| Easy before this round     |   905 ± 11 | 4.3% ± 0.7% over 800 (−538)       |
| Hard before this round     | 2,110 ± 17 | 96.4% ± 0.7% over 700 (+569)      |
| the old Easy (`easy0`)     |   621 ± 23 |                                   |
| the old Medium (`medium0`) | 1,484 ± 12 | 49.8% ± 2.4% over 400 (−2)        |

(Easy before this round overlooked from hardness 0.05, up to 95%, at temperature 20; Medium,
`medium1500`, searched three plies on the clock at temperature 19 with noise 11; Hard chose at
temperature 14.)

In a Chromium worker (`speed.mjs`, 120 positions from games) they take a median of 1 ms a move
(Easy, 250 positions), 24 ms (Medium, 25,500; p90 32 ms) and 27 ms (Hard, 26,500; p90 33 ms),
where the old ones took 5, 24 and 1,280 ms.

**Medium on Hard's budget.** Medium searched three plies with its time (0.8 s) as its only other
limit, so its work depended on the position: in its games against itself a median of 22,000
positions a move but a mean of 66,000, one move in a hundred over 450,000 and the longest 1.1
million, more than Hard's 30,000, and on a slower device its time cut the longest searches
short (in a Chromium worker a median of 11 ms, but 66 ms at the 90th percentile). Now it searches
on Hard's budget, with no depth limit, so it never searches more than Hard and plays the same on
any device; Hard beats it by knowing more and seeing more. Its temperature and noise moved
between Easy's and Hard's too (29 and 5, from 19 and 11), and its strength to about halfway
between theirs. The candidates, each against `medium1500`, at temperature 29 and noise 5 unless
said:

| Medium                                |     Rating |
| ------------------------------------- | ---------: |
| three plies, no budget                |  1,481 ± 9 |
| three plies, no budget, noise 10      |  1,481 ± 9 |
| three plies and 30,000 positions      | 1,431 ± 17 |
| 30,000 positions (as the game has it) | 1,447 ± 10 |
| 30,000 positions, noise 0             | 1,468 ± 17 |
| 20,000 positions                      | 1,441 ± 17 |
| 20,000 positions, noise 0             | 1,428 ± 17 |
| 10,000 positions                      | 1,350 ± 18 |
| 5,000 positions                       | 1,310 ± 19 |

Capping the three plies at 30,000 positions changes the move in 40% of positions (Medium needed
more in 45% of them); a budget alone, which goes deeper where the position is simple, is as
strong for the same work. Hard beats the old Medium by more than it beats `medium1500` though the
two are level with each other: the old one's random blunders are what Hard punishes best.

**The scale, and the matches chosen for what they tell** (`results.txt`'s last sections,
cloud sessions). A game between players far apart says little: its information about the gap
goes as p(1−p), so a 97%–3% game tells about an eighth of an even one. And most of a match's
cost is the slower player's: Medium about 50 ms a move against Easy's 1 to 2, Medium cut to one
ply or two (`medium{"maxDepth":1}`, `{"maxDepth":2}`) 2 to 9. So the last round played near-even
pairings, most of them between cheap players (Easy's candidates against each other and against
the cut-down Mediums), linked to Medium and on to Hard by more than one path (Hard on 15,000
positions, the engine on 10,000), and fitted every match at once, `medium1500` put at 1500. Easy's
errors came down from ±19–30 to ±13.

| Player                     | Temperature |     Rating | Same move in a position | First move: most common, different |
| -------------------------- | ----------: | ---------: | ----------------------: | ---------------------------------- |
| Easy (overlooking from 0)  |          20 |   871 ± 12 |               40% (5.2) | 3.5%, 50 of 61                     |
| Easy, as the game has it   |          30 |   862 ± 12 |               38% (5.3) | 3.1%, 50                           |
| Easy                       |          40 |   848 ± 12 |               38% (5.3) | 3.0%, 50                           |
| `medium1500`               |          19 |       1500 |               49% (4.4) | 4.7%, 48                           |
| `medium1500`               |          28 | 1,465 ± 11 |               47% (4.6) | 4.1%, 48                           |
| `medium1500`               |          38 | 1,449 ± 11 |               47% (4.6) | 4.0%, 48                           |
| Medium, as the game has it |          29 | 1,447 ± 10 |               45% (4.8) | 3.8%, 48                           |
| Hard                       |          14 | 2,110 ± 17 |               66% (3.0) | 13.3%, 41                          |
| Hard                       |          21 | 2,056 ± 20 |                         |                                    |
| Hard, as the game has it   |          28 | 2,049 ± 15 |               58% (3.6) | 6.6%, 43                           |

A higher temperature buys Hard variety (its margin is narrow and its scores close, so at 14 it
played its best most of the time), for 61 Elo (68 ± 16 in their own match). Easy's and Medium's
hardly vary more: the moves they would choose among are few and far apart, so the temperature
does not reach them. Easy plays at 30, Medium at 29 (with its budget, above). Easy's candidates that followed captures only 2 plies scored about as
badly against `medium1500` cut to two plies as against `medium1500` itself, which no single rating fits:
left out.

Where the gap is wide the fit leans on the near-even pairings, which carry the information, and
there the logistic's tail shows: Easy scores 3.4% against `medium1500` where the chain of near-even
pairings foretells 2.5% (a direct −583 against the fit's −638). Ratings this far apart are less
exact than their error bars, by some tens of Elo, the way a weaker player's upsets come a little
more often than the curve allows.

**How the levels err** (`marks.ts`: 40 games of each against itself in 4 runs of 10, every
position reviewed as the game's review now does, with the expert's numbers and king and pawn
against king), per 100 moves, ± one standard error from the spread between the runs (blunders
come in clusters within a game):

| Level          | Moves | Brilliant | Inaccuracies |  Mistakes |  Blunders | Blunders, quiet | Blunders, tense |
| -------------- | ----: | --------: | -----------: | --------: | --------: | --------------: | --------------: |
| Easy           | 4,192 |       0.1 |   14.0 ± 0.5 | 4.3 ± 0.4 | 5.1 ± 0.8 |       3.6 ± 1.3 |       8.0 ± 0.8 |
| Medium         | 5,338 |       0.2 |    8.0 ± 0.8 | 1.9 ± 0.1 | 2.4 ± 0.4 |       0.1 ± 0.1 |       5.5 ± 0.9 |
| Hard           | 6,601 |       0.6 |    5.7 ± 0.4 | 1.3 ± 0.1 | 0.8 ± 0.2 |       0.5 ± 0.2 |       1.5 ± 0.2 |
| `medium1500`   | 5,198 |       0.4 |    8.3 ± 0.9 | 1.9 ± 0.3 | 2.5 ± 0.4 |       0.6 ± 0.3 |       4.7 ± 0.7 |
| the old Easy   | 4,836 |       0.1 |   15.7 ± 1.2 | 6.9 ± 0.5 | 5.5 ± 0.3 |       4.3 ± 1.4 |       8.5 ± 1.0 |
| the old Medium | 5,367 |       0.1 |    8.2 ± 1.1 | 2.0 ± 0.3 | 1.9 ± 0.3 |       1.4 ± 0.8 |       2.7 ± 0.3 |

(quiet: tension at most 0.6, few captures to make and few pieces attacked; tense: at least 1;
per 100 moves of each.) Each blunders more in a fight than in a quiet position; Medium hardly
ever in a quiet one, Hard hardly ever at all. Medium on its budget errs as it did on three
plies (`medium1500`). An earlier count on 10 games each, by the review
as it was, had Easy's quiet blunders at 0.6: 10 games are too few (Easy's four runs gave 6.1,
0.9, 1.5 and 5.1).

**How varied they are** (`variety.ts`: 120 positions from games, each level moving 8 times in
each as in 8 different games): how often it played its most frequent move there.

| Level  | Before (`easy0`, `medium0`, the engine on 15,000 positions) | Now       |
| ------ | ----------------------------------------------------------- | --------- |
| Easy   | 30% (6.1 different moves of 8)                              | 38% (5.3) |
| Medium | 40% (5.2)                                                   | 45% (4.8) |
| Hard   | 79% (2.1)                                                   | 58% (3.6) |

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
These ratings put the old Medium at 0 (`fit.py medium0=0`, those games alone); on the scale
above, with every match since, add about 1,480.

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
