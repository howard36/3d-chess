# Writes RUN-20261014-0357.report.json (the run report's words); tools/report.mjs
# draws the page from it and scoreboard.jsonl. Run: python3 RUN-20261014-0357.report.json.py
import base64, json, pathlib

here = pathlib.Path(__file__).parent
facts = json.loads((here / 'final-20261014-0357-facts.json').read_text())
STRIP = base64.b64encode((here / 'shots-20261014' / 'handover-strip.jpg').read_bytes()).decode()

AA = 'AA: b1709f5 vs itself (primary, 4 pairs)'
FP1 = 'FP v1 (lobby+game paced on a GPU fence) vs 9e5ca37 (setup+computer+move-latency+select, 5 pairs)'
FP2 = 'FP v2 (lobby+game paced on a GPU fence) vs 74c93b9, GPU-drawn rows (setup+computer+move-latency+select, 5 pairs)'
FPR = 'FP2 (rejected): preview+tutorial paced vs a7cf4a4 (cold-load, 5 pairs)'
FINAL = 'final: d5ed032 vs b1709f5 (primary, 4 pairs)'
FIRST = facts['first_change']
AIR = 'recheck: AI search speed, d5ed032 vs b1709f5 (client, 6 pairs)'

GPU = '(Move latency · (click → mover’s first frame with the move|opponent’s move: sent → first frame with it)|Selecting a piece · click → first frame with the piece held)'
WAYIN = '(Game setup · (join: click → joiner’s first frame|joiner: long tasks total|create: click → share link)|Playing the computer · way in)'


def table(head, rows):
    h = ''.join(f'<th>{c}</th>' for c in head)
    b = ''.join('<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>' for r in rows)
    return f'<table><thead><tr>{h}</tr></thead><tbody>{b}</tbody></table>'


report = {
  'title': 'Perf run 20261014-0357',
  'eyebrow': '3D chess · perf-iteration · run 20261014-0357',
  'heading': 'On a slow GPU a move now shows in under half a second, not over two',
  'meta': ('Base <code>b1709f5</code> (main) → branch <code>improve/20261014-0357</code>, '
           '<a href="https://github.com/howard36/3d-chess/pull/133">PR #133</a> · 2026-10-14 03:57–' + facts['end'] + 'Z · '
           'headless Chromium, SwiftShader (software WebGL), 4 vCPU · every timing is an interleaved A/B (base and branch run back to back in each pair); '
           'a change is <em>called</em> only when every pair agrees and it beats 5% and the pairs’ spread.'),
  'needs': {'items': [
    {'title': 'Review and merge PR #133',
     'body': '<p>One speed change: the game’s and the lobby’s canvases draw one frame at a time on the GPU. Also four fixes found in review, '
             'four silent fallbacks made visible, seven checks or rules now enforced, two phone and screen-reader fixes, security headers, '
             'and the bench made to time what the player sees. ' + facts['ci'] + '</p>'
             '<p><b>It breaks CLAUDE.md’s “one PR per session, scoped to one logical change”</b>: the run’s instructions asked for one branch and one PR, and it mixes the pacer with bench, lint, CI and small client fixes, as the last run did.</p>',
     'charts': [{'rows': {'change': FINAL, 'only': 'PRIMARY'}, 'caption': 'The branch tip (d5ed032) against main, primary rows, 4 pairs.'}],
     'recommend': 'Split it as you did last time: the pacer and its two review fixes (a7cf4a4, f8ab886) as one PR; the bench changes (d95a58b, 41e1557, 74c93b9, 0f99624, 4b93f7d’s bench part, d5ed032); the checks and lint (2286468, 6f8dffe, 37d4cc9); the small client fixes (7eed7fb, 14d81fe, 9134a11, 9e5ca37). Or squash-merge it as is.'},
    {'title': 'The pacer breaks the speed rule on one primary row: keep it, and time that row to the picture?',
     'body': '<p><b>The run’s rule is no scenario slower than main beyond noise, never more than 3%. The primary row “A move landing, the player’s” is 17% slower on the final commit, every pair (1.16 1.09 1.31 1.14; the A/A on identical code gave +0.6%).</b> I kept the pacer anyway, and this is yours to overrule. The primary rows “A move landing” and “Selecting a piece” stop when <code>render()</code> returns, the moment the frame is handed to the GPU. '
             'In software rendering the GPU then draws it for a long time. On main, the frame showing a move was drawn <b>2.3–2.4 s</b> after the move, while the row said 163–176 ms. '
             'The pacer hands a frame over only once the previous one is drawn, so the hand-over row reads later (the player’s move +17%, not called) while the picture comes <b>5× sooner</b>. '
             'This run added the GPU-drawn rows beside the old ones; <code>bench/primary.mjs</code> still names the old ones.</p>',
     'charts': [{'rows': {'change': FINAL, 'only': GPU}, 'caption': 'Both definitions on the final A/B, 4 pairs: the hand-over rows and the “drawn by the GPU” rows.'}],
     'recommend': 'Keep the pacer, and point the three primary rows at the “drawn by the GPU” rows (CLAUDE.md allows a moment “measured differently” in bench/primary.mjs). It breaks the series against older runs for those three rows, so the 1.2× target would need its first-run figure re-taken on them.'},
    {'title': 'The lobby and the entrance on a slow GPU: fewer pictures, on time',
     'body': '<p>Before, a GPU that drew three pictures a second also slowed the motion: each picture stepped the lobby’s clock by at most a quarter second, so the beats ran slow. '
             'Paced, the motion keeps its own time and the GPU draws what it can. The way into a game against the computer now ends after 8.8 s instead of 15.4 s, and joining a game shows the board after 1.6 s instead of 5.5 s. '
             'A real GPU that keeps up draws every frame as before. Recordings (the showcase’s stepped clock) draw every frame and match main frame for frame (top and bottom rows below; the middle row is the first version, before that rule).</p>',
     'figure': {'html': f'<img alt="The handover at 9.0 to 9.6 s: main, the first paced version with a dark frame at 9.4 s, and the kept version matching main" src="data:image/jpeg;base64,{STRIP}" style="width:100%;height:auto">',
                'caption': 'Showcase --lobby, the handover at 9.0, 9.2, 9.4, 9.6 s. Top: main. Middle: paced, before the stepped-clock rule (a dark frame at 9.4 s). Bottom: kept version.'},
     'charts': [{'rows': {'change': FINAL, 'only': WAYIN}, 'caption': 'The way in, final A/B against main, 4 pairs.'}],
     'recommend': 'Keep it. It changes how CLAUDE.md’s lobby rule plays out: the rule caps each step at LOBBY_MAX_STEP so a slow renderer still plays each beat in about its own time; paced, the beats keep their time more closely, with fewer pictures, and e2e’s waitForBoard (which waits on the whole handover) passes in CI. The look in real time on a slow GPU is not checked (recordings draw every frame), and two reviewer items stay open: DOM fades leading the paced picture (RV9) and the “useFrame ran, so it was drawn” audit (RV6). Try the preview build on your phone (improve-20261014-0357.3d-chess.pages.dev) and judge the arrival and the handover by eye: that is the one thing the bench cannot see.'},
    {'title': 'Two more rows leaned slower; one is now settled',
     'body': '<ul>'
             '<li><b>Start page answers its first click</b> +22% (1.80 1.29 1.04 0.92): nothing on that path changed (the preview is not paced; FP2, which paced it, moved nothing). The A/A on identical code leaned +31% on this row (chart: the A/A first, then the final).</li>'
             '<li><b>The computer’s search speed</b> +29% in the final A/B (1.57 1.06 1.12 1.48), on code the branch does not touch. Re-run with 6 pairs after grading: +5.5%, pairs both ways (0.89 1.00 1.08 0.92 1.46 1.06), not called. Noise.</li></ul>',
     'charts': [{'rows': {'change': AA, 'only': 'Cold load of the start screen · desktop · click at ready → side choice shown'}, 'caption': 'The A/A (identical code), 4 pairs: the first click.'},
                {'rows': {'change': FINAL, 'only': 'Cold load of the start screen · desktop · click at ready → side choice shown'}, 'caption': 'The final A/B, 4 pairs: the first click.'},
                {'rows': {'change': AIR, 'only': 'The computer thinks'}, 'caption': 'The search speed re-run, 6 pairs, client tier.'}],
     'recommend': 'Take the first click as noise and let the next run re-check it with 6 pairs; the search speed needs nothing.'},
    {'title': 'Calls the reviewers raised that are yours',
     'body': '<ul>'
             '<li>Anyone with a game’s link can take either seat (ARCHITECTURE.md lists it as a non-goal). A per-seat secret would close it.</li>'
             '<li>The socket accepts any Origin; the logs pair game ids with IPs.</li>'
             '<li>Copy: the “seat moved” notice explains its own button; the move box’s hint repeats its label; “tap a ring” shows to mouse players.</li>'
             '<li><code>viewport-fit=cover</code> (I3′) also needs the HUD’s left and bottom edges inset.</li></ul>',
     'figure': {'html': table(['Call', 'Where', 'Cost of fixing', 'What it prevents'], [
        ['Per-seat secret on rejoin', '<code>modal_app.py</code> find_seat, rejoin; ARCHITECTURE.md “Scope and trust”', 'schema change, client storage, server check', 'the opponent taking your seat with the link they already have'],
        ['Origin allowlist on the socket', '<code>modal_app.py:458</code>', 'a few lines; previews and localhost must be listed', 'other sites opening sockets from their visitors’ browsers'],
        ['Hash ids and drop IPs in logs', '<code>modal_app.py</code> log lines', 'a few lines', 'anyone with log access taking over live games'],
        ['Three copy cuts', 'GameScreen.tsx:368, MoveCard.tsx:146, LearnScreen.tsx:172', 'words and one test', 'explanations CLAUDE.md’s copy rules rule out'],
        ['HUD insets with viewport-fit=cover', 'index.css:421, 456, 701, 910', 'four max(…, env()) values', 'the pill and move box under a notch in landscape']]),
                'caption': 'The reviewers’ findings that are design or trust calls (ledger SEC1–3, I11, I12).'},
     'recommend': 'Leave the seat and origin as they are while games are among friends; I would take the three copy cuts.'},
    {'title': 'CLAUDE.md has no North star, Measurement, Reporting, Loop state or Tests section',
     'body': '<p>As in the last six runs, I used the nearest things the repo has in their place.</p>',
     'figure': {'html': table(['Missing section', 'Used instead'], [
        ['North star', 'ARCHITECTURE.md “Scope and trust assumptions”; CLAUDE.md “Performance” (what speed is for)'],
        ['Measurement', 'CLAUDE.md “Performance”: <code>bench/run.mjs --primary --base</code>, interleaved'],
        ['Reporting, Loop state, session log', '<code>bench/loop/</code> as earlier runs left it (ledger, scoreboard.jsonl, RUN-*.md, tools/report.mjs)'],
        ['Tests', 'the vitest, e2e and server suites; CLAUDE.md’s coverage gates']]),
                'caption': 'What each missing CLAUDE.md section was replaced with.'},
     'recommend': 'Add a short North star (what the game is for and not for) when convenient; the rest works as it is.'},
  ]},
  'scoreboard': {'intro': facts['scoreboard_intro'], 'items': [
    {'title': 'The final commit against main, primary rows', 'charts': [{'rows': {'change': FINAL, 'only': 'PRIMARY'}, 'caption': 'd5ed032 against b1709f5, 4 pairs.'}]},
    {'title': 'The 1.2× target against the first recorded run', 'body': '<p>' + facts['first_body'] + '</p>',
     'charts': [{'rows': {'change': FIRST, 'only': 'PRIMARY'}, 'caption': 'd5ed032 against 92ce041, 3 pairs.'}]},
    {'title': 'The noise band: identical code against itself', 'body': '<p>The run began with an A/A (4 pairs). It called the opponent’s move −49% on identical code: the frame with the move waits 14–290 ms behind frames the GPU already has queued, and the queue lined up differently on each side. That queue is what the pacer removes.</p>',
     'charts': [{'rows': {'change': AA, 'only': 'PRIMARY'}, 'caption': 'b1709f5 against itself, 4 pairs.'}]},
  ]},
  'changed': {'items': [
    {'title': 'The game’s and the lobby’s canvases draw one frame at a time on the GPU (a7cf4a4, f8ab886)',
     'body': '<p>Each canvas draws its own frames. If the GPU has not finished the previous one (a fence), the next is skipped and asked for again; the motion still steps every display frame. '
             'A lost context, a fence that never passes (60 frames at most) and the warm-up’s one frame are handled; each has a test that fails without it. 70 lines of app code (the pacer).</p>',
     'charts': [{'rows': {'change': FP2, 'only': GPU + '|' + WAYIN}, 'caption': 'The pacer against the commit before it, 5 pairs (v2, with the GPU-drawn rows).'}]},
    {'title': 'The bench times what the player sees (74c93b9, 0f99624, d5ed032, d95a58b, 41e1557)',
     'body': '<ul><li>Each frame now records when the GPU finished it; the move and selection sections report those times beside the hand-over times.</li>'
             '<li>The orbit helper turned until its time was up, so the angle depended on the frame rate; it now turns exactly its angle.</li>'
             '<li>The A/B verdict dropped a pair at 0 from its agreement check, so it could call a row against one pair’s direction; the rule is now in <code>bench/verdict.mjs</code> with a test.</li>'
             '<li><code>run.mjs</code> ran something else on a typo’d flag or tier, overwrote RESULTS.md and exited 0; it now refuses (exit 2).</li>'
             '<li>The computer section records blank cells no more: it fails when no worker started or a move had no search.</li></ul>'},
    {'title': 'Silent fallbacks now say so (7eed7fb, 4b93f7d)',
     'body': '<ul><li>The computer’s search answering “no move” where the rules have one now logs, as a refused move already did.</li>'
             '<li>A stored computer game that cannot be read (the only copy) now says why in the console.</li>'
             '<li><code>linkAhead</code> reports how it ended, and the select section shows it beside the first pick.</li></ul>'},
    {'title': 'Checks that could pass on broken code, and rules nothing enforced (2286468, 6f8dffe, 37d4cc9)',
     'body': '<ul><li>The computer e2e tests passed with the search broken; they now fail on any fallback, page error or frame sent to the server (a planted broken search fails them).</li>'
             '<li>The chunk-failure test passed before the chunk was even asked for; it now waits for the failure.</li>'
             '<li>Lint now catches <code>globalThis.</code>/<code>self.</code> timers, <code>requestIdleCallback</code>, <code>new Date()</code>, any mention of <code>__r3fState</code> outside the game canvas, and pointer handlers in <code>three/scene</code> (six planted escapes fail).</li>'
             '<li>CI’s <code>uv sync --locked</code> fails a lock that no longer matches pyproject (checked on a copy).</li></ul>'},
    {'title': 'Phone, screen reader and headers (14d81fe, 9134a11, 9e5ca37)',
     'body': '<ul><li>Upright on a phone, the open move list covers the tower’s lower levels; a press elsewhere or Escape now closes it, as the game menu does.</li>'
             '<li>The tutorial’s words are a live region, so a screen reader hears each step while focus stays on Next.</li>'
             '<li><code>public/_headers</code>: no framing by other sites, nosniff, a referrer that names only the site.</li></ul>'},
  ]},
  'removed': {'intro': facts['removed']},
  'rejected': {'items': [
    {'title': 'Pacing the start page’s preview and the tutorial too (FP2)',
     'body': '<p>Cold-load A/B, 5 pairs: ×1.002, nothing called (desktop −0.7%, phone +0.4%, first click +2.6%). The tutorial has no row. Reverted; patch in <code>bench/loop/patches/pace-preview-and-tutorial-FP2.patch</code>.</p>',
     'charts': [{'rows': {'change': FPR, 'only': 'PRIMARY'}, 'caption': 'FP2 against the pacer commit, cold-load, 5 pairs.'}]},
    {'title': 'Dropping the review line when review ends (M5)', 'body': '<p>Rejected on reading: it saves 1.3 MB only at 2,000 plies, and every later step back would replay the whole record again.</p>'},
    {'title': 'The first measurement of the pacer (v1)', 'body': '<p>It found two faults in the bench rather than the app: the select section failed on every branch run (the orbit’s frame-rate-dependent angle hid Ab1), and the move row read +26% because it stops at the hand-over. Both bench faults are fixed; the numbers above are from v2 and the final A/B.</p>',
     'charts': [{'rows': {'change': FP1, 'only': 'PRIMARY'}, 'caption': 'v1 against 9e5ca37, 5 pairs (the select rows missing on the branch side).'}]},
  ]},
  'choices': {'intro': facts['choices']},
  'notConfirmed': {'intro': facts['not_confirmed']},
  'merge': {'intro': '<p>No other sessions were active, and <code>main</code> did not move during the run. ARCHITECTURE.md now describes the pacer and the headers; CLAUDE.md is unchanged. Proposed, not made: in CLAUDE.md’s “Performance”, a line saying the move and selection rows time the hand-over and the “drawn by the GPU” rows time the picture.</p>'},
  'next': {'intro': facts['next']},
}
(here / 'RUN-20261014-0357.report.json').write_text(json.dumps(report, ensure_ascii=False, indent=1))
print('written')
