# Writes final-20261015-0212-facts.json: the run's last numbers, read by
# RUN-20261015-0212.report.json.py. Run: python3 final-20261015-0212-facts.py
import json, pathlib
here = pathlib.Path(__file__).parent
FIRST_DONE = False  # set once ab-20261015-vs-first-run.md is in the scoreboard
facts = {
  'ci': 'CI passed on the merge commit 89eb146: client, server tests and all three e2e shards.',
  'recheck_change': 'tip: 89eb146 vs de25815 (cold-load + review, 3 pairs)',
  'recheck_caption': 'The final commit 89eb146 against main de25815 (main after #141, #144 and #145), 3 pairs.',
  'recheck': ('<p>After merging main, I measured the start page and the review again on the final commit, against the new main. '
              'Both results hold: the phone’s board appears at 923 ms instead of 1.76 s (46% faster), and the review finishes in 4.74 s instead of 10.4 s (56% faster), both called. '
              'Both “usable” rows leaned faster (desktop 2.8%, phone 6.5%), not called.</p>'
              '<p>One row was called worse: the desktop’s first visit’s first click, 19 → 512 ms. It is timed once per run and has two modes, about 15 ms or about 500 ms, depending on whether the click lands while the first visit is still preparing its shaders. '
              'Pooled over the last two A/Bs, the slow mode came up in 4 of 9 branch runs and 3 of 9 main runs, and the 6-pair re-check before the merge called nothing (it leaned 82% faster). '
              'Main’s own later clicks hit the slow mode too (370, 555 and 338 ms). I read it as noise that a 3-pair A/B can call either way; the next run times more first visits.</p>'),
  'scoreboard_extra': '',
  'removed': ('<p>Nothing was deleted outright. Against the current main, the branch adds 574 lines and removes 215 in 30 files, outside the run’s notes. '
              'The app’s code grows by 59 lines (client +27, server +32): the parallel review and its stopped state, the rematch’s seat, the preload fix, the size cap and the copying store. '
              'Cleanup removed 29 lines from GameActions (six near-identical blocks into one table) and 21 lines of test stubs that nothing read. '
              'Tests grow by 153 lines, the bench by 123 (the review section, the picture count and the probe), lint by 11 and docs by 13. '
              'My shared e2e resign helper and level-list change were dropped in the merge, since #144 had made the same changes.</p>'),
  'e2e': 'The full e2e suite on this machine. It ran in CI on the merge commit and passed; here I ran the six specs the changes touch (14 tests, all passing).',
  'first_change': 'vs first run: 89eb146 vs 92ce041 (primary, 3 pairs)',
  'first_caption': 'The final commit 89eb146 against the first recorded run 92ce041, 3 pairs.',
  'first': ('<p>The run’s target was 1.2 times the speed of the first recorded run (92ce041). The final commit is 2.17 times as fast over the eleven headline measurements the old code can also make; it had no computer player and no review. '
             'Six are called better, most by far: a move or a picked-up piece now appears in about 0.4–0.5 s instead of over 5 s, mostly from the last run’s change to how pictures reach the GPU. '
             'Three are called worse than the first run, all on the start page: usable on desktop (78 → 123 ms) and on the phone (709 → 925 ms), and the first click (8.5 → 22 ms). The start page has grown a lot since then (the computer player, the tutorial, the picture), and this run’s fix recovers only part of that. '
             'A reopened long game uses 34% more JavaScript heap than in the first run, as earlier runs already found.</p>'),
}
(here / 'final-20261015-0212-facts.json').write_text(json.dumps(facts, ensure_ascii=False, indent=1))
print('written')
