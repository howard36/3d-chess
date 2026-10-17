---
name: perf-iteration
description: One budgeted improvement run on 3D Chess - speed first, and fixes, removals, checks and interface changes held to the same bar of evidence. Measures the base commit, finds ideas with read-only reviewers, lands each proven change on one branch and one PR, and publishes a report. Use when asked to run a perf iteration, make the game faster, improve the codebase, or continue the loop in bench/loop/.
---

Improve this project one run at a time: faster in real use, less code, a more truthful account of what it does, and rules that now run as checks.

This prompt works with the repo's own guidance, which applies as written:
- **Goals:** CLAUDE.md "Performance": what speed is for, and the order goals win in when they conflict. ARCHITECTURE.md "Known limitations" lists what the project accepts and won't fix.
- **Measurement:** CLAUDE.md "Performance" and the `bench/run.mjs` entry in "Commands"; ARCHITECTURE.md "Benchmarks". The primary rows are in `bench/primary.mjs`.
- **Tests:** `/check` runs everything CI runs. CLAUDE.md "Invariants to preserve" names the coverage gates, and "Performance" names the outputs that must stay byte-identical and the counts that guard past wins.
- **Landing:** CLAUDE.md "Git". **Hazards:** CLAUDE.md "Gotchas".
- **Loop state:** `bench/loop/`, described below.

A run is done when:
- anything that regressed since the last run is reported, and fixed if it is yours to fix,
- every change you started is committed with its evidence, or reverted and logged,
- the headline results were re-checked on the branch's final commit,
- the report and the run record are written, so a new session can pick up without this conversation, and
- a reviewer graded the finished run against this list and found nothing unmet.

<parameters>
- Goal: steady. Work the ledger by expected value until the budget is spent or nothing worth doing is left. Two ideas in a row that don't pay off mean it's time to relaunch the reviewers, not to stop.
- Focus: none.
- Target: the primary rows 1.2× faster than this run's base commit (where the last run left them), by the A/B's one speed for them all, with no primary row called worse. Keep going after the target is met, while the budget lasts. If the target can't be met, say why under "Needs from me".
- Run budget: about 4 hours. Record the start time and check `date` against it.
- Landing: a branch `improve/<run id>` from the base commit, in its own git worktree, one commit per change. State each commit's evidence as a relationship plus a pointer to its scoreboard rows. Open one PR for the run, listing its changes, and don't merge it. Split a change into its own PR from `main` only when others need it before the run ends: a correctness or security fix, something another session depends on, or a change you would want to revert on its own.
- Speed: no primary row called worse by `--base` against the base commit. "Not called" does not mean "not slower": a primary row that is worse in every pair, or more than 3% worse at the median, goes under "Needs from me" with its pairs.
- Memory: flag any increase over 5% in the browser tier's heap or live geometries and textures.
- Quality: all tests pass, and the outputs CLAUDE.md "Performance" pins stay byte-identical unless a change is meant to alter them.
- Code: the codebase grows only when the new code buys a measured gain a player would notice, or a fix shown as <evidence> asks. A gain of a few percent that adds a lot of code isn't worth it.
- Reviewers: one read-only subagent per lens.
- Report: an artifact, published so I can read it on my phone. Write its words with `/anthropic-skills:writing-clear-documents`.
</parameters>

<measurement>
- Measure a change with `node bench/run.mjs --primary --base <ref>` (narrow it with `--only`, `--files`, `--grep` while iterating). A row counts only when the A/B calls it. Never judge a change against a saved run or an earlier run's rows: the VM's speed drifts by more than most changes.
- The clone is shallow, so an old base such as the first recorded run may be missing. `--base` says so and gives the fetch command.
- Cover real use with scenarios: the common paths, the slow paths players feel, and edge sizes. Each scenario declares whether it starts cold or warm. A new player moment goes in `bench/primary.mjs` with the row that measures it.
- `--base` runs this checkout's benchmark code against the base commit. A check you add must measure (a count, for example), never throw on the old behaviour, or the whole comparison fails.
- Where the bench can't show something you need, making it show it is an improvement in its own right.
- Keep dependency versions and inputs fixed within a comparison. A version bump is its own change, measured on its own.
- Measure the code too: lines per layer (engine, game, ai, three, screens, server, tests, bench), duplication, dead code and complexity.
- Counts are proxies. Never move one in a way that makes the game worse to play or the code harder to read.
</measurement>

<evidence>
Every kept change meets the same bar as a speed change: shown on the base commit, shown changed on the branch, by something a reviewer can rerun. A reviewer's claim, or your reading of the code, is a lead, not evidence.
- **Speed:** the A/B calls the row (above).
- **A correctness or security fix:** a test, or for security a reproduction, that fails on the base commit and passes on the branch, and the root cause in one sentence. If no test can show the bug, it isn't kept as a fix.
- **A visibility fix:** a test that shows the failure was silent on the base commit and is reported on the branch (the message, the state or the log line).
- **A new check:** shown to fail once on a deliberately broken copy of the code, and to pass on the branch. Say how you broke it.
- **A removal:** behaviour unchanged (the tests pass, the pinned outputs stay byte-identical), and the code counts before and after: lines per layer, duplication and complexity. Removing what nothing uses is kept only with what it did and why nothing needs it.
- **An interface change:** before-and-after pictures at phone and desktop size. A plain bug (an overlap, text cut off, a control that can't be reached) also needs a check that fails on the base commit. Anything else is a call of taste: put it under "Needs from me" and don't keep it alone.
- **Derived instead of copied:** a test that fails if the source and its use disagree.
</evidence>

<loop_state>
`bench/loop/` carries the work from run to run. Commit only:
- `LEDGER.md`: the ideas still in play and the ones rejected (see below).
- `scoreboard.jsonl`: one row per measured comparison, written from its A/B report by `tools/ab2jsonl.mjs`, pointing to that report.
- `RUN-<run id>.md`: the run record. It holds the run's facts, a session log, the commits with their evidence, and ends with "Bookmarks for the next run": the base to start from, when each lens last ran and on which commit, and the first items to take.
- `RUN-<run id>.report.json`: the report's words, from which `tools/report.mjs` rebuilds the page.
- The A/B reports the scoreboard and the run record point to, as text, named `ab-<run id>-<what>.md`.
- `tools/`: the scripts that build charts and reports, and probes a later run will use again.
- `patches/`: the diff of each rejected idea worth retrying.
Don't commit the built report page, screenshots, traces, raw JSON or charts. What a decision needs goes in the published report; the rest stays in `bench/out/`, which git ignores.

The ledger shows the state now; the run records keep the history. It has two tables, each idea in one row under one id:
- **Open:** each row has the idea, its lens, its evidence (file and line, and whether it was measured, read in the source or reported) and its status, open or parked. A parked row says what it waits on.
- **Rejected:** each row has the idea, its measured result and the pointer to its A/B report or patch, so it isn't retried blind.
At the end of each run, tidy it:
- A kept idea leaves the ledger. Its commit and run record are its history.
- Merge duplicates into the oldest id.
- Delete an open idea whose code no longer exists, and say so in the run record.
- An open idea that three runs passed over becomes parked, with the reason.
</loop_state>

<visuals>
- Each run's report is one page, built by `tools/report.mjs` from the run's report file, readable on a phone. It draws every chart from `scoreboard.jsonl` rows, and each chart names its data file and conditions. Each item under "Needs from me" carries the picture that decides it and your recommendation.
- Calls of taste are mine. Put before-and-after pairs beside the question.
</visuals>

<lenses>
Start each lens from the ledger's open items and CLAUDE.md "Gotchas".
1. What's new: techniques and upstream capabilities from the last year (React, three.js, react-three-fiber, Vite, the browser, FastAPI, Modal) that apply here and that the project doesn't use yet. Search the web, and cite each one with its source and date.
2. Hot paths and scaling: work that grows faster than its input, and per-call overhead.
3. Reuse: computed work that is thrown away or recomputed when it could be kept safely.
4. Memory: allocation, copies, peak usage and layout.
5. Concurrency, I/O and boundaries: the main thread against workers and the GPU, blocking, serialization, round trips to the server, and the copies `modal.Dict` makes.
6. Dead and duplicated code, and layers that could be thinner.
7. Derive, don't copy: hand-kept lists and constants that could be read from their source.
8. Visibility: silent fallbacks, swallowed errors, and behaviour that can't explain itself.
9. Enforce, don't remind: rules in CLAUDE.md, ARCHITECTURE.md or comments that no check enforces.
10. Dependencies: local workarounds that newer releases make unnecessary, and fixes that belong upstream.
11. Interface: rough edges in the UI, on a phone as much as a desktop, judged by CLAUDE.md "Interface copy".
12. Security and privacy.
13. Checks that can't fail: tests and assertions that would pass on broken code.
</lenses>

<each_run>
1. Orient. Create the run id and the worktree, and start the run record. In your worktree, read CLAUDE.md and the docs it points to. In `bench/loop/`, read the ledger, the scoreboard and the last run record's bookmarks, and read my replies on the last run's PR. Read the git log since the bookmarked base, and check pinned dependencies' release notes since lens 10 last ran. Check that every file, command and behaviour this prompt names still holds on the base commit, and list any that don't under "Needs from me".
2. Measure. Compare the base commit with the last run's base: `--primary --base <last base>`. Any row called is a lead. Find the commit that caused a regression (bisect if needed), and fix it first or put it under "Needs from me".
3. Find. Launch the reviewers in parallel, one per lens. Skip a lens whose bookmark shows that nothing it covers has changed. Tell each one:
   - Read code and the web only. Don't edit files, build, run tests or benchmarks, or start processes. Those compete for the machine and make timings meaningless.
   - For each idea, cite the file and line, say how it works, estimate the gain or the lines removed, and name the risk. Mark each claim as measured, read in the source, or reported elsewhere. Where a claim needs data you don't have, write "verify:" instead of guessing.
   - Return at most 5 ideas, ranked by expected value.
   Before you add an idea to the ledger, read the code the reviewer cites to check its claim, and check whether the ledger already has it or rejected it.
4. Improve.
   Take silent failures and other correctness problems first, then the rest by expected value.
   When an idea is promising but large, try it instead of logging it for later. For each change:
   a. Make sure a check covers the behaviour you're about to change, and record what the base commit shows for the evidence the change will need.
   b. For a structural change, sketch the before and after first.
   c. Change the code, iterating on exact counts where you can.
   d. Run the tests and the relevant rows with `--base`.
   e. Keep the change only if it meets the bar in <evidence>, regresses nothing beyond tolerance, and is worth what it adds. Otherwise revert it, save its patch if it is worth retrying, and log the result.
   f. If the change sets up something that could quietly decay (a count, a behaviour, a rule), add the check that enforces it. For shared machinery such as git hooks, propose the wiring instead of installing it.
   g. Commit, then append to the ledger and the scoreboard.
5. Review. Relaunch reviewers on the run's diff. Ask them for:
   a. whether each change does what its ledger entry says,
   b. only the problems they would block the merge for, each with the file and line, why it's wrong, and how to show it fails, and
   c. new ledger items.
   Fix whatever blocks the merge, and log the rest.
6. Verify. On the branch's final commit, run `/check` and re-run the rows behind every headline result. Later commits can undo earlier wins, so report only what holds.
7. Report. Build the page, finish the run record with its bookmarks, and tidy the ledger.
8. Grade. Give one reviewer this prompt's "done" list, parameters and <evidence>, the run record and the report. Ask only for what is unmet, any kept change whose evidence falls short of <evidence>, and any change that pulls against CLAUDE.md's order of goals. If something is unmet, fix it, then repeat from step 6.
</each_run>

<scope>
- Stay inside what the project is for. An idea that ARCHITECTURE.md "Known limitations" accepts, or that CLAUDE.md's order of goals ranks below what it costs, is rejected, however good it is.
- Before deleting something that looks unused, say what it does and why nothing the project is for needs it.
- A new measurement or check that makes something visible counts as progress when it meets <evidence>. Log it like any other change.
</scope>

<final_report>
The page and your last message start with the same headings, in this order:
- Needs from me: decisions, approvals and merges waiting on me, each with the picture that decides it and your recommendation.
- Scoreboard: charts of this run against its base commit and the target, with the first recorded run for the long view.
- Changed: what was kept and why it's better, with before-and-after pictures where they help.
- Removed: code, settings and dependencies deleted, with the net line count.
- Tried and rejected: each with its measured result.
- Choices made alone: decisions you made without me, so I can overrule them.
- Not confirmed: anything you couldn't verify or run, and where you looked.
- Next: the top of the ledger.
If other sessions are editing the same files, add "For the merge" before "Next": the updates you propose to the files they edit.
Keep your last message short: the "Needs from me" items and where the page is.
</final_report>
