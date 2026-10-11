# Writes RUN-20261011-0531.report.json (the run report's words); tools/report.mjs
# draws the page from it and scoreboard.jsonl. Run: python3 RUN-20261011-0531.report.json.py
import base64, json, pathlib

here = pathlib.Path(__file__).parent
facts = json.loads((here / 'final-20261011-0531-facts.json').read_text())
BISECT = 'bisect R115: b39a335 (#115) vs 454bd45'
V1 = 'branch v1 (with W1′, since dropped) vs 0a73938'
FINAL = 'final: 4dd4448 vs 0a73938 (primary, 4 pairs)'
FIRST = 'vs first run: f3a7969 vs 92ce041 (primary, 3 pairs)'
LEAN = facts['lean_change']
RECHECK = facts['recheck_change']

def table(head, rows):
    h = ''.join(f'<th>{c}</th>' for c in head)
    b = ''.join('<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>' for r in rows)
    return f'<table><thead><tr>{h}</tr></thead><tbody>{b}</tbody></table>'

def img(name, alt):
    data = base64.b64encode((here / 'shots-20261011' / name).read_bytes()).decode()
    return f'<figure style="margin:0"><img alt="{alt}" style="max-width:100%;height:auto" src="data:image/jpeg;base64,{data}"><figcaption>{alt}</figcaption></figure>'

def pair(a, b):
    return f'<div style="display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">{a}{b}</div>'

first_click = table(['Pair', 'main (0a73938)', 'branch'], facts['first_click_rows'])

report = {
  'title': 'Perf run 20261011-0531',
  'eyebrow': '3D chess · perf-iteration · run 20261011-0531',
  'heading': facts['heading'],
  'meta': ('Base <code>0a73938</code> (main) → branch <code>improve/20261011-0531</code>' + facts['pr'] + ' · '
           '2026-10-11 05:31–' + facts['end'] + 'Z · headless Chromium 141, SwiftShader, 4 vCPU · '
           'every timing is an interleaved A/B (each pair base and head run back to back); '
           'a change is <em>called</em> only when every pair agrees and it beats 5% and the pairs’ spread.'),
  'needs': {'items': [
    {'title': 'Review and merge the PR',
     'body': '<p>Two speed fixes a player feels (a reopened long game’s record, the start page’s first click on a first visit), '
             'half of an upstream regression fixed (#115: the record’s first render; its per-landing and memory costs remain, see Next), two silent failures made visible, a server guard, a touch-layout fix, '
             'and the benchmark telling the truth about counts. ' + facts['speed_line'] + ' CI is green on the PR. It bundles a server fix (5cd0599) '
             'and a CI/format change (8c4902b) with the client work, as #116 and #117 did; CLAUDE.md asks for one change per PR. '
             'Some changes have a follow-up commit from the diff review (the run record groups them).</p>',
     'charts': [{'rows': {'change': FINAL, 'only': 'PRIMARY'}, 'caption': 'The primary rows, branch (4dd4448) against main, `--primary`, 4 pairs.'}],
     'recommend': 'Squash-merge once CI is green. If you want CLAUDE.md’s one-change rule applied strictly, I split out 5cd0599 (server) and 8c4902b (format check) as their own PRs first.'},
    {'title': 'Taste: on a phone held sideways, “Latest” loses its name while you look back',
     'body': '<p>On a touch screen the steps are a fingertip wide. In the side panel of a phone on its side (640×360), “Latest” with its name ran 22 px past '
             'the window’s edge, its icon cut off. Now the four steps share the panel’s width and the way back is the lit icon alone there; '
             'touch screens with room (a tablet, a touch laptop) keep the name. The cost: the steps are 38 px wide there (45 px at 844×390), '
             'and 36 px beside a named “Latest” on a touch laptop, where they were 40 px but overflowed. The alternative is to drop the name on every touch screen (four 45 px steps).</p>',
     'figure': {'html': pair(img('history-640x360-review-base.crop.jpg', 'Main, 640×360, touch, looking back: “Latest” cut off'),
                             img('history-640x360-review-head.crop.jpg', 'Branch: four steps inside the panel, the way back lit')),
                'caption': 'MoveHistory in the HUD’s wrappers, Chromium with a touch pointer (bench/loop/tools/history-probe).'},
     'recommend': 'Keep it: the existing rule already shows the name only “where there is room”, and here there is none; 36–38 px is above WCAG 2.2’s 24 px minimum, below Apple’s 44 pt guide.'},
    {'title': 'Say so on screen when the computer cannot think?',
     'body': '<p>If the search’s code fails to load (a deploy replaced the chunk, a dropped connection), every later answer is the first legal move, played at once, '
             'at any level: a computer that suddenly plays nonsense. This run made it log its cause; the player still sees nothing.</p>',
     'figure': {'html': pair(img('notice-before.jpg', 'Now: a computer game whose search failed looks like any other'),
                             img('notice-after.jpg', 'Proposed (a mock, not in the PR): the HUD’s own notice, with Reload')),
                'caption': 'A game against the computer, 1280×720; the right one has the notice injected in the HUD’s existing notice style.'},
     'recommend': 'Yes to a one-line notice with Reload (the game is saved locally, so a reload loses nothing). It is new interface copy, so it is your call.'},
    {'title': 'The target is not met: against the first recorded run the primary rows are ×0.97',
     'body': '<p>The run’s target was the primary rows 1.2× faster than the first recorded run (92ce041). Measured today with this checkout’s harness on both (3 pairs; 92ce041 had no computer player, so those two rows are missing): ×0.968. Faster since then: a shared game’s page −43%, reopening −33%, a move landing −40%. Slower: <strong>joining’s first board frame 1.83 → 5.61 s</strong>, the start page +10–20%, its first click 9 → 16 ms. The lobby, the garden, the preview and the entrance all came after 92ce041, so part of this is features; the join is still the biggest wait a player has.</p>',
     'charts': [{'rows': {'change': FIRST, 'only': 'PRIMARY'}, 'caption': 'This branch (f3a7969) against the first recorded run (92ce041), `--primary`, 3 pairs.'}],
     'recommend': 'Point the next run at the join (ledger J2, L1/J1): the lobby’s shader links and the game canvas’s first frame.'},
    {'title': 'Proposed, not installed: format bench scripts on save',
     'body': '<p>The lint now checks <code>bench/*.mjs</code> (one <code>.prettierrc</code> at the root). <code>.claude/hooks/format.sh</code> formats only '
             '<code>client/</code>, so an agent’s edit to a bench script can now fail the lint. It is shared machinery, so I left it alone.</p>',
     'figure': {'html': '<pre><code>  "$root"/client/*.ts|...|"$root"/client/*.json|"$root"/bench/*.mjs)\n    "$root/client/node_modules/.bin/prettier" --write --log-level warn "$f" ;;</code></pre>',
                'caption': 'The one-line change to the hook’s case pattern.'},
     'recommend': 'Add <code>"$root"/bench/*.mjs</code> to the hook’s prettier case.'},
    {'title': 'CLAUDE.md still has no North star, Measurement, Reporting, Loop state or Tests section',
     'body': '<p>The loop’s prompt relies on them; as in the last four runs I used “Performance” (what speed is for, how to measure), <code>bench/loop/</code> '
             '(ledger, scoreboard, run records) and the vitest + e2e suites.</p>',
     'figure': {'html': table(['The prompt asks for', 'Used instead'], [
        ['North star (direction, “What it is not”)', 'CLAUDE.md “Performance”, first bullet'],
        ['Measurement, Reporting', '“Performance” + ARCHITECTURE.md “Benchmarks”'],
        ['Loop state, session log', '<code>bench/loop/</code> (LEDGER.md, scoreboard.jsonl, RUN-*.md)'],
        ['Tests', 'vitest (90% gates), e2e, mutation checks per change']]), 'caption': 'What each run has used.'},
     'recommend': 'Add a short North star (what the game is for, what it is not) to CLAUDE.md; the rest can stay where it is.'},
  ]},
  'scoreboard': {'intro': facts['scoreboard_intro'], 'items': [
    {'title': 'The branch against main, primary rows (4 pairs)', 'charts': [{'rows': {'change': FINAL, 'only': 'PRIMARY'}, 'caption': 'Branch 4dd4448 against main 0a73938, `--primary`, 4 pairs.'}]},
    {'title': 'Against the first recorded run (92ce041)', 'charts': [{'rows': {'change': FIRST, 'only': 'PRIMARY'}, 'caption': 'f3a7969 against 92ce041, `--primary`, 3 pairs (the computer rows did not exist then).'}]},
    {'title': 'The rows that leaned slower, 4 more pairs', 'body': facts['lean_body'], 'charts': [{'rows': {'change': LEAN, 'only': facts['lean_only']}, 'caption': 'Final code against main: cold-load, move latency, selection, 4 pairs.'}]},
    {'title': 'Rechecked on the final commit', 'body': facts['recheck_body'],
     'charts': [{'rows': {'change': RECHECK, 'only': facts['recheck_only']}, 'caption': 'Final commit against main: reopen and cold-load sections, 4 pairs.'}]},
    {'title': 'The start page’s first click on a first visit', 'body': '<p>Each A/B pair’s first cold load (the preview’s shaders not yet cached by the browser), four A/Bs. The rule cannot call a row with two modes; the raw values show the slow mode gone, with a slower tail of 1–2 s left on the branch (the demo’s marks still link as they first show, ledger P9).</p>',
     'figure': {'html': first_click, 'caption': 'click at ready → side choice shown, the section’s first load, ms (raw `cold.desktop[0]` of each run; A/Bs v1, final, recheck).'}},
  ]},
  'changed': {'items': [
    {'title': 'A reopened long game’s record comes up a third sooner (d715022, 5eb3bda)',
     'body': '<p>#115’s move history mounted all 2,000 plies as buttons in the reopen’s first commit and read the list’s layout there. Bisected: #115 alone made '
             '“record shown” 162 → 265 ms (+56%, every pair), a landing move 5.9 → 11.6 ms and the heap +6%. This run fixes the first of the three; the landing and the heap are still #115’s (next run’s first item: a probe shows the move list’s own landing cost hardly grows with the record, so the time is elsewhere). For “record shown”, the first render now holds the blocks in view '
             '(the last two, the shown move’s) and the rest follows in a deferred render; rows out of view are not laid out. Counted in a unit test '
             '(at most 128 moves listed in the first commit, where it was 2,000).</p>',
     'charts': [{'rows': {'change': BISECT, 'only': 'Reopening a long game · (navigation → record shown|game_state handled|next move: received|long tasks total|JS heap)'}, 'caption': 'The regression: #115 against its parent, 4 pairs.'},
                {'rows': {'change': FINAL, 'only': 'Reopening a long game · (navigation → record shown|game_state handled|next move: received|long tasks total|JS heap)'}, 'caption': 'The fix: branch against main, 4 pairs.'}]},
    {'title': 'The start page answers a first visit’s click at once (d42c74e)',
     'body': '<p>The preview linked its shaders inside its first frame; on a first visit (nothing cached) a click on “Play a friend” waited 2.7–3.7 s behind it in software (13 of 15 pairs). Now never over 2.5 s (median about 0.25 s, worst 2.03 s). '
             'It links them ahead, the page free meanwhile, as the game’s board already did. The README picture is unchanged (checked pixel by pixel).</p>',
     'figure': {'html': first_click, 'caption': 'First load of each run, ms.'}},
    {'title': 'On a touch screen the history’s steps stay inside their panel (4dd4448)',
     'body': '<p>A phone on its side clipped “Latest” off screen while looking back; a touch laptop ran 6 px past the glass. hudFit.spec now runs a touch case at all 8 sizes.</p>',
     'figure': {'html': pair(img('history-640x360-review-base.crop.jpg', 'Before (main)'), img('history-640x360-review-head.crop.jpg', 'After')), 'caption': '640×360, touch, looking back.'}},
    {'title': 'The benchmark tells the truth about counts (30b0367, f165177)',
     'body': '<p>The A/B dropped any pair with a 0 side, so a count guard going 0 → N (programs linked once warm, a leak) read “one side only”, never worse. '
             'Counts are now judged by their pairs’ differences. Its first use caught a regression of mine (below, rejected): programs linked in play 0 → 8.</p>'},
    {'title': 'Smaller: a frame for nothing, two silent failures, a server guard, honest checks',
     'body': '<ul><li>The glide’s marker is one object: a Board render that changes nothing no longer asks for a frame after a move has glided (b19b47a; Board.test counts it).</li>'
             '<li>The computer logs why it cannot think, instead of silently playing the first legal move (8124196).</li>'
             '<li>The server never looks up a game id it could not have made; a crafted link could make a friend’s browser send a megabytes-long key to the store (5cd0599).</li>'
             '<li>Checks that passed on broken code now fail on it, each mutation-tested: the review’s back glide on all three axes, review.test’s identity case, MoveHistory’s render counts, noWebGL.spec waiting for each canvas to fail, Playwright’s <code>forbidOnly</code> on CI.</li>'
             '<li>Bench: rows for the first pick and the first load’s click; primary sections derived from the rows; bench scripts format-checked.</li></ul>'},
  ]},
  'removed': {'intro': facts['removed']},
  'rejected': {'items': [
    {'title': 'The warm-up linking one program at a time, a pick’s first (W1′; with it, the garden copy left out, W2, not measured alone and back in the ledger)',
     'body': '<p>Meant to stop a quick first pick waiting on the warm-up (2.3–2.6 s in software). It did not help (2.53 → 2.38 s, not called): the pick’s render() is 2–3 ms, '
             'its frame waits on a GPU process busy linking, which no order of links shortens in software. And the warm-up finished later, so play linked programs: '
             '0 → 8 over 16 plies, an opponent’s capture 154 → 710 ms. Dropped before any push.</p>',
     'charts': [{'rows': {'change': V1, 'only': '(Move latency · opponent’s move: sent → first frame, captures|Selecting a piece · first pick: click)'}, 'caption': 'Branch v1 (with W1′) against main, 3 pairs.'}]},
    {'title': 'Smaller', 'body': '<ul><li>Removing <code>ignoreMove</code> (looked unreachable): it is a second guard the review test calls on purpose.</li>'
             '<li>Saving a computer game after the echo instead of before: ' + facts['a4'] + '</li></ul>'},
  ]},
  'choices': {'intro': facts['choices']},
  'notConfirmed': {'intro': facts['not_confirmed']},
  'merge': {'intro': '<p>No other sessions were active. Files other work touches: CLAUDE.md (one sentence: the lint also checks <code>bench/*.mjs</code>), '
                     'ARCHITECTURE.md (the move list’s two renders, the preview’s linked first frame, counts in the A/B), and <code>client/.prettierrc</code> moved to the repo root.</p>'},
  'next': {'intro': facts['next']},
}
(here / 'RUN-20261011-0531.report.json').write_text(json.dumps(report, ensure_ascii=False, indent=1))
print('written')
