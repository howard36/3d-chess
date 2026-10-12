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
     'body': '<p>One speed fix a player feels: <strong>the first piece picked up after a game’s entrance no longer waits seconds</strong> for the warm-up of the marks of play. '
             'Also: the warm-up in one frame, three correctness fixes (a computer that could stall for ever, a computer game that rewound after its storage filled, guessable game ids), '
             'and seven checks that could pass on broken code, or rules nothing enforced, now enforced. ' + facts['speed_line'] + ' ' + facts['ci'] + '</p>'
             '<p>Like the last runs it bundles a server change (SystemRandom ids, one server test) and bench/lint changes with the client work; CLAUDE.md asks for one change per PR.</p>',
     'charts': [{'rows': {'change': FINAL, 'only': 'PRIMARY'}, 'caption': 'The primary rows, branch against main, `--primary`, 4 pairs.'}],
     'recommend': 'Squash-merge once CI is green. If you want the one-change rule applied strictly, I split out 26bae12 + 3016c9b (server) first.'},
    {'title': 'Keep the first-pick fix? It moves the warm-up’s cost, it does not remove it',
     'body': '<p>In software rendering the warm-up of the marks of play costs about 2 s of GPU time, and it lands on whatever the player does first after the entrance. '
             'On main that is the first pick (about 2.4 s). This branch links the programs under the entrance and reads them back once the board rests: the first pick drops to about 0.8 s, '
             'but the second and third picks and the computer’s second reply each wait about 0.3 s more. Net, the player waits about 0.8 s less over the first few actions; '
             'nothing is called worse on the final code (the computer’s reply +46% and selecting +41% lean worse, not called; an earlier version made the reply +114%, called, and was fixed). '
             'On a real GPU these links take milliseconds and none of this shows. No row times the entrance’s smoothness (T16).</p>',
     'figure': {'html': table(['Pair', 'main: picks 1–3 (ms)', 'main: computer replies (ms)', 'branch: picks 1–3', 'branch: computer replies'], RAW),
                'caption': 'Raw first frames from the final code’s A/B (computer + select, 4 pairs, ab-20261012-w1c.md): each pair’s first three picks, and each run’s three computer replies (two runs a pair).'},
     'charts': [{'rows': {'change': W1C, 'only': PICK + '|Playing the computer · (its move: shown|way in)'}, 'caption': 'Final code against main, computer + select, 4 pairs.'}],
     'recommend': 'Keep it: the first pick was the one wait of seconds, and the rest are fractions. If you prefer the cost all in one place, revert 0fe7a3c + e4ee30c and keep the one-frame warm-up (924cb6f). Next run: spread the read-backs over idle moments (W3).'},
    {'title': 'Say so on screen when a computer game can no longer be saved?',
     'body': '<p>Once a long computer game outgrows the browser’s storage, its moves are kept for this visit only (fixed this run: they no longer rewind). A reload loses them. Today the only sign is a console warning.</p>',
     'recommend': 'Yes, one short line in the HUD’s existing notice style (“This game can’t be saved here”). It is new interface copy, so it is your call (ledger R5).'},
    {'title': 'The target is not met against the first recorded run',
     'body': '<p>' + facts['first_body'] + '</p>',
     'charts': [{'rows': {'change': FIRST, 'only': 'PRIMARY'}, 'caption': 'This branch against the first recorded run (92ce041), `--primary`, 3 pairs (the computer rows did not exist then).'}],
     'recommend': 'Next run, the join (J3): its 5.4 s is three.js reading uniforms back behind SwiftShader’s queue of lobby frames. That needs a design decision about how many lobby frames to draw while the game’s board links (below).'},
    {'title': 'The join’s wait: fewer lobby frames while the board links? (design call)',
     'body': '<p>A CPU profile of a join shows the joiner’s long tasks are <code>getUniforms</code> read-backs inside render(), each waiting for the GPU to finish the lobby frames queued before it (0.66, 1.15, 0.53 s), plus 0.3 s creating the board’s WebGL context. Linking ahead (tried, rejected) moves links, not those waits. '
             'What would shorten them is drawing fewer lobby frames while the board’s canvas starts: the arrival’s ring and lift would step instead of glide in software.</p>',
     'recommend': 'Let me try a lower frame rate for the lobby only while the board’s first frame is pending, behind a measurement of its frames; you judge the look.'},
    {'title': 'Proposed, not installed: two small things in shared machinery',
     'body': '<ul><li><code>.claude/hooks/format.sh</code> formats only some of what the lint checks: <code>client/scripts/*.mjs</code>, <code>client/*.html</code>, <code>bench/*.mjs</code> (E8).</li>'
             '<li>Add <code>pytest-timeout</code>: a socket regression in the server tests hangs instead of failing (R8).</li></ul>',
     'recommend': 'Both one-liners; your call since other sessions share them.'},
    {'title': 'CLAUDE.md still has no North star, Measurement, Reporting, Loop state or Tests section',
     'body': '<p>As in the last five runs I used “Performance”, <code>bench/loop/</code> and the vitest + e2e suites.</p>',
     'recommend': 'Add a short North star (what the game is for, what it is not).'},
  ]},
  'scoreboard': {'intro': facts['scoreboard_intro'], 'items': [
    {'title': 'The branch against main, primary rows (4 pairs)', 'charts': [{'rows': {'change': FINAL, 'only': 'PRIMARY'}, 'caption': 'Branch against main 889c13f, `--primary`, 4 pairs.'}]},
    {'title': 'The branch against the first recorded run (92ce041)', 'charts': [{'rows': {'change': FIRST, 'only': 'PRIMARY'}, 'caption': 'Branch against 92ce041, `--primary`, 3 pairs.'}]},
    {'title': 'The final code, computer and select sections (4 pairs)', 'body': '<p>The final A/B ran on f6e8215; one fix followed (e4ee30c, the warm-up’s read-backs), rechecked here on the sections it touches.</p>', 'charts': [{'rows': {'change': W1C, 'only': PICK + '|Playing the computer'}, 'caption': 'e4ee30c against main, computer + select, 4 pairs.'}]},
  ]},
  'changed': {'items': [
    {'title': 'The first pick after the entrance: about 2.4 s → about 0.8 s (924cb6f, 0fe7a3c, e4ee30c)',
     'body': '<p>The warm-up linked its 13 programs only once the entrance was over; the first pick’s frame then blocked 1.1–2.0 s reading a program back behind those links (seen in the raw data on both sides). Now they link under the entrance, are read back once the board rests, and are drawn in one frame instead of thirteen. The trade-off is in Needs from me.</p>',
     'charts': [{'rows': {'change': W1C, 'only': PICK}, 'caption': 'The final code against main, 4 pairs.'},
                {'rows': {'change': W1B, 'only': PICK}, 'caption': 'Links under the entrance (first version), against the one-frame warm-up (924cb6f), 4 pairs.'},
                {'rows': {'change': WFS, 'only': PICK}, 'caption': 'The one-frame warm-up against main, 4 pairs.'}]},
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
    {'title': 'Linking the lobby’s later programs ahead (LW)',
     'body': '<p>Two lenses traced 1.75–2.27 s of the joiner’s long tasks to the lobby’s own links after “Join game”. Linked right after the lobby’s first frame, the links left the click → frame window (30 → 25, every pair) but the join’s first frame did not move (+0.4%). The profile shows why: the waits are read-backs behind queued frames, not links. +60 lines for a count; patch kept.</p>',
     'charts': [{'rows': {'change': LW2, 'only': 'Game setup · (join: click → joiner|joiner: long|joiner: shader)'}, 'caption': 'LW v2 against main, 4 pairs.'}]},
    {'title': 'Smaller', 'body': '<ul><li>React 19.3: +15.8 KB gz on react-dom, nothing a player waits on faster (measured on the tarballs by a reviewer).</li>'
             '<li>Replacing the bench’s <code>PIECE_PIXEL</code> with <code>squarePixel</code>: it rounds to whole pixels and re-casts, which the other does not.</li></ul>'},
  ]},
  'choices': {'intro': facts['choices']},
  'notConfirmed': {'intro': facts['not_confirmed']},
  'merge': {'intro': '<p>No other sessions were active. Nothing in CLAUDE.md or ARCHITECTURE.md needed changing for this diff (the warm-up’s draw schedule is described only in warm.tsx).</p>'},
  'next': {'intro': facts['next']},
}
(here / 'RUN-20261012-1644.report.json').write_text(json.dumps(report, ensure_ascii=False, indent=1))
print('written')
