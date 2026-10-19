# The players' strength

Every player the computer has (`client/src/ai/levels.ts`: Easy, Medium and Hard, and the two the
game does not offer, Hard on a budget of positions and the expert) on one Elo scale, how long
each takes over a move, and the tools to measure them again. None of this ships.

## The tools

- `match.ts`, run by `run.mjs` over the machine's cores: a match between two players as the game
  plays them (`chooseMove`: the level's choice, its noise and blind spots, a fresh search each
  move), A White in the even games, to mate, stalemate, threefold repetition, the fifty-move
  rule, 400 plies, or resignation (both sides have scored it ten pawns or more apart three moves
  running, or the mover sees itself mated). One JSON line a game, the score on stderr. A player
  is a name from `LEVELS`, with a budget of positions (`expert@40000`: the budget the search
  stops short of as the clock would, see below) or a depth (`hard:d2`: Hard's search to two
  plies, whatever the time).

  ```sh
  cd client && npx rolldown ../research/levels/match.ts --file ../research/levels/match.mjs --format esm --platform node
  cd ../research/levels && node run.mjs expert@40000 hardFixed@40000 400 860000 4 > x5.jsonl 2> x5.txt
  ```

- `results.txt`: every match's score, its wins, draws and losses, and each player's mean time and
  positions a move in it (with all of the match's workers sharing the machine, so slower than a
  search alone).
- `fit.py`: every player on one Elo scale, fitted to all of `results.txt` at once (Bradley–Terry
  on the games' scores, a draw half; Medium at 0 unless another anchor is named).
- `speed.mjs` (with `speed.ts`): how long each player takes over a move in a Chromium worker, as
  the game runs it, on 118 positions from Medium's games against itself; the same player names,
  and `name=N` for a search of exactly N positions. `CHROMIUM=/path/to/chromium node speed.mjs
hard hardFixed expert@40000`.

## Hard on a budget of positions

Hard thinks by the clock (up to 1.8 s, no new iteration after 45% of it), so it plays as strong
as the machine is fast. `hardFixed` keeps the clock's rules with a clock that counts positions:
its 1.8 million stand for Hard's 1.8 s at a million positions a second, which is how fast Hard
searches in a Chromium worker on the machine these were measured on. It plays the same on any
device, quicker on a faster one, slower on a slower one.

In a Chromium worker on this machine (`speed.mjs`), Hard on the clock takes a median 1.28 s over
a move (10th to 90th percentile 0.89–1.80 s) and searches 1.21 million positions; `hardFixed`
1.33 s (0.90–2.04 s) and 1.30 million. By the scale's slope (below) Hard's 7% fewer positions
are worth some 20 Elo. In the game a move also waits out `thinkTime` (Hard 1.1–2.3 s, less in the
opening and for a forced or obvious move), so either takes about that long to the player.

On the cloud machines that played `l9`, three games at once, Hard on the clock managed only
about a million positions a move, a quarter fewer than `hardFixed`, and `hardFixed` beat it
66.3% ± 2.8% (208 games, +118 ± 42 Elo): the clock's Hard is as strong as its machine.

## The scale

5,610 games over 15 pairings (`results.txt`), fitted together; ± one standard error. The levels
are far apart, so the scale is bridged by Hard's search to a fixed depth (`hard:d1`, `hard:d2`) and
on budgets of positions. Time is the median a move in a Chromium worker (`speed.mjs`).

| Player                       |    Elo |   ± | Time a move | Positions a move |
| ---------------------------- | -----: | --: | ----------: | ---------------: |
| Easy                         |   −897 |  65 |        5 ms |             4.6k |
| `hard:d1` (one ply)          |    −86 |  16 |             |                  |
| Medium                       |      0 |     |       23 ms |              25k |
| `hard:d2`                    |   +191 |  18 |             |                  |
| `hardFixed@10000`            |   +303 |  22 |       10 ms |               9k |
| `hardFixed@40000`            |   +651 |  33 |       33 ms |              31k |
| `expert@40000`               |   +864 |  36 |       37 ms |              33k |
| `hardFixed@160000`           |   +968 |  37 |      128 ms |             122k |
| `expert@80000`               | +1,041 |  40 |       67 ms |              62k |
| `expert@160000`              | +1,290 |  49 |      133 ms |             128k |
| `hardFixed@640000`           | +1,368 |  46 |      457 ms |             453k |
| `hard`, on the `l9` machines | +1,496 |  54 |             |            1.00M |
| `hardFixed` (Hard, 1.8M)     | +1,614 |  49 |    1,330 ms |            1.30M |

The expert against the levels: on 40k, 80k and 160k positions +1,760 ± 75, +1,938 ± 77 and
+2,187 ± 82 over Easy, +864, +1,041 and +1,290 over Medium, and −750 ± 35, −572 ± 36 and
−324 ± 18 under `hardFixed` (the differences' own errors). On a budget the search stops short of
it, as the clock would (no new iteration after 45% of it); a search of exactly 40k, 80k and 160k
positions takes the expert 44, 88 and 175 ms. The expert on Hard's whole budget (`expert`) has
not been matched.

- Each fourfold in Hard's budget is worth about 350 Elo (10k→40k +348, 40k→160k +317, 160k→640k
  +399; 640k→1.8M, 2.8 times as many, +246).
- At the same budget the expert beats Hard 74.9% ± 2.0% at 40k (400 games; research/evaluation's
  75.2% against the same evaluation at the research's settings): it plays as well as Hard does on
  about 2.7 times its positions at 40k and 3.3 times at 160k.
- These are self-play ratings, between players that share a search: chained across a span this
  wide they overstate the gaps a person would feel. Easy's rests on 6 wins in 800 games against
  the two players nearest it (`hard:d1`, a one-ply search, and Medium), so on the logistic
  curve's tail more than on its error.
- Hard on the clock, on this machine, searches about 7% fewer positions than `hardFixed`
  (above), some 20 Elo by the budget's slope: Hard here ≈ +1,590.
