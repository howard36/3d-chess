# Writes RUN-20261014-0357.report.json (the run report's words); tools/report.mjs
# draws the page from it and scoreboard.jsonl. Run: python3 RUN-20261014-0357.report.json.py
import base64, json, pathlib

here = pathlib.Path(__file__).parent
STRIP = base64.b64encode((here / 'shots-20261014' / 'handover-strip.jpg').read_bytes()).decode()

# Scoreboard rows, by the `change` key each A/B was recorded under
AA = 'AA: b1709f5 vs itself (primary, 4 pairs)'
FP1 = 'FP v1 (lobby+game paced on a GPU fence) vs 9e5ca37 (setup+computer+move-latency+select, 5 pairs)'
FP2 = 'FP v2 (lobby+game paced on a GPU fence) vs 74c93b9, GPU-drawn rows (setup+computer+move-latency+select, 5 pairs)'
FPR = 'FP2 (rejected): preview+tutorial paced vs a7cf4a4 (cold-load, 5 pairs)'
FINAL = 'final: d5ed032 vs b1709f5 (primary, 4 pairs)'
FIRST = 'vs first run: d5ed032 vs 92ce041 (primary, 3 pairs)'
AIR = 'recheck: AI search speed, d5ed032 vs b1709f5 (client, 6 pairs)'

GPU = '(Move latency · (click → mover’s first frame with the move|opponent’s move: sent → first frame with it)|Selecting a piece · click → first frame with the piece held)'
WAYIN = '(Game setup · (join: click → joiner’s first frame|joiner: long tasks total|create: click → share link)|Playing the computer · way in)'
CLICK = 'Cold load of the start screen · desktop · click at ready → side choice shown'


def table(head, rows):
    h = ''.join(f'<th>{c}</th>' for c in head)
    b = ''.join('<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>' for r in rows)
    return f'<table><thead><tr>{h}</tr></thead><tbody>{b}</tbody></table>'


report = {
  'title': 'Perf run 20261014-0357',
  'eyebrow': '3D chess · perf-iteration · run 20261014-0357',
  'heading': 'On a slow GPU, a move now appears in under half a second instead of over two',
  'meta': (
    '<p>This run changed how the game’s board and the lobby send pictures to the GPU. On the bench’s software renderer, '
    'a move now appears about five times sooner, and joining a game shows the board in 1.6 s instead of 5.5 s. '
    'One headline measurement got 17% worse because of how it is timed, and that needs your decision. '
    'The changes are in <a href="https://github.com/howard36/3d-chess/pull/133">PR #133</a>; CI passes.</p>'
    '<p class="small">Run 2026-10-14, 03:57–07:15 UTC. Main at <code>b1709f5</code>, branch <code>improve/20261014-0357</code>. '
    'Measured in headless Chromium with SwiftShader (WebGL drawn on the CPU) on 4 CPUs. '
    'Every comparison is an A/B: the bench runs main and the branch back to back several times, and each back-to-back run is a <em>pair</em>. '
    'A change is <em>called</em> only when every pair moves the same way, by more than 5% and by more than the pairs disagree with each other.</p>'),

  'needs': {'items': [
    {'title': 'Decide whether to keep the pacer, which makes one headline measurement 17% worse',
     'body':
       '<p>The run’s rule is that nothing may get slower than main beyond measured noise, and never by more than 3%. '
       'The headline measurement “A move landing, the player’s” is 17% slower on the branch, in every pair (1.16, 1.09, 1.31, 1.14). '
       'Two copies of identical code measured against each other gave +0.6% for the same measurement, so this is not noise. I kept the change anyway, and you can overrule that.</p>'
       '<p>The change, called the pacer below, makes the game’s and the lobby’s canvases send a new picture to the GPU only after the GPU has finished the previous one. '
       'Before, a slow GPU received a new picture every display frame and fell further and further behind. '
       'The headline measurement stops the clock when a picture is handed to the GPU, not when the GPU has drawn it. '
       'With the pacer, the hand-over waits for the previous picture, so it happens later. The picture itself is finished about five times sooner:</p>',
     'figure': {'html': table(['Moment', 'Main', 'Branch'], [
        ['Player’s move: picture handed to the GPU', '176\u00a0ms', '199\u00a0ms'],
        ['Player’s move: picture drawn by the GPU', '2.43\u00a0s', '469\u00a0ms'],
        ['Opponent’s move: picture drawn by the GPU', '2.30\u00a0s', '414\u00a0ms'],
        ['Selecting a piece: picture drawn by the GPU', '3.02\u00a0s', '349\u00a0ms']]),
                'caption': 'Final A/B, branch d5ed032 against main, medians of 4 pairs. The three “drawn by the GPU” rows are called better in every pair.'},
     'charts': [{'rows': {'change': FINAL, 'only': GPU}, 'caption': 'The same measurements, pair by pair. Each pair of rows is one moment timed both ways.'}],
     'recommend': 'Keep the pacer. Then change bench/primary.mjs so that the three move and selection headline measurements use the “drawn by the GPU” times, which CLAUDE.md allows for a moment measured differently. Those three rows can then no longer be compared with older runs.'},

    {'title': 'Check how the lobby and the game’s entrance look on your phone',
     'body':
       '<p>With the pacer, the lobby’s motion keeps its real timing and a slow GPU draws fewer pictures of it. '
       'Before, a slow GPU also slowed the motion down. That is why the way into a game against the computer now takes 8.8 s instead of 15.4 s. '
       'On a GPU that keeps up, nothing changes: it draws every picture as before.</p>'
       '<p>The bench can measure the timing but not the look. Recordings made with the showcase script are also no guide, because they step time frame by frame and the pacer then draws every frame. '
       'In those recordings the branch matches main frame for frame.</p>',
     'figure': {'html': f'<img alt="The handover at 9.0, 9.2, 9.4 and 9.6 seconds: main on top, the first paced version in the middle with a dark frame at 9.4 seconds, and the kept version at the bottom, matching main" src="data:image/jpeg;base64,{STRIP}" style="width:100%;height:auto">',
                'caption': 'The handover from lobby to game at 9.0, 9.2, 9.4 and 9.6 s, from the showcase recording. Top: main. Middle: the first paced version, with a dark frame at 9.4 s. Bottom: the kept version, which matches main.'},
     'charts': [{'rows': {'change': FINAL, 'only': WAYIN}, 'caption': 'The way into a game, final A/B against main, 4 pairs.'}],
     'recommend': 'Open the branch preview (improve-20261014-0357.3d-chess.pages.dev) on your phone and watch the computer’s arrival and the handover to the board. If they look wrong, tell me what you see.'},

    {'title': 'Review PR #133, preferably split into four',
     'body':
       '<p>The PR holds the pacer, four fixes to it found in review, bench changes that make it time what the player sees, new checks, and small client fixes. '
       'That breaks CLAUDE.md’s rule of one logical change per PR. The run’s instructions asked for one branch and one PR. '
       'CI passed on <code>ea4f812</code>: client, server tests and all three e2e shards.</p>',
     'figure': {'html': table(['Part', 'Commits'], [
        ['The pacer', 'a7cf4a4, f8ab886'],
        ['Bench', 'd95a58b, 41e1557, 74c93b9, 0f99624, d5ed032, and the bench half of 4b93f7d'],
        ['Checks, lint and CI', '2286468, 6f8dffe, 37d4cc9'],
        ['Small client fixes', '7eed7fb, 14d81fe, 9134a11, 9e5ca37, and the client half of 4b93f7d']]),
                'caption': 'A split along the four kinds of change.'},
     'recommend': 'Split it this way, as you did with the last run’s PR. Squash-merging it as it is would also work.'},

    {'title': 'Two other measurements looked slower; neither is the branch’s',
     'body':
       '<p>“Start page answers its first click” was 22% slower in the final A/B (pairs 1.80, 1.29, 1.04, 0.92). The branch changes nothing on that path. '
       'When identical code was measured against itself at the start of the run, the same measurement came out 31% slower, so it varies this much on its own.</p>'
       '<p>“The computer’s search speed” was 29% slower in the final A/B, on code the branch does not touch. I ran it again with 6 pairs: '
       '5.5% slower, with the pairs going both ways (0.89, 1.00, 1.08, 0.92, 1.46, 1.06), so the bench does not call it. That is noise.</p>',
     'charts': [{'rows': {'change': AA, 'only': CLICK}, 'caption': 'The first click, identical code against itself, 4 pairs.'},
                {'rows': {'change': FINAL, 'only': CLICK}, 'caption': 'The first click, branch against main, 4 pairs.'},
                {'rows': {'change': AIR, 'only': 'The computer thinks'}, 'caption': 'The search speed run again, 6 pairs.'}],
     'recommend': 'No action. The next run measures the first click again with 6 pairs.'},

    {'title': 'Five things the reviewers found that are design or trust decisions',
     'body': '<p>These need your judgement, not mine. None of them is in the PR.</p>',
     'figure': {'html': table(['Finding', 'Where', 'What fixing it costs', 'What it prevents'], [
        ['Anyone with a game’s link can take either seat', '<code>modal_app.py</code> rejoin; ARCHITECTURE.md lists it as accepted', 'a per-seat secret: schema, client storage and a server check', 'the opponent taking your seat'],
        ['The socket accepts connections from any website', '<code>modal_app.py:458</code>', 'a few lines; previews and localhost must be allowed', 'other websites opening sockets from their visitors’ browsers'],
        ['Logs pair game ids with IP addresses', '<code>modal_app.py</code> log lines', 'a few lines', 'anyone who reads the logs joining live games'],
        ['Three pieces of copy explain what the screen already shows', 'GameScreen.tsx:368, MoveCard.tsx:146, LearnScreen.tsx:172', 'the words and one test', 'text that CLAUDE.md’s copy rules forbid'],
        ['The HUD would sit under a phone’s notch if <code>viewport-fit=cover</code> is added', 'index.css:421, 456, 701, 910', 'four CSS values', 'the turn indicator and move box hidden in landscape']]),
                'caption': 'Ledger items SEC1–SEC3, I11 and I12.'},
     'recommend': 'Make the three copy cuts. Leave the seat, the socket and the logs as they are while the game is played among friends.'},

    {'title': 'CLAUDE.md is missing five sections the run expects',
     'body': '<p>The run expects CLAUDE.md to have a North star, and sections on measurement, reporting, loop state and tests. As in the last six runs, I used the nearest thing the repo has:</p>',
     'figure': {'html': table(['Missing section', 'Used instead'], [
        ['North star', 'ARCHITECTURE.md “Scope and trust assumptions”, and CLAUDE.md “Performance” for what speed is for'],
        ['Measurement', 'CLAUDE.md “Performance”: <code>bench/run.mjs --primary --base</code>'],
        ['Reporting, loop state, session log', '<code>bench/loop/</code> as earlier runs left it'],
        ['Tests', 'the unit, e2e and server test suites, and CLAUDE.md’s coverage rules']]),
                'caption': 'What each missing section was replaced with.'},
     'recommend': 'Add a short North star (what the game is for, and what it is not) when convenient. The rest works as it is.'},
  ]},

  'scoreboard': {'intro':
     '<p>The bench’s headline measurements are the eleven moments a player waits for, listed in <code>bench/primary.mjs</code>. '
     'Against main, the branch is 1.173 times as fast over all eleven. Two are called better: joining a game (71% faster) and the computer’s first board frame (60% faster). None is called worse. '
     'Memory did not grow beyond the 5% limit: a reopened long game uses 1.0% more JavaScript heap.</p>'
     '<p class="small">The final A/B ran with uncommitted changes in the branch’s folder. They were the run’s own notes in <code>bench/loop/</code>, committed a minute later as cf92a12. No app or bench code was uncommitted.</p>',
   'items': [
    {'title': 'The branch against main', 'charts': [{'rows': {'change': FINAL, 'only': 'PRIMARY'}, 'caption': 'Branch d5ed032 against main b1709f5, 4 pairs.'}]},
    {'title': 'The branch against the first recorded run: the 1.2× target is met',
     'body': '<p>The run’s target was 1.2 times the speed of the first recorded run (92ce041). The branch reaches 1.344 times, over the nine headline measurements that the old code can also make (it had no computer player). '
             'The last run reached 0.893 times. '
             'One measurement is called worse than the first run: the desktop start page is 20% slower. Its first paint is 20% slower and it downloads 11% more, because the start page has grown since then (the computer player, the tutorial, the preview). '
             'A reopened long game uses 35% more heap than in the first run, which earlier runs already found.</p>',
     'charts': [{'rows': {'change': FIRST, 'only': 'PRIMARY'}, 'caption': 'Branch d5ed032 against the first recorded run 92ce041, 3 pairs.'}]},
    {'title': 'How much the bench varies on identical code',
     'body': '<p>The run began by measuring main against itself. That called the opponent’s move 49% faster on one side, with identical code. '
             'The frame that shows the move waited 14–290 ms behind frames the GPU already had queued, and the queue happened to differ between the sides. '
             'That queue is what the pacer removes.</p>',
     'charts': [{'rows': {'change': AA, 'only': 'PRIMARY'}, 'caption': 'Main b1709f5 against itself, 4 pairs.'}]},
  ]},

  'changed': {'items': [
    {'title': 'The game’s and the lobby’s canvases wait for the GPU before sending the next picture',
     'body':
       '<p>Each canvas now places a marker (a WebGL fence) after each picture. A new picture is sent only when the GPU has passed the marker. '
       'Until then the canvas skips that frame and asks for the next one, while the motion keeps its real timing. '
       'The change is 70 lines in <code>client/src/three/framePacer.tsx</code> (commit a7cf4a4).</p>'
       '<p>Review found two faults in it, fixed in f8ab886. After the WebGL context was lost and restored, the canvas could stop drawing for good; it now forgets its old marker. '
       'The warm-up of the game’s shaders could count a skipped frame as drawn; it now waits for a frame that was really drawn. '
       'A marker also holds a frame for at most 60 display frames, about one second. Each fix has a test that fails without it.</p>',
     'charts': [{'rows': {'change': FP2, 'only': GPU + '|' + WAYIN}, 'caption': 'The pacer against the commit before it, 5 pairs.'}]},
    {'title': 'The bench times what the player sees',
     'body': '<ul>'
             '<li>Each frame now records when the GPU finished drawing it, and the move and selection sections report that time beside the hand-over time.</li>'
             '<li>The bench’s camera turn used to depend on how often frames came, so a faster page turned further. It now turns an exact angle.</li>'
             '<li>The A/B rule ignored a pair whose value was 0, so it could call a change that one pair contradicted. The rule now has its own file and a test.</li>'
             '<li><code>bench/run.mjs</code> used to run something else when a flag was mistyped, overwrite the results and report success. It now stops with an error.</li>'
             '<li>The computer section used to record empty results when the computer’s worker failed. It now stops with an error.</li></ul>'},
    {'title': 'Silent failures now leave a message',
     'body': '<p>The computer now logs an error when its search finds no move but the rules allow one. A saved computer game that cannot be read now logs why, because it is the only copy. '
             'The shader warm-up reports how it ended, and the bench shows that beside the first piece picked up.</p>'},
    {'title': 'Tests and checks that could pass on broken code now fail',
     'body': '<p>The e2e tests for games against the computer passed even with the computer’s search broken, because every fallback keeps the game going. '
             'They now fail on any fallback message, any page error, and any message sent to the server, which a computer game never uses. A deliberately broken search makes them fail. '
             'The test for a page whose 3D code fails to load now waits until the failure has happened before it checks the page.</p>'
             '<p>Lint now catches timers called through <code>globalThis</code> or <code>self</code>, <code>requestIdleCallback</code>, <code>new Date()</code>, any use of <code>__r3fState</code> outside the game canvas, and click handlers in <code>three/scene</code>. Six deliberate violations all fail. '
             'CI now runs <code>uv sync --locked</code>, so a Python lock file that no longer matches <code>pyproject.toml</code> fails the build.</p>'},
    {'title': 'Phone, screen reader and security headers',
     'body': '<p>On a phone held upright, the open move list covers the lower levels of the board. A tap elsewhere or the Escape key now closes it, as the game menu already does. '
             'A screen reader now reads each tutorial step aloud while the focus stays on the Next button. '
             'A new <code>public/_headers</code> file stops other websites from showing the game in a frame, stops browsers from guessing file types, and sends only the site’s name to links the player follows.</p>'},
  ]},

  'removed': {'intro':
     '<p>Nothing was deleted. Outside the run’s notes, the branch adds 815 lines and removes 103 in 40 files. '
     'Of these, the app gains 148 lines (70 of them the pacer), tests gain 388, the bench gains 161 and loses 52, and the lint configuration gains 60 and loses 29. '
     'The code grew for one speed change that players see, and for fixes, messages and checks.</p>'},

  'rejected': {'items': [
    {'title': 'Pacing the start page’s preview and the tutorial too',
     'body': '<p>Five pairs on the start page showed no change: 1.002 times as fast overall, with no measurement called. The tutorial has no measurement. '
             'I reverted it. The patch is in <code>bench/loop/patches/pace-preview-and-tutorial-FP2.patch</code>.</p>',
     'charts': [{'rows': {'change': FPR, 'only': 'PRIMARY'}, 'caption': 'Preview and tutorial paced, against the pacer commit, 5 pairs.'}]},
    {'title': 'Freeing the review history when the player stops looking back',
     'body': '<p>Rejected without measuring. It saves 1.3 MB only in a 2,000-move game, and every later step back would rebuild the whole history.</p>'},
    {'title': 'The pacer’s first measurement',
     'body': '<p>The first A/B of the pacer found two faults in the bench, not in the app. The selection section failed on every branch run, because the camera turn depended on the frame rate and hid a piece. '
             'The move measurement read 26% slower, because it stops at the hand-over. Both bench faults are fixed. All numbers above come from later measurements.</p>',
     'charts': [{'rows': {'change': FP1, 'only': 'PRIMARY'}, 'caption': 'The first A/B, 5 pairs. The selection rows are missing on the branch side.'}]},
  ]},

  'choices': {'intro': '<ul>'
     '<li>I kept the pacer although one headline measurement got 17% worse, and left <code>bench/primary.mjs</code> unchanged for you to decide.</li>'
     '<li>A frame waits for the GPU for at most 60 display frames, about one second.</li>'
     '<li>When time is stepped frame by frame (the showcase recordings and the orbit e2e test), the pacer draws every frame.</li>'
     '<li>The bench’s camera turn now turns an exact angle, so its “after a turn” measurements cannot be compared with earlier runs.</li>'
     '<li>I added the security headers and <code>uv sync --locked</code>.</li>'
     '<li>On a phone, the open move list closes on a tap elsewhere or Escape.</li>'
     '<li>The computer’s fallbacks log as errors, and an unreadable saved game logs as a warning.</li>'
     '<li>I did not research new libraries or dependency updates this run, because none of the project’s dependencies changed since the last run did.</li></ul>'},

  'notConfirmed': {'intro': '<ul>'
     '<li>The security headers on Cloudflare Pages. The sandbox cannot reach pages.dev, so I could not fetch them.</li>'
     '<li>The pacer on a real phone GPU and in Safari. The bench renders in software only.</li>'
     '<li>Whether the lobby’s fades, which run in the page rather than on the GPU, get ahead of the paced picture on a slow phone.</li>'
     '<li>The full e2e suite on the final commit on this machine. It passed in CI, and it passed here on the pacer’s first commit except for one test that failed only because a font could not be loaded from the folder I used.</li>'
     '<li>The start page’s first click with more pairs.</li></ul>'},

  'merge': {'intro': '<p>No other sessions worked on the repo, and main did not change during the run. ARCHITECTURE.md now describes the pacer and the security headers; CLAUDE.md is unchanged. '
     'I suggest one line in CLAUDE.md’s “Performance” section: the move and selection measurements time the hand-over to the GPU, and the “drawn by the GPU” measurements time the picture.</p>'},

  'next': {'intro': '<ol>'
     '<li>Measure the start page’s first click with 6 pairs. If you agree, switch the three move and selection headline measurements to the “drawn by the GPU” times.</li>'
     '<li>Check every place that assumes a frame callback means a frame was drawn, now that frames can be skipped.</li>'
     '<li>Look again at the shader warm-up. In every final run the player’s first pick came before the warm-up started, so the first pick’s 92 ms is its own frame.</li>'
     '<li>Share the garden’s geometry data between the lobby and the game, after measuring how much of the join it costs.</li>'
     '<li>Give each page its own preload list, so game pages stop preloading the tutorial.</li>'
     '<li>The smaller items in the ledger: RV7, RV8, RV10, RV11, T20, M1′, D3 and SP.</li></ol>'},
}
(here / 'RUN-20261014-0357.report.json').write_text(json.dumps(report, ensure_ascii=False, indent=1))
print('written')
