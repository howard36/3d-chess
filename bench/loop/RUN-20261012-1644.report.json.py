# Writes RUN-20261012-1644.report.json (the run report's words); tools/report.mjs
# draws the page from it and scoreboard.jsonl. Run: python3 RUN-20261012-1644.report.json.py
import json, pathlib

here = pathlib.Path(__file__).parent
facts = json.loads((here / 'final-20261012-1644-facts.json').read_text())
BASE = 'base measurement: 889c13f, 3 runs (--primary --repeat 3)'
LW2 = 'LW v2 (rejected): lobby links right after its first frame vs 889c13f (setup+computer, 4 pairs)'
WF = 'WF: warm-up in one frame vs 889c13f (select+move-latency+computer, 4 pairs)'
WFS = 'WF: warm-up in one frame vs 889c13f (select, 4 more pairs)'
W1B = "W1b v1: warm-up linked from the board's first frame vs 924cb6f (setup+computer+move-latency+select, 4 pairs)"
FINAL = facts['final_change']
W1C = 'final v2: W1b with read-backs at rest vs 889c13f (computer+select, 4 pairs)'
V3 = 'final v3: e4ee30c (with W1b) vs 889c13f (primary, 3 pairs)'
RAW = json.loads((here / facts['w1c_raw']).read_text())
FIRST = facts['first_change']

def table(head, rows):
    h = ''.join(f'<th>{c}</th>' for c in head)
    b = ''.join('<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>' for r in rows)
    return f'<table><thead><tr>{h}</tr></thead><tbody>{b}</tbody></table>'

PICK = 'Selecting a piece · (first pick: click|first pick made|click → first frame with the piece held)'

report = {
  'title': 'Perf run 20261012-1644',
  'eyebrow': '3D chess · perf-iteration · run 20261012-1644',
  'heading': facts['heading'],
  'meta': ('Base <code>889c13f</code> (main) → branch <code>improve/20261012-1644</code>, '
           '<a href="https://github.com/howard36/3d-chess/pull/121">PR #121</a> · 2026-10-12 16:44–' + facts['end'] + 'Z · '
           'headless Chromium 141, SwiftShader, 4 vCPU · every timing is an interleaved A/B (each pair base and head run back to back); '
           'a change is <em>called</em> only when every pair agrees and it beats 5% and the pairs’ spread.'),
  'needs': {'items': [
    {'title': 'Review and merge PR #121',
     'body': '<p>The warm-up of the marks of play draws in one frame instead of thirteen (−11 lines), three correctness fixes (a computer that could stall for ever, a computer game that rewound after its storage filled, guessable game ids), '
             'and seven checks that could pass on broken code, or rules nothing enforced, now enforced. No primary row is faster beyond noise; the run’s speed change for a player (below) is held back for your call. ' + facts['speed_line'] + ' ' + facts['ci'] + '</p>'
             '<p>It bundles a server change (SystemRandom ids, one server test), bench and lint changes with the client work; CLAUDE.md asks for one logical change per PR.</p>',
     'charts': [{'rows': {'change': FINAL, 'only': 'PRIMARY'}, 'caption': facts['final_caption']}],
     'recommend': 'Let me split it before merging: the server pair (26bae12, 3016c9b), the checks and lint (df8083c, 8a020e8, 1aa90ee, a446a69, c023ab5, ab48319, e5759d9, 8311a5b), and the client fixes (8b968ce, 924cb6f, 5317469, f6e8215) as three PRs. Or squash-merge as is, as the last runs were.'},
    {'title': 'The first-pick fix moves the warm-up’s cost rather than removing it: take it anyway? (reverted, patch kept)',
     'body': '<p>In software rendering the warm-up of the marks of play costs about 2 s of GPU time, and it lands on whatever the player does first after the entrance: on main, the first pick (about 2.4 s). '
             'W1b linked those programs under the entrance and read them back once the board rested. The first pick dropped to 0.8–1.05 s (called better in three A/Bs), but the second and third picks and the computer’s second reply each waited about 0.3 s more, '
             'and the primary “Selecting a piece” row (the median of 8 picks) leaned slower twice on the final code: +41% (0.95 1.58 1.43 1.85) and +37% (1.02 1.95 1.29), neither called. '
             'The run’s rule is never more than 3% slower, and CLAUDE.md calls buying one wait with another a trade-off, not a win, so I reverted it (20bb91f, 50bc357). It is in <code>bench/loop/patches/warm-under-entrance-W1b.patch</code>.</p>',
     'figure': {'html': table(['Pair', 'main: picks 1–3 (ms)', 'main: computer replies (ms)', 'W1b: picks 1–3', 'W1b: computer replies'], RAW),
                'caption': 'Raw first frames, W1b’s final form against main (computer + select, 4 pairs, ab-20261012-w1c.md): each pair’s first three picks, and each run’s three computer replies (two runs a pair).'},
     'charts': [{'rows': {'change': V3, 'only': PICK}, 'caption': 'W1b’s final form (e4ee30c) against main, select rows, 3 pairs: the first pick better, the median of 8 picks leaning slower.'}],
     'recommend': 'Not as it is. Next run: spread the 13 read-backs over idle moments (W3), so no single action pays for them; with that, W1b should take the first pick’s 1.6 s without moving it elsewhere. If the first pick matters more to you than picks 2–3, apply the patch as is.'},
    {'title': 'The join’s wait: fewer lobby frames while the board links? (design call)',
     'body': '<p>A CPU profile of a join shows the joiner’s long tasks are <code>getUniforms</code> read-backs inside render(), each waiting for the GPU to finish the lobby frames queued before it (0.66, 1.15, 0.53 s), plus 0.3 s creating the board’s WebGL context. Linking ahead (tried, rejected) moves links, not those waits. '
             'What would shorten them is drawing fewer lobby frames while the board’s canvas starts: the arrival’s ring and lift would step instead of glide in software.</p>',
     'figure': {'html': table(['From “Join game”', 'Long task', 'Where its time went (CPU profile, 0.5 ms samples)'], [
        ['+166 ms', '330 ms', 'React mounting the game screen (useMemo in the scene), garbage collection'],
        ['+497 ms', '664 ms', '90% <code>getUniforms</code> inside render(): a read-back waiting on the GPU'],
        ['+2,492 ms', '545 ms', '55% <code>getContext</code>: the board’s WebGL context created'],
        ['+4,849 ms', '1,145 ms', '98% <code>getUniforms</code> inside render()'],
        ['+6,724 ms', '531 ms', '99% <code>getUniforms</code> (linkAhead’s read-back)']]),
                'caption': 'One join on the branch’s build, SwiftShader, 1280×720 (bench/loop/tools/join-probe/run.mjs). The waits are the GPU finishing queued lobby frames, not links.'},
     'recommend': 'Let me try a lower frame rate for the lobby only while the board’s first frame is pending, behind a measurement of its frames; you judge the look.'},
  ]},
  'scoreboard': {'intro': facts['scoreboard_intro'], 'items': [
    {'title': 'The 1.2× target against the first recorded run is not met', 'body': '<p>' + facts['first_body'] + '</p>'},
    {'title': 'Rows that leaned slower without being called', 'body': facts['lean_body']},
    {'title': 'The final commit against main, primary rows', 'charts': [{'rows': {'change': FINAL, 'only': 'PRIMARY'}, 'caption': facts['final_caption']}]},
    {'title': 'The branch against the first recorded run (92ce041)', 'charts': [{'rows': {'change': FIRST, 'only': 'PRIMARY'}, 'caption': 'Branch against 92ce041, `--primary`, 3 pairs.'}]},
    {'title': 'With W1b, before its revert (3 pairs)', 'charts': [{'rows': {'change': V3, 'only': 'PRIMARY'}, 'caption': 'e4ee30c against main, `--primary`, 3 pairs.'}]},
  ]},
  'changed': {'items': [
    {'title': 'The warm-up draws its marks in one frame, not thirteen (924cb6f)',
     'body': '<p>Since the warm-up links every program ahead, drawing a warm object links nothing: each of the twelve frames after the first only drew the whole scene again, a frame of GPU time each in software, while the first pick of a game waited behind them. −11 lines. The first pick leaned faster in 7 of 8 pairs (−9% and −23%, not called); nothing else moved.</p>',
     'charts': [{'rows': {'change': WFS, 'only': PICK}, 'caption': 'The one-frame warm-up against main, select, 4 pairs.'}]},
    {'title': 'Three silent failures fixed',
     'body': '<ul><li>The computer stalled for ever, saying nothing, if its search chose a move the rules refuse (its board and the engine disagreeing). It now logs the move and plays on (8b968ce).</li>'
             '<li>A computer game that outgrew storage rewound to the last copy storage took on a remount or a reload; it now plays on from its latest move, and says so once in the console (5317469).</li>'
             '<li>Game ids, the whole credential for an open seat, came from Python’s Mersenne Twister; now from the system’s entropy (26bae12).</li></ul>'},
    {'title': 'Checks that could pass on broken code, and rules nothing enforced',
     'body': '<ul><li>The computer’s primary row timed a fixed node count: a search made weaker would read faster. It now pins depth, move and the nodes to finish that depth; removing the killer/history updates kept depth and move and now fails on nodes (12,099 → 17,999) (df8083c).</li>'
             '<li>The A/B never called a “longest task” row that goes 0 → N ms (a move that starts to hold the page); now it does, and only then (8a020e8, 1aa90ee after review).</li>'
             '<li>The server’s “replaced socket” test checked before the disconnect was processed (3016c9b); hudFit passed with nothing measured (e5759d9); the bench’s wait for a pick’s destinations never waited (8311a5b).</li>'
             '<li>Lint now stops a board set outside the engine, animation on the browser’s frames or the wall clock, and two ways round the schema and <code>__r3fState</code> rules (a446a69, c023ab5); the build fails if the tutorial’s or a computer game’s page lands in the start page’s bytes (ab48319). Each was planted and seen to fail.</li>'
             '<li>One table for the history’s keys, its titles and a new <code>aria-keyshortcuts</code> (f6e8215).</li></ul>'},
  ]},
  'removed': {'intro': facts['removed']},
  'rejected': {'items': [
    {'title': 'Linking the warm-up under the entrance (W1b, reverted; see Needs from me)',
     'body': '<p>The first pick 2.4 s → 0.8–1.05 s (called better three times), but the cost moved to the next picks and the computer’s second reply; selecting leaned +37–41% on the final code. A first version also made the joiner’s longest task +25% (called; it linked under the lobby’s arrival) and a second made the computer’s reply +114% (called; read-backs in the warm frame): both fixed before the revert.</p>',
     'charts': [{'rows': {'change': W1B, 'only': PICK + '|Game setup · joiner: longest'}, 'caption': 'First version against the one-frame warm-up, 4 pairs.'},
                {'rows': {'change': 'final v1: f6e8215 vs 889c13f (primary, 4 pairs)', 'only': 'Playing the computer · its move: shown'}, 'caption': 'Second version against main: the computer’s reply, 4 pairs.'}]},
    {'title': 'Linking the lobby’s later programs ahead (LW)',
     'body': '<p>Two lenses traced 1.75–2.27 s of the joiner’s long tasks to the lobby’s own links after “Join game”. Linked right after the lobby’s first frame, the links left the click → frame window (30 → 25, every pair) but the join’s first frame did not move (+0.4%). The profile shows why: the waits are read-backs behind queued frames, not links. +60 lines for a count; patch kept.</p>',
     'charts': [{'rows': {'change': LW2, 'only': 'Game setup · (join: click → joiner|joiner: long|joiner: shader)'}, 'caption': 'LW v2 against main, 4 pairs.'}]},
    {'title': 'Smaller', 'body': '<ul><li>React 19.3: +15.8 KB gz on react-dom, nothing a player waits on faster (measured on the tarballs by a reviewer).</li>'
             '<li>Replacing the bench’s <code>PIECE_PIXEL</code> with <code>squarePixel</code>: it rounds to whole pixels and re-casts, which the other does not.</li></ul>'},
  ]},
  'choices': {'intro': facts['choices']},
  'notConfirmed': {'intro': facts['not_confirmed']},
  'merge': {'intro': '<p>No other sessions were active. Nothing in CLAUDE.md or ARCHITECTURE.md needed changing for this diff (the warm-up’s draw schedule is described only in warm.tsx). Proposed for shared files, not installed:</p>'
                     '<ul><li><code>.claude/hooks/format.sh</code>: add <code>"$root"/client/scripts/*.mjs|"$root"/client/*.html|"$root"/bench/*.mjs</code> to its prettier case; the lint checks them and the hook does not format them (E8).</li>'
                     '<li><code>server/pyproject.toml</code>: add <code>pytest-timeout</code> (e.g. 30 s); a socket regression in the server tests hangs instead of failing (R8).</li>'
                     '<li>CLAUDE.md: a short North star (what the game is for, what it is not). This run, like the last five, used “Performance”, <code>bench/loop/</code> and the test suites in place of the loop prompt’s North star, Measurement, Reporting, Loop state and Tests sections.</li></ul>'},
  'next': {'intro': facts['next']},
}
(here / 'RUN-20261012-1644.report.json').write_text(json.dumps(report, ensure_ascii=False, indent=1))
print('written')
