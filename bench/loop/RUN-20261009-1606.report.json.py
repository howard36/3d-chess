# Writes RUN-20261009-1606.report.json (the run report's words); tools/report.mjs
# draws the page from it and scoreboard.jsonl. Run: python3 RUN-20261009-1606.report.json.py
import json, pathlib

FINAL = 'final on #116: branch vs #116'
RECHECK = 'recheck on #116: cold-load + select, 4 pairs'
BISECT1 = 'bisect B2: 454bd45 vs c862f83 (#114 alone)'
BISECT2 = 'bisect B2: c862f83 vs 89e9cd9 (#100, #111, #112)'
REGRESS = 'regression check: 454bd45 vs 89e9cd9'
here = pathlib.Path(__file__).parent
facts = json.loads((here / 'final-20261009-1606-facts.json').read_text())

def table(head, rows):
    h = ''.join(f'<th>{c}</th>' for c in head)
    b = ''.join('<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>' for r in rows)
    return f'<table><thead><tr>{h}</tr></thead><tbody>{b}</tbody></table>'

report = {
  'title': 'Perf run 20261009-1606',
  'eyebrow': '3D chess · perf-iteration · run 20261009-1606',
  'heading': facts['heading'],
  'meta': ('Base <code>454bd45</code> (main) → branch <code>improve/20261009-1606</code>, PR '
           '<a href="https://github.com/howard36/3d-chess/pull/117">howard36/3d-chess#117</a> · '
           '2026-10-09 16:06–' + facts['end'] + 'Z · headless Chromium 141, SwiftShader, 4 vCPU · '
           'every timing is an interleaved A/B (each pair base and head run back to back); '
           'a change is <em>called</em> only when every pair agrees and it beats 5% and the pairs’ spread.'),
  'needs': {'items': [
    {'title': 'PR #118: deploy with <code>--strategy recreate</code>, your call',
     'body': '<p>Modal’s default rolling deploy lets the old container keep its WebSockets (up to the function’s hour) while new '
             'sockets go to the new one. The server keeps its connections in its process, so after a merge a game whose player '
             'reconnects (a phone waking, a reload) can sit on two containers: moves are recorded in the shared Dict but never '
             'relayed, and two event loops write one record. <code>recreate</code> stops the old container as the new one '
             'goes live; every live game then sees one reconnect per deploy. Checked in modal 1.6.1’s source, not run against '
             'Modal from here. It was in this PR; split out (PR #118, not merged) because it changes what players see.</p>',
     'figure': {'html': table(['On a deploy', 'rolling (main)', 'recreate (this PR)'], [
        ['Old container', 'keeps its sockets up to 1 h', 'stopped (waits ≤ 40 s)'],
        ['A player who reconnects', 'reaches the new container', 'reaches the new container'],
        ['Their opponent', 'may stay on the old one: no relayed moves, shown offline', 'reconnects too: same container'],
        ['What players see', 'nothing, until a move goes missing', 'one “Reconnecting” per deploy'],
      ]), 'caption': 'What each strategy does to live games (modal/runner.py, cli/run.py in modal 1.6.1).'},
     'recommend': 'Merge #118: one “Reconnecting” per deploy is cheaper than a game whose moves silently stop arriving.'},
    {'title': 'The creator’s wait for the share link grew 22% since the last run',
     'body': '<p>Against the last run’s measured head (89e9cd9), “create: click → share link shown” went 1.63 → 1.93 s, slower in every '
             'pair (not a primary row). Between them: #100 link previews, #111 server packages, #112 toolchain, #114 three r186. '
             'Bisected with #116’s harness: #114 alone does not move it (1.73 → 1.60 s, not called) and makes the joiner’s first frame 15% faster (called). '
             + facts['b2'] + '</p>',
     'charts': [{'rows': {'change': REGRESS, 'only': 'Game setup · (create: click → share link shown|join: navigation → Join button|join: click → joiner’s first frame|join: click → creator’s first frame)'},
                 'caption': 'Main (454bd45) against the last run’s head (89e9cd9), each on its own packages, 3 pairs, the old harness.'},
                {'rows': {'change': BISECT1, 'only': 'Game setup · (create: click → share link shown|join: navigation → Join button|join: click → joiner’s first frame)'},
                 'caption': 'Bisect step 1: #114 alone (454bd45 against c862f83), #116’s harness, 4 pairs.'}] + facts.get('b2_chart', []),
     'recommend': facts['b2_recommend']},
    {'title': 'Records may expire after 7 days, not 30',
     'body': '<p>ARCHITECTURE.md and modal_app.py say game records expire after ~30 days of inactivity. The installed modal 1.6.1 says '
             'a Dict entry expires after 7 days of inactivity, except in Dicts created before 2025-05-20. Which applies depends '
             'on when <code>3d-chess-games</code> was made, which needs Modal credentials this session lacks.</p>',
     'figure': {'html': table(['Source', 'What it says'], [
        ['ARCHITECTURE.md:75', 'records expire after ~30 days of inactivity'],
        ['server/modal_app.py:659', 'the same, ~30 days'],
        ['modal 1.6.1, <code>modal/dict.py</code> docstring', '“An individual Dict entry will expire after 7 days of inactivity”, except Dicts created before 2025-05-20 (30 days after the last write, being sunset)'],
      ]), 'caption': 'The two claims side by side; which applies depends on the Dict’s creation date.'},
     'recommend': 'Run <code>modal dict list</code> and tell me the creation date; the docs (and maybe the invitation’s promise) follow from it.'},
    {'title': 'CLAUDE.md still has no North star, Measurement, Reporting, Loop state or Tests section',
     'body': '<p>The prompt relies on them; as in the last three runs I used the nearest: “Performance”, <code>bench/loop/</code>, the vitest and e2e suites.</p>',
     'figure': {'html': table(['The prompt relies on', 'Used instead'], [
        ['North star (and “What it is not”)', 'CLAUDE.md “Performance” and ARCHITECTURE.md “Scope and trust assumptions”'],
        ['Measurement', 'CLAUDE.md “Performance”, bench/primary.mjs (#116)'],
        ['Reporting, Loop state', '<code>bench/loop/</code> as the last runs left it'],
        ['Tests', 'the vitest and e2e suites, CI'],
        ['Session log', 'a section at the end of each run record'],
      ]), 'caption': 'Missing sections and the nearest thing the repo has.'},
     'recommend': 'Add a short North star (what the game is for, what it is not) so the reviewers can rule ideas out by it.'},
  ]},
  'scoreboard': {
    'intro': facts['scoreboard_intro'],
    'items': [
      {'title': 'This run on #116’s suite: the branch against #116',
       'charts': [{'rows': {'change': FINAL, 'only': 'PRIMARY'}, 'caption': 'The primary rows (bench/primary.mjs), branch against #116’s head, `--primary`, 3 pairs.'}]},
      {'title': 'The two rows that leaned worse, again: 4 more pairs',
       'charts': [{'rows': {'change': RECHECK, 'only': 'PRIMARY'}, 'caption': 'Cold load and selection only, branch against main with #116, 4 pairs.'}]},
      {'title': 'Since the last run: main against the last run’s head',
       'charts': [{'rows': {'change': REGRESS, 'only': 'Cold load of the start screen · (desktop|phone, 4× CPU, Fast 4G) · create button enabled|Game setup · join: navigation → Join button|Reopening a long game · navigation → record shown.*2000|Move latency through the move box · Enter → (mover|opponent)’s first frame with the move|Selecting a piece · click → first frame with the piece held|Game setup · join: click → joiner’s first frame'}, 'caption': 'Main 454bd45 against 89e9cd9 (the toolchain, three r186 and server upgrades between), the last run’s primary rows, 3 pairs, each side on its own packages.'}]},
    ]},
  'changed': {'items': [
    {'title': 'Without WebGL the app works (9e45471)',
     'body': '<p>The four canvases’ boundaries now also leave the scene out when the browser gives no WebGL context, by the path a '
             'failed chunk already took. A game says so in one line and keeps the move box in sight; the computer answers typed moves.</p>',
     'figure': {'html': '<div style="display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))">'
                        '<figure style="margin:0"><img alt="Main without WebGL: Something went wrong" src="' + facts['img_nowebgl_base'] + '"><figcaption>Main, <code>/</code></figcaption></figure>'
                        '<figure style="margin:0"><img alt="The branch without WebGL: a game against the computer, move box in sight" src="' + facts['img_nowebgl_head'] + '"><figcaption>Branch, a computer game</figcaption></figure></div>',
                'caption': 'Chromium with --disable-webgl --disable-3d-apis against a build (bench/loop/tools/nowebgl.mjs).'}},
    {'title': 'A tutorial step links no shader program (4d9d855)',
     'body': '<p>Each step remounts the board; its glass, rims, glaze and label sprites were disposed, so three.js dropped their programs '
             'and the next frame linked them again. They are retired now, as the marks of play are.</p>',
     'figure': {'html': table(['Step', 'Main: programs · long tasks', 'Branch'], [
        ['Bishop → Black (7 steps × 4 runs)', '4 · median 342 ms (263–563)', '0 · none'],
      ]), 'caption': 'bench/loop/probe-20261009-learn-links.md: builds served by vite preview, alternated 4 runs a side, SwiftShader.'}},
    {'title': 'Dark from the first paint (2df6d01)',
     'body': '<p>With scripts blocked, the start page’s body was transparent (a white page) on main and gray-900 on the branch: '
             'a phone on a slow network no longer flashes white before the app runs.</p>'},
    {'title': 'Checks for rules that were only written down (c011de5, e8865d5, 4d9d855, 9e45471)',
     'body': '<ul><li>Lint: only GameCanvas publishes <code>__r3fState</code>; no <code>schema.ts</code> imports; no timers in <code>src/three</code>.</li>'
             '<li>Build: the tutorial’s and the computer game’s pages stay free of three.js, and the search stays out of the entry.</li>'
             '<li>Server: the store’s whole concurrency argument (AST walk, every store function listed and synchronous, no <code>.aio</code>).</li>'
             '<li>e2e: no relink on tutorial steps; the app without WebGL.</li></ul>'
             '<p>Each was mutation-tested: the rule fails on a planted violation.</p>'},
    {'title': 'Benches that say what they measured (92d7d73, 967c219, 355236d, ff01097)',
     'body': '<ul><li>An A/B across a dependency bump now installs the base’s own packages (it timed the head’s on both sides).</li>'
             '<li>A row missing on a side, or from some pairs, is shown and counted, not filed as “unchanged”.</li>'
             '<li>A pick is timed from the page’s own click; a click that picks nothing up (1 run in 5) is counted, not timed.</li></ul>'},
  ]},
  'removed': {'intro': '<ul><li>' + facts['removed'] + '</li></ul>'},
  'rejected': {'items': [
    {'title': 'Hard’s search: skip a pass predicted not to finish (A1)',
     'body': '<p>A pass the clock stops is thrown away, and the player waits for it. Predicting the next pass from the growth of the last two '
             'cut the median wait from 1466 to 1151 ms a move, but searched shallower in 11 of 40 positions (3 moves differed): the growth '
             'swings between ×1.5 and ×10. A ×2 floor kept the depth and saved nothing (1543 → 1514 ms). <code>bench/loop/probe-20261009-ai-iterations.md</code>.</p>'},
  ]},
  'choices': {'intro': '<ul>'
     '<li>Opened the deploy strategy change as its own PR (#118) and left it unmerged: the grader found it bundled into this one, a production change I had decided alone.</li>'
     '<li>Showed the move box whenever the board is missing (also on a failed chunk), with its hint’s “Esc to hide” dropped then.</li>'
     '<li>The diff review used three reviewers (client; bench, server and CI; invariants and every lens together) instead of one per lens, to stay inside the budget. None found a merge blocker; their smaller findings are fixed.</li>'
     '<li>Rebuilt my unpushed branch once to split a change staged into the wrong commit (tree unchanged).</li>'
     '<li>Did not pursue Tailwind’s removal, Activity keep-alive, the import map or the worker spawn: logged in the ledger.</li></ul>'},
  'notConfirmed': {'intro': '<ul>'
     '<li>' + facts['b2_notconfirmed'] + '</li>'
     '<li>The deploy strategy against Modal itself (read in the CLI’s source only).</li>'
     '<li>A fresh A/B against the first recorded run (92ce041): the bench’s setup and move rows changed definition last run (the long game), so that series cannot be extended; this run’s app changes do not touch the primary rows’ code paths.</li>'
     '<li>The start page’s demo relinking each pass (a reviewer’s claim): no relink was seen in 90 s on either side.</li>'
     '<li>Real phones and real GPUs: everything here is SwiftShader in headless Chromium.</li></ul>'},
  'merge': {'intro': '<p>' + facts['merged'] + '</p><p>No other sessions were active. This PR edits CLAUDE.md (two sentences) and ARCHITECTURE.md; a parallel PR touching the same lines would need a merge.</p>'},
  'next': {'intro': '<ol>'
     '<li>W1: a pick in the first seconds after the entrance waits 2–3 s on the warm-up’s links (every select run’s first pick: 3.2–4.7 s; after the warm-up, 0.1–0.4 s). Bench: a “first pick” row and wait for <code>data-warm</code> elsewhere (F5); app: make the selection’s programs ready first.</li>'
     '<li>Q1: make #116’s “start page answers its first click” row stable (it lands ~15 ms or ~3.4 s by a race with the preview’s build), or leave it out of the one-number speed.</li>'
     '<li>Why a select click sometimes picks nothing up (1 run in 5).</li>'
     '<li>N1: keep a game alive while its tutorial is open (React 19.2 Activity, r3f 9.8).</li>'
     '<li>N5/R6: Tailwind’s false-positive utilities (≈2.3 KB gz of the blocking CSS).</li></ol>'},
}
(here / 'RUN-20261009-1606.report.json').write_text(json.dumps(report, indent=1, ensure_ascii=False))
print('ok')
