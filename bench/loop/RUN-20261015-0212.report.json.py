# Writes RUN-20261015-0212.report.json (the run report's words); tools/report.mjs
# draws the page from it and scoreboard.jsonl. Run: python3 RUN-20261015-0212.report.json.py
import json, pathlib

here = pathlib.Path(__file__).parent
facts = json.loads((here / 'final-20261015-0212-facts.json').read_text())

# Scoreboard rows, by the `change` key each A/B was recorded under
REG = 'regression check: 9f2d524 (six features) vs 145729b (primary, 4 pairs)'
RVP = 'RV-P: review in parallel workers vs 995fca9 (review, 4 pairs)'
SP1 = 'SP1 (rejected): preview chunk after the picture vs b305f6d (cold-load, 5 pairs)'
PL = "PL: the picture's preload after the viewport tag vs b305f6d (cold-load, 5 pairs)"
FINAL = 'final: beccfdf vs 9f2d524 (primary, 4 pairs)'
RECHECK0 = 'recheck: 2e17292 vs 9f2d524 (cold-load + review, 6 pairs)'
RECHECK = facts['recheck_change']
FIRST = facts['first_change']

START = 'Cold load of the start screen · (desktop|phone, 4× CPU, Fast 4G) · (“Play a friend” enabled|board on screen.*|bytes downloaded|pictures of the board downloaded)'
REVIEW = 'Reviewing a finished game · “Analyse” clicked'
CLICK = 'Cold load of the start screen · desktop · first visit’s first click'


def table(head, rows):
    h = ''.join(f'<th>{c}</th>' for c in head)
    b = ''.join('<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>' for r in rows)
    return f'<table><thead><tr>{h}</tr></thead><tbody>{b}</tbody></table>'


report = {
  'title': 'Perf run 20261015-0212',
  'eyebrow': '3D chess · perf-iteration · run 20261015-0212',
  'heading': 'A phone’s start page shows its board in half the time, and a game’s review finishes in less than half',
  'meta': (
    '<p>On a phone, the start page now shows its board in about 0.9 s instead of 1.7 s. A finished game’s review now marks every move in 4.6 s instead of 10 s. '
    'The phone fix is a bug fix: every phone downloaded the tablet’s picture first and the right picture late. '
    'The run also fixed four correctness problems on the server and in the client. No headline measurement got worse. '
    f'Everything is in <a href="https://github.com/howard36/3d-chess/pull/147">PR #147</a>.</p>'
    '<p class="small">Run 2026-10-15, 02:12–05:30 UTC. Main at <code>9f2d524</code>, branch <code>improve/20261015-0212</code> (pushed as <code>claude/serene-galileo-jajbb3</code>). '
    'Measured in headless Chromium with SwiftShader (WebGL drawn on the CPU) on 4 CPUs. '
    'Every comparison is an A/B: the bench runs main and the branch back to back several times, and each back-to-back run is a <em>pair</em>. '
    'A change is <em>called</em> only when every pair moves the same way, by more than 5% and by more than the pairs disagree with each other.</p>'),

  'needs': {'items': [
    {'title': 'Review PR #147, and decide whether to split it',
     'body':
       '<p>The PR holds the run’s changes in four kinds. Each commit’s message gives its evidence; six commits hold two related changes each (listed in the run record), not one. '
       'CLAUDE.md asks for one logical change per PR; the run’s instructions asked for one branch and one PR. '
       f'{facts["ci"]}</p>',
     'figure': {'html': table(['Part', 'Commits', 'What it does'], [
        ['Start page and review', '0c7aea0, b305f6d, 4b7fb96', 'the phone’s picture; the review in parallel workers; a review that fails says so'],
        ['Server', 'fea5a5a, cfbace2, 10ce347, 2e17292', 'tests that catch a lost write-back; a cap on frame size; rejoin fields from the schema'],
        ['Client fixes', '9ba343a, 1d1ca66, bb04a04', 'a rematch’s seat; the offer line; the level list'],
        ['Bench, checks, lint, cleanup', '995fca9, f3a7997, ede4014, beccfdf, 7cbf25a, 822038e', 'the review’s bench section; grade edges; the canvas lint rule; e2e and test cleanup']]),
                'caption': 'A split along the four kinds of change.'},
     'recommend': 'Split it into the first three parts plus the fourth, or squash-merge it as it is. Either works; the commits do not depend on one another except where the table groups them.'},

    {'title': 'The start page got slower on phones with #138; the branch fixes a bug that cost part of it, and two rows need watching',
     'body':
       '<p>Since the last run, six features landed on main. One of them, #138 (the start page’s picture), made “Start page usable, phone” 9.4% slower, called in every pair (776 → 848 ms), while making the board appear about twice as soon. '
       '#138 also had a bug, which this branch fixes: the picture’s preload ran before the page knew it was on a phone, so every phone downloaded the tablet’s 73 KB picture beside the page’s code. That explains part of the extra bytes, but not necessarily the slowdown.</p>'
       '<p>Against main, the fixed branch has the phone’s “usable” time 3.4% sooner (final A/B), 0.2% sooner (6-pair re-check) and 6.5% sooner (after the merge), none called. I did not compare the branch with the code from before #138, so how much of the 9.4% is recovered is not measured. '
       '“Start page usable, desktop” leaned slower in two A/Bs (+4.0% and +6.4%, every pair of the second above 1, not called) and faster in two (−1.8% and −2.8%). The preload fix moves an inline script in the page’s head, which runs on desktop too, so the branch does touch that path.</p>',
     'charts': [{'rows': {'change': REG, 'only': START}, 'caption': 'Main 9f2d524 against the last run’s end 145729b: what #138 did, 4 pairs.'},
                {'rows': {'change': RECHECK0, 'only': START}, 'caption': 'The branch (2e17292) against main 9f2d524, 6 pairs.'}],
     'recommend': 'Merge the fix. The next run compares the start page against 145729b directly, and measures the desktop’s “usable” row with more pairs.'},

    {'title': 'Flag: a review now holds more memory than the bench measures',
     'body': '<p>The run’s memory rule flags any peak increase over 5%. The page’s own heap did not grow (a reopened long game: −0.1%). '
             'But a review now runs up to three workers instead of one, and the bench does not measure workers. By estimate, each extra worker holds its own JavaScript heap and 3.25 MiB of search tables (ledger M9′), so a review on a 4-core machine may hold about 10 MB more while it runs, and frees it when it ends. Against a page heap of about 14 MB that is well over 5%. It is not measured.</p>',
     'recommend': 'Keep the parallel review, and let the next run measure the workers’ memory (Chrome’s memory tools can) and make the search tables once per worker (M9′), which removes most of the per-position allocation.'},

    {'title': 'Four findings that are design or rules decisions',
     'body': '<p>The reviewers found these. None is in the PR, because each changes behaviour that a player would notice or a rule of the game.</p>',
     'figure': {'html': table(['Finding', 'Where', 'Fixing it costs', 'My recommendation'], [
        ['One player can use up the other’s single take-back or draw offer for a move by asking first', '<code>modal_app.py:309, 359</code>', 'about 6 lines on the server and the same in the client', 'Allow each side its own ask per move'],
        ['On an upright phone, “Analyse” is hidden until the move list is opened', '<code>MoveHistory.tsx:210, 376</code>; ARCHITECTURE.md calls it intended', 'a small control in the step row', 'Add it: the review is easy to miss on a phone'],
        ['A rematch closes and reopens the connection and rebuilds the 3D board', '<code>App.tsx:33, 83</code>', 'a protocol change; the full entrance plays again', 'Leave it'],
        ['A rematch’s id is in every rejoin, so anyone with the first game’s link can take a seat in its rematches', '<code>modal_app.py:589</code>', 'one line in ARCHITECTURE.md “Scope and trust”', 'Add the line']]),
                'caption': 'Ledger items SEC6, I16, RM and SEC7.'},
     'recommend': 'Tell me which of the four to do; each is small except the rematch connection.'},

    {'title': 'CLAUDE.md is still missing five sections the run expects',
     'body': '<p>The run expects a North star and sections on measurement, reporting, loop state and tests. As in the last seven runs, I used the nearest thing the repo has.</p>',
     'figure': {'html': table(['Missing section', 'Used instead'], [
        ['North star', 'ARCHITECTURE.md “Scope and trust assumptions”, and CLAUDE.md “Performance” for what speed is for'],
        ['Measurement', 'CLAUDE.md “Performance”: <code>bench/run.mjs --primary --base</code>'],
        ['Reporting, loop state, session log', '<code>bench/loop/</code> as earlier runs left it'],
        ['Tests', 'the unit, e2e and server suites, and CLAUDE.md’s coverage rules']]),
                'caption': 'What each missing section was replaced with.'},
     'recommend': 'Add a short North star (what the game is for, and what it is not) when convenient.'},
  ]},

  'scoreboard': {'intro':
     '<p>The bench’s headline measurements are the moments a player waits for, listed in <code>bench/primary.mjs</code>. '
     'This run added one: a finished game’s review, from “Analyse” to every move marked. '
     'Against main, the branch is 1.097 times as fast over all fourteen. Two are called better: the phone’s start page showing its board (46% faster) and the review (54% faster). None is called worse, but two lean slower than the run’s 3% limit without being called: “Start page usable, desktop” (see Needs from me) and “Reopening a long game” (+9.5%; measured again below, −12% on the last commit). '
     'The page’s heap did not grow (−0.1% on a reopened long game); the review’s workers are not measured (see Needs from me).</p>'
     f'{facts["scoreboard_extra"]}',
   'items': [
    {'title': 'The branch against main', 'charts': [{'rows': {'change': FINAL, 'only': 'PRIMARY'}, 'caption': 'Branch beccfdf against main 9f2d524, 4 pairs.'}]},
    {'title': 'The headline results again, on the final commit',
     'body': facts['recheck'],
     'charts': [{'rows': {'change': RECHECK, 'only': START + '|' + REVIEW + '|' + CLICK}, 'caption': facts['recheck_caption']}]},
    {'title': 'Reopening a long game, measured again on the last commit',
     'body': '<p>In the final A/B the headline row “Reopening a long game (2,000 plies)” leaned 9.5% slower (161 → 178 ms, not called), over the run’s 3% limit, and the re-checks after it did not measure it. '
             'Measured again on the last commit, 9afbf60, against main de25815: 12% faster (167 → 157 ms, not called), with its first picture −1.8%, its page freezes −2.7% and its heap +0.2%. The lean did not recur. '
             'The same A/B measured the review on this commit: 54% faster, called. Seeding the 2,000-ply game takes 4.3 times as long in the bench’s local server, which now copies records as production does; that is bench setup, not a moment a player waits on.</p>',
     'charts': [{'rows': {'change': 'reopen: 9afbf60 vs de25815 (reopen + review, 3 pairs)', 'only': 'Reopening a long game · (move record shown|board’s first picture|page freezes in total|JavaScript memory)|' + REVIEW}, 'caption': 'The last commit 9afbf60 against main de25815, 3 pairs.'}]},
    {'title': 'The branch against the first recorded run',
     'body': facts['first'],
     'charts': [{'rows': {'change': FIRST, 'only': 'PRIMARY'}, 'caption': facts['first_caption']}]},
  ]},

  'changed': {'items': [
    {'title': 'A phone downloads the start page’s own picture, and shows it in half the time',
     'body':
       '<p>The start page shows a picture of its 3D preview until the preview has loaded. A small script in the page’s head starts that picture downloading early, choosing the phone, tablet or wide picture from the window’s size. '
       'The build placed the script before the tag that tells a phone to use its own width, and until that tag is read a phone reports a 980-pixel-wide window. So every phone chose the tablet’s picture (73 KB), and the phone’s own picture started downloading only when the page drew it.</p>'
       '<p>The script now follows that tag (commit 0c7aea0). A unit test fails if it moves back, and the bench now counts the pictures each cold load downloads. '
       'On the slowed phone, the board appears at 870 ms instead of 1.70 s, the page downloads 12% less, and “Play a friend” is ready 3.5% sooner (not called). '
       'One diagnostic got worse. On the phone without slowing, the first paint comes 76 ms later (146 → 222 ms), because the picture has already arrived and the first frame now includes it. The board on that phone appears 8.5% sooner.</p>',
     'charts': [{'rows': {'change': PL, 'only': START}, 'caption': 'The fix against the commit before it, 5 pairs.'}]},
    {'title': 'A finished game’s review searches in several workers at once',
     'body':
       '<p>A review searches each position of the game for a fixed number of positions (120,000), so its marks are the same on any machine. It used to search one position at a time in one worker. '
       'Each position is a separate search, so they can run side by side with the same results. The review now uses one worker per spare core, at most three, and hands the positions out from the start of the game (commit b305f6d). '
       'The marks were identical in all 16 runs of the A/B, and the page showed no freezes.</p>'
       '<p>A review whose search failed used to show “done” with its counts as if final, so a review that failed at the first move read as a perfect game. Now it says “Analysis stopped” with a Retry button, which continues from the positions already found. '
       'The diff review found that a search finishing after the stop could restart the progress bar for good; that is fixed with a test (4b7fb96). '
       'The grading found that when the review cannot use workers it runs its searches on the page’s own thread, three at a time instead of one. 9afbf60 fixes this only for a browser with no workers at all (with a test). '
       'When a worker’s script fails to load (a stale file after a deploy, say), each of the three still falls back to the page on its own, so the page can be busy three times as long. That case is not fixed; it is first in Next.</p>',
     'charts': [{'rows': {'change': RVP, 'only': REVIEW}, 'caption': 'Parallel review against the commit before it, 4 pairs.'}]},
    {'title': 'The server’s tests now catch a lost write-back, and one large message can no longer stall every game',
     'body':
       '<p>Each change to a game record is read, changed and written back. In production the store hands out copies, so the write-back is the whole change. The tests used a plain dictionary, which hands out the record itself, so a missing write-back passed every test. '
       'The tests and the local server now use a store that copies the way production does (commits fea5a5a and 2e17292). Removing a write-back now fails two tests; on main all 77 pass.</p>'
       '<p>Every message is checked against all 31 message types. A 1 MB message made of 100,000 short keys took 7.4 s to check on this machine, and the server handles all games on one thread. Messages longer than 4,096 characters are now refused before they are read (cfbace2); the longest real message is about 150. '
       'A rejoin now sends every field the stored record shares with the protocol, instead of a hand-kept list, and its test reads the field from the rejoin (10ce347).</p>'},
    {'title': 'A focus bug my own cleanup caused, fixed',
     'body': '<p>Merging the six offer lines into one table (1d1ca66) made React reuse one element for whichever line shows. With a take-back and a draw offer both standing, a keyboard player who declined the take-back kept focus on the same button, which then declined the draw. The diff review caught it, and keying each line by what it says fixes it (4b7fb96). This fix has no test.</p>'},
    {'title': 'A rematch keeps its seat when the browser refuses to save it',
     'body': '<p>When local storage was full or turned off, accepting a rematch opened the new game with no saved seat, and the page showed “Game full” for the game the player had just been placed in. The page now also carries the seat in its navigation (9ba343a).</p>'},
    {'title': 'Checks that can now fail',
     'body': '<ul>'
             '<li>The grade thresholds are tested a centipawn either side of each edge. A slope 2% off now fails the test (ede4014).</li>'
             '<li>Lint now fails any app canvas that does not draw on demand (beccfdf).</li>'
             '<li>The start page’s e2e tests now check that the picture decoded, not only that its box is visible (7cbf25a).</li>'
             '<li>The bench has a review section, which fails if two runs give different marks (995fca9, fixed in f3a7997).</li></ul>'},
  ]},

  'removed': {'intro': facts['removed']},

  'rejected': {'items': [
    {'title': 'Loading the 3D preview only after the picture is on screen',
     'body': '<p>A reviewer suggested that the preview’s code, loading at the same time, held the picture back. Five pairs showed otherwise: the phone’s board leaned 9.8% faster (not called), the desktop’s leaned 27% slower (not called), and the phone’s live preview was called 11% slower. '
             'I reverted it; the patch is in <code>bench/loop/patches/picture-before-preview-SP1.patch</code>. Looking at that phone load step by step is what found the real cause, the wrong picture.</p>',
     'charts': [{'rows': {'change': SP1, 'only': START}, 'caption': 'Preview after the picture, against b305f6d, 5 pairs.'}]},
    {'title': 'Catching JSON nested too deeply',
     'body': '<p>I added a catch for this with the size cap. The diff review pointed out that a message under 4,096 characters can nest at most 2,047 levels, which Python parses without trouble, so the catch could never run. I removed it.</p>'},
  ]},

  'choices': {'intro': '<ul>'
     '<li>The review uses one worker per spare core, at most three. On a 4-core phone that is three workers during a review, using up to about 10 MB more memory while it runs (not measured).</li>'
     '<li>The words “Analysis stopped” and “Retry” for a failed review.</li>'
     '<li>Messages over 4,096 characters are refused with “Message is too large”.</li>'
     '<li>The local server, e2e and the bench now copy records the way production does. Seeding a 2,000-move game in the bench takes longer (bench setup only, not a measured moment).</li>'
     '<li>I accepted the later first paint on the unthrottled phone, since the board itself appears sooner.</li>'
     '<li>The branch is pushed as <code>claude/serene-galileo-jajbb3</code>, the session’s branch, not <code>improve/20261015-0212</code>.</li>'
     '<li>I folded the dependencies reviewer into the “what’s new” reviewer: every dependency is current (three r186, react-three-fiber 9.8.1, Vite 8.3.4).</li></ul>'},

  'notConfirmed': {'intro': '<ul>'
     '<li>The review on a real phone. With three workers on a slow phone, a position might hit the 1.5 s time limit before its 120,000 positions, and its marks would then differ from a desktop’s.</li>'
     '<li>The workers’ memory during a review. The bench measures the page’s memory, not the workers’.</li>'
     '<li>Whether Modal’s own front end accepts frames larger than 4,096 characters at all; the cap holds either way.</li>'
     f'<li>{facts["e2e"]}</li>'
     '<li>Caching of the built files on Cloudflare Pages. The sandbox cannot reach pages.dev to read the headers.</li></ul>'},

  'merge': {'intro': '<p>Other sessions merged three PRs into main during the run (#141, #144 and #145), and more were open. I merged main into the branch at 89eb146. '
     'Six files conflicted. #144 had also made one shared e2e <code>resign</code> helper and made <code>isDifficulty</code> read the list of levels, so I took main’s versions and dropped mine. The rematch keeps its colour in the navigation, using main’s <code>otherSide</code>. '
     'Lint, typecheck, 1,373 unit tests and 79 server tests pass on the merge. '
     'Main moved again at 05:09 UTC (#146, ec44dfa). The branch is behind it but merges cleanly (checked with <code>git merge-tree</code>); I did not merge it, so that the final measurements stay on the commit they measured. '
     'ARCHITECTURE.md now describes the parallel review and its stopped state, the picture’s preload, the copying store and the size cap. CLAUDE.md is unchanged.</p>'},

  'next': {'intro': '<ol>'
     '<li>Run on-page searches one at a time when a worker’s script fails to load, so a review never runs three on the page thread (RV17, the part 9afbf60 left).</li>'
     '<li>Measure a review’s time per position on a phone, to see whether the 1.5 s limit bites (RV18).</li>'
     '<li>Count the shaders linked at the end of a reopened game’s entrance, where #140’s replay may have moved three of them (RP1).</li>'
     '<li>Keep a review’s results when the page is reloaded (RV-K).</li>'
     '<li>Make <code>/assets/*</code> cacheable for a year in <code>_headers</code>, after reading the production headers (P2′).</li>'
     '<li>The smaller items in the ledger: V16, I13–I15, D9–D11, DR2–DR4, E15, M9′, CW2.</li></ol>'},
}
(here / 'RUN-20261015-0212.report.json').write_text(json.dumps(report, ensure_ascii=False, indent=1))
print('written')
