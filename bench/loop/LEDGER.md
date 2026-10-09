# Ledger

Every performance idea tried or considered, with its evidence. Newest runs append; a rejected idea says why, so it isn't retried blind.

Status: `open` (not yet tried), `kept` (committed), `rejected` (measured, not kept), `parked` (needs a decision or data we don't have).

## Run 20260930-0240 (perf-breakthrough, base 92ce041)

Ideas from 12 read-only reviewers (one lens each), checked against the code before entry.

| # | Idea | Moment | Source lens | Claim checked | Status |
| --: | :-- | :-- | :-- | :-- | :-- |
| 1 | Mount the game canvas early (hidden under the lobby) so its first frame is drawn before `game_start` | first board frame | parallelism, boundaries, removable | GameScreen mounts GameView only at `phase === 'started'` (read) | open |
| 2 | `renderer.compileAsync` for the first frame and for WarmPrograms (KHR_parallel_shader_compile) | first board frame, selection after entrance | what's new, parallelism, boundaries | three r176 has it (read); SwiftShader extension support: verify | open |
| 3 | Skip frames that draw nothing new: shimmer frames while its pulse is off the line; Board re-renders that churn `userData`/closures and invalidate | move landing, selection (in a game with a last move) | removable | shimmer invalidates every frame forever (read markers.tsx) | open |
| 4 | Sky: skip its shading where the ground covers it (pixel-identical) | every frame (raster) | numerical | ground opaque, drawn over sky; sky shader has atan/sin/pow (read) | superseded by 6 on frames at rest |
| 5 | Scissored repaint of the tower's rect when the camera hasn't moved (preserveDrawingBuffer) | move landing, selection | bespoke, vectorization | garden depends only on camera + a few uniforms (read) | open |
| 6 | Cache the garden (backdrop) while the camera rests: copy the canvas after the garden, draw the copy instead | move landing, selection | bespoke, numerical | done without a render target (canvas copy, same programs, same MSAA): 0 pixels differ | **kept** (commit 2): frame 200→130 ms; A/B 3 pairs: mover −29%, opponent −36%, select −16%; render() +0.25 ms |
| 7 | `alpha: false` on canvases | every frame (compositor) | vectorization | verify alpha is 1 everywhere | open |
| 8 | `pow(x,2.0)` → `x*x` in shaders | raster | numerical | ulp-level output change | open |
| 9 | Early WebSocket from index.html | start page, game page first screen | I/O, boundaries | socket opens in useEffect after React commit (read) | open |
| 10 | Tree-shake fallback piece builders (sdf/decimate/knight) out of the lazy chunk | bytes (preview chunk) | memory | verify in built chunk |**kept in run 20261001-0352** (R5) |
| 11 | Fuse build→bake→merge in the piece set (fewer copies) | first board frame | memory | ~46 ms total build, idle callbacks | open |
| 12 | Lazy-load lobby/game screens out of the entry | start page | build config | App.tsx imports them directly (read) | open |
| 13 | Dedupe `scheduler` | bytes | build config | package-lock has 0.25 ×2 + 0.26 |**kept in run 20261001-0352** (R11) |
| 14 | Incremental message-log fold | per message | complexity | µs-scale; not a target moment | parked (low value) |
| 15 | MSAA off / lower pixel ratio | raster | numerical, vectorization | changes pixels: needs approval | parked (needs decision) |
| 16 | Finite ambient animations (shimmer stops after N passes) | move landing, selection | removable | visible design change | parked (needs decision) |
| 17 | Modal `min_containers=1`, cache headers `_headers` | cold start, repeat visits | build config, I/O | not visible to the bench; costs money | parked (needs decision) |
| 18 | Bitboards, incremental attack maps, worker piece build, OffscreenCanvas | — | several | engine and build are off the hot path | rejected on reading (µs vs ~300 ms raster) |

### Tried in this run (measured)

| Idea | Result | Status |
| :-- | :-- | :-- |
| Remove `discard` from the piece glaze (early-Z) | 0 ms (interleaved median, 1280×720) | rejected |
| Glaze's rare blocks (capture burn, entrance forming) as zero-trip loops | 0 ms: SwiftShader masks loops like branches | rejected |
| Glaze's rare blocks compiled out (#define variants) | −12…−19 ms/frame; 1 byte of 3.7 M off by 1; +2 programs to warm | **kept** (commit 4): orbit w/ selection +10–12% fps, opponent −9%, mover and select within noise |
| `compileAsync` / KHR_parallel_shader_compile | not exposed by this Chromium's SwiftShader; 12 small links 23 ms | rejected here (can't measure; may help real GPUs) |
| Shimmer stops asking frames after 1.5 s (hack, upper bound) | move landing −15…−19% (2 pairs, noisy) | parked (design change) |
| Board renders that change nothing on screen draw no frame (stable cell props) | mover −17%, select −18% (3 pairs, not called); invalidates on disable 126 → 0 | **kept** (commit 3) |
| Hold the lobby's frames while the game canvas initialises (hack) | join click → first frame 10.9 s → ~10 s (cold, 2 runs): no real change | rejected |
| Why a cold join is slow | bare context 6–9 ms + extensions 8–13 ms alone; 2.1–2.7 s in the join: contention in the shared GPU process (both pages, one browser) | finding |
| Lazy-load GameScreen out of the entry | entry is 272 KB min: react-dom 64%, react-router 12%, GameScreen's tree ~40 KB min (~10 KB gz): ~2–3% of the throttled phone's 657 ms; adds a blank-game-page failure mode | rejected (bytes measured) |
| Lobby's garden from the copy (commit 6) | join click → joiner's first frame −45% (4 pairs, not called) | **kept** |

### Final review round (6 read-only reviewers on the diff, 05:20–05:40Z)

Blockers found and fixed (commit 291b7f6): CaptureFx disposed the burn glaze's material (a relink per capture on the landing preview, and before warm-up in a game). Leaks found and fixed (commit e9cd8b6): labels' userData and marks' dep-less invalidate still drew frames for no-op Board renders; OrbitControls' damping tail moved the camera ~1e-5 u on every later frame, disabling the garden's copy after any orbit.

New ideas, not tried (next run):

| Idea | Where | Estimate | Risk |
| :-- | :-- | :-- | :-- |
| One mark program per kind (MARK_KIND define): every quiet/trace mark pays the check crown's and capture's code in software | scene/markers.tsx:117/129/149 | estimated 7–13 ms; **measured** (page probe, a selection with 18 marks): 143.8 → 140.1 ms (−2.6%), 0 bytes differ | **rejected**: +3 programs to warm at idle (~0.45 s main thread in software) for 2.6% |
| Glass without its entrance code once built (GLASS_BUILD define) | scene/plates.tsx:125,150,372 | 3–6 ms of 11–19 ms glass | 1–2 programs; rim's customProgramCacheKey |
| Glaze: light directions as uniforms; check block only in kings | scene/pieces.tsx:164–166,219 | 5–10 ms of ~45 ms piece fragment | ≤1 LSB; a king variant to warm |
| Take the copy on the frame the camera comes to rest (not the second) | scene/backdropCache.tsx | the first click after an orbit gets a cached frame | one copy per moving frame (check orbit fps) |
| Cache the static pieces too (depth-only pre-pass) | backdropCache | −20–40% more per frame at rest | high: depth exactness, Board names dynamic pieces |
| One WebGL context from lobby to game | LobbyCanvas / GameCanvas | no second context + most links on join | high: __r3fState, lazy chunks, handover |
| Allocation-free signature | backdropCache.tsx | the +0.25 ms render() | low |
| Bench count: garden frames per mode per ply (plain/capture/cached) | bench-browser.mjs | guards the cache against a future per-frame garden uniform | none |
| `alpha: false` (#7) would break the copy (RGB canvas → RGBA texture copy is invalid) | — | — | note on #7 |

## Run 20261001-0352 (perf-iteration, base 7f1e93c)

Ideas from 13 read-only reviewers (one per lens), each claim checked against the code before entry. EV order within each group; correctness and visibility first.

| # | Idea | Moment / kind | Lens | Claim checked | Status |
| --: | :-- | :-- | :-- | :-- | :-- |
| R1 | The replay applies any move from an occupied square: an opponent can move your pieces or jump across the board (devtools); check side and legality in `deriveHistory` | correctness | security | history.ts:136-153 applies `moveFromMessage` unchecked (read) | **rejected (scope)**: README "Scope and trust assumptions" trusts all clients ("a modified client could submit illegal moves… the threat model is 'my friends'"). Measured anyway: with `generateLegalMoves` replay ×2–5 (`ab-r1-legal-list.md`); with a new allocation-free `Board.isLegalMove`, within noise (3,000 plies −3%, 98 plies +22% uncalled; `ab-r1-legal-move.md`), +48 engine lines, exhaustive agreement test. Patch kept: `patches/replay-legality.patch`. Needs a decision |
| R2 | `requestIdleCallback` is missing on Safari/iOS: the piece set's preload silently does nothing and the whole set builds in the first board frame; fall back to a timeout per piece | first board frame (iOS) | visibility | set.ts:867, occlusion.ts:311 return early without rIC (read); MDN BCD 8.1.3: Safari flag only, iOS none | **kept**: one preload (`preloadBakedSet`, build+bake per task) with a 50 ms timer where rIC is missing; −`preloadPieceSet`. Safari path A/B (`BENCH_NO_IDLE_CALLBACK=1`, 3 pairs, `ab-r2-no-idle-callback.md`): joiner's first frame 10.4 → 6.0 s and its long tasks −50% (every pair, not called: cold-link noise); creator’s first frame +13% (called worse; both pages share one VM). Normal path A/B (3 pairs, `ab-r2-normal-path.md`): 1 better (join page −6.4%), 0 worse |
| R3 | Take the garden's copy in one trailing frame after the camera rests, not in the next click's frame | selection / landing after an orbit | reuse, visibility | CameraControls stops asking frames when update() reports no change (read) | **rejected**: built (one trailing frame from `scene.onAfterRender`, bounded so a self-changing garden can't loop; patch `patches/trailing-copy.patch`). A/B 3 pairs (`ab-r3-trailing-copy*.md`): 0 better, 0 worse; with the new garden-mode count, base already drew the first click after a turn from the copy 10 of 12 times (other frames after an orbit take it), head 12 of 12. Too rare to pay +20 lines and a frame after every camera stop |
| R4 | Open the WebSocket from index.html; the hook adopts it | reopen first screen, start page ready | I/O | socket opens in App's passive effect after the entry runs (read); final-AB: navigation → game_state 216 of 237 ms | open |
| R5 | Knight sculptor, SDF, decimation and the occlusion fallback ship in the lazy chunk but only run for qualities/paths the game never takes | bytes (lazy chunk), code | dead code, visibility | set.ts:505 picks the builder at runtime (read) | **kept** (sculptor half): `pieceSet()` is the game's medium set only; `pieces/sculpted.ts` (gallery, benches, tests) sculpts the other qualities. Scene chunk 975,388 → 959,858 B (−15.5 KB min, −5.7 KB gz); golden hashes unchanged. Occlusion fallback (~195 lines) left in place: reached only by a stale bake, which `occlusionData.test.ts` already fails |
| R6 | Tailwind serves only ErrorBoundary, main.tsx's body classes and `sr-only`; replace with ~25 lines of CSS, drop 3 deps | bytes (render-blocking CSS on `/`), code | interface, dead code | index.css:1 imports all of Tailwind (read) | open |
| R7 | r3f 9.1.2 → 9.8 (sync root configure, reconciler microtasks) | move landing, selection | what's new | Canvas renders via `async run(){await configure}` in 9.1.2 (read) | open |
| R8 | Glaze light rig (key/fill/kick) as per-frame uniforms, same programs | every frame with pieces | hot paths | pieces.tsx:164-166 per fragment (read) | **rejected**: built (uniforms aimed in the material's onBeforeRender, test against `transformDirection(camera.matrixWorld)`; `patches/light-rig-uniforms.patch`). A/B 3 pairs (`ab-r8-light-rig.md`): 0 better; orbit +3%, orbit with a knight held +14% (not called); mover's first frame +48% (1.17 2.04 1.36, not called). SwiftShader seems to hoist or hide the per-pixel rig: no gain this bench can see |
| R9 | Quiet marks' quads sized to their own radius unless stacked | selection | hot paths | markers.tsx:291 `widest` took QUIET_STACKED whether or not the mark is soft (read) | **kept**: quad (0.2·1.25+0.1)·2 = 0.70 instead of 1.03 unless the mark is the stacked soft pool (2.1× fewer fragments). A/B 3 pairs (`ab-r9-quiet-quads.md`): desktop orbit with a knight held +24% fps (called better), click → piece held −13% (every pair, not called); desktop orbit with nothing held −13% (called worse: no quiet mark exists there, so drift: these rows' false-call rate); phone with a knight −5% (not called) |
| R10 | Glass without its entrance code once built (GLASS_BUILD) | every frame | hot paths | carried from last run; +1 program to warm | open |
| C1 | Test: every retired mark material's program is in WarmPrograms | check | derive, enforce, can't-fail | no test ties the 11 `useRetireOnUnmount` sites to warm.tsx (read) | **kept** as an e2e check of the real thing: the canvas carries `data-warm="done"` after the warm-up; `e2e/programs.spec.ts` (full motion) picks a piece up and plays a capture, check and mate, and fails on any program linked after it. Under reduced motion it could not fail (no burn, no shimmer): the mutation (outline left out of the warm-up) passed; in full motion it fails (program 41). 50 s locally |
| C2 | Test: the real Stage's garden signature is equal frame to frame at rest; every garden material is a ShaderMaterial | check | can't-fail, enforce | backdropCache tests drive a fake sky only (read) | **kept**: two tests on the real Stage (signature equal 90 frames apart at rest; every garden material a ShaderMaterial with no texture uniform); mutation (a garden uniform + 1e-9·random per frame) fails it |
| C3 | Build guard: no three.js / r3f module in the entry chunk | check | enforce | no check today (read) | **kept**: `keep-scene-out-of-entry` build plugin walks the entry's static graph; adding `import { Vector3 } from 'three'` to main.tsx fails the build |
| C4 | Bench: record each frame's garden mode (plain/capture/cached) | visibility | visibility | bench wraps gl.render already (read) | **kept**: every recorded frame carries its garden mode; select reports "first frames that drew the garden in full" and a pick after a turn of the view. First use found the claim behind R3 mostly false |
| C5 | primary.mjs fails on a missing primary row (`--quick` silently drops the H = 2000 row) | visibility (loop tools) | derive | substring fallback, no warning (read) | **kept** (loop tools): exact keys, exit 1 naming the missing rows |
| C6 | bench/run.mjs rejects unknown flags and tiers | interface | interface | `--only clinet` rewrites RESULTS.md empty (read) | open |
| C7 | One FOV constant and one fit function shared by the game and `gameOpening` | code, check | derive, enforce | 36 in six places (read) | open |
| R11 | Dedupe `scheduler` (0.26 top level, 0.25 nested twice under r3f and react-reconciler) | bytes (lazy chunk) | dependencies | package-lock: three copies, all imported (read) | **kept**: `resolve.dedupe: ['scheduler']`; scene chunk −8.1 KB min, −2.9 KB gz (after R5: 959,858 → 951,725 B); entry +8 B |
| R12 | Replace react-router (3 routes, 1 layout) with a small router | bytes (entry) | dependencies | ~33 KB min of a 272 KB entry (last run's measure) | open (low EV: ~2% of the phone row; 6 test files use MemoryRouter) |
| P5 | One variable Manrope (24.8 KB) for three static weights (42.4 KB) | bytes (fonts on `/`) | dependencies | main.tsx:6-8 (read) | parked: glyphs change, a design call |
| N3 | r3f 9.8 needs scheduler ^0.28 (React 19.3: +19 KB gz on the entry); 9.7 + React 19.2 is the coherent bump (+3 KB gz entry) | — | dependencies | registry metadata (reported) | R7 narrowed to 9.7 + 19.2, a trade-off to measure |
| P1 | Seat token (rejoin needs only the link today), gameId pattern, per-socket rate limit, ply cap | security | security | modal_app.py:429-478 (read) | parked: protocol change, needs a decision |
| P2 | `_headers` for Cloudflare Pages (immutable assets, CSP, no-referrer) | repeat visits, security | security | no `_headers` (read) | parked: verify production headers first |
| P3 | Reconnect at once on `online` / tab visible | interface | interface | no listeners in useGameSocket (read) | open (small) |
| P4 | Tap jitter turns the camera (OrbitControls moves before the slop) | interface, frame cost on phones | interface | tap.ts slop 6 px vs OrbitControls moving on every pointermove (read) | open (needs device check) |
| N1 | Shimmer frames with the pulse off the line (#3 of last run) | — | hot paths | every move ≥ 1 unit, the pulse window 0.78 + spacing 1.8: never empty | rejected on reading |
| N2 | three r176 → r186 | — | what's new | nothing touches fragment cost or links | rejected on reading |
| B1 | create → share link shown: a regression from #55? | creator's wait for the link | bisect | **root-caused, not a regression**: the creator's lobby links 4 shader programs after the pick (5 since #56: the garden copy), each waiting 0.1–1.1 s on the GPU in software; the link waits for the glide that those frames carry. 0.8–2.9 s on one build; 6 v 6 interleaved setups, #55 vs #56: medians 1680 vs 1803 ms (`share-link-trace/README.md`). The 2-pair calls (+79%, +108%) read that spread | open as L1 |
| L1 | Warm the lobby's post-pick programs (selection column, floor, motes; landing band; garden copy) while the side choice waits for a click | creator's wait for the share link | root cause of B1 | 4–5 links, 0.5–2.1 s of GPU waits per pick in software (traced) | open: next run's first item |

## Run 20261009-0411 (perf-breakthrough, base bf2c46d)

Ideas from 12 read-only reviewers (one lens each), checked against the code before entry. EV order; "verify" where the claim needs data.

| # | Idea | Moment | Lens | Claim checked | Status |
| --: | :-- | :-- | :-- | :-- | :-- |
| B0 | The browser bench is broken on main: setup can't find "Play a friend →" (CSS arrow in the name), so setup + move latency have no rows; the knight shuffle is a draw by repetition at ply 8 since #64 (move latency stops, reopen opens finished games) | measurement | scaling, build, what's new | reproduced: setup failed in 2 of 2 runs (`locator.click` timeout); `draws.ts` REPETITIONS = 3 (read) | **kept** (f730ab2): generated quiet long game `client/bench/longGame.ts`, pinned by a test |
| T1 | Keep the tower's pieces at rest in a copy, sample for sample (own MSAA backbuffer: colour + depth blit), redraw only pieces that changed + a scissored repair | move landing, shimmer frames, selection after rest | bespoke, removable, memory | pieces ≈ 100 of ~130 ms per frame at rest (run 20260930 profile, reported); shimmer invalidates every frame (markers.tsx:637, read) | **rejected (bet 1 died)**: the exact form is impossible in WebGL2 (ES 3.0 forbids a multisampled draw framebuffer in blitFramebuffer: the prototype's restore did nothing); the depth-only form (resolved colour copy + the pieces' depth redrawn by a colour-less twin) saved 25% of a frame (92–98 vs 124–133 ms) with silhouette pixels off by up to 52; `patches/tower-depth-only.patch` |
| T2 | The idle "last move" frames spend 325 ms of main thread *inside* render() (RESULTS 2026-10-08; 2.35 ms on 2026-09-29) | move landing (both pages draw shimmer frames) | vectorization, memory, boundaries | measured in RESULTS.md (reported);  | **not reproduced**: on the fixed bench's baseline render() is 3.05 ms in that row; the idle windows' GPU load (380% on an idle page) is the warm-up's programs still compiling, a bench-timing artifact (a lone page at rest: 0%) |
| S1 | Open the socket (and send the first message: rejoin / look) from an inline script in index.html; the hook adopts it | join navigation → Join button; reopen → record shown; start page "socket open" | parallelism, I/O, boundaries, build | socket opens in App's passive effect (useGameSocket.ts:116, read); nav → game_state 185 of 208 ms at H = 2000 (measured, fixed bench) | open: bet 2 |
| G1 | Lean glaze: compile the haze/focus block (pieces.tsx:260) and the check block (:269) out when unused (SwiftShader runs untaken branches) | move landing, orbit (not selection: focus active) | vectorization, numerical, correctness | blocks behind uniform ifs (read); FORM/CUT precedent −12…−19 ms/frame (measured, run 20260930) | open |
| G2 | GLASS_BUILD: the glass's entrance blocks compiled out once built (R10) | every frame | vectorization, removable | `uBuild < 1.0` blocks plates.tsx:128,153 (read) | open |
| J1 | Join: the joiner's first frame is 5–19 s with 41–52 program links in the window; link the lobby's programs ahead (LobbyCanvas has no linkBeforeFirstFrame), mount the game canvas early (ledger #1), share garden geometry across canvases | first board frame | parallelism, boundaries, memory | LobbyCanvas onCreated = setUpRenderer only (read); joinStart up to 1.2 s after click (measured: the click waits behind the lobby's first render) | open |
| M1 | MoveCard: one text node per row instead of five | reopen (record shown) | scaling | MoveCard.tsx:44 (read); handled→shown 22.5 ms at H = 2000 (measured, fixed bench) | open (small: ~10% of the row at most) |
| P1 | `pow(x,2.0)` → `x*x` etc. (ledger #8) | raster | numerical | many sites (read) | open (ulp changes) |
| P2 | Opaque sort front to back (`setOpaqueSort`: three sorts material id before z) | raster on real GPUs | removable, vectorization, bespoke | WebGLRenderLists.js:11 (read); SwiftShader has no early-Z without EarlyFragmentTests (reported) | open (bench can't see it) |
| P3 | V8 compile hints (`//# allFunctionsCalledOnLoad`) on the scene chunk | first board frame, reopen | what's new | Chrome 136+ (reported, v8.dev 2025-04) | open (verify: works for module scripts?) |
| P4 | Animation steps capped at 1/20 s: eases take 4–14 software frames | frames after a pick | removable | focus.ts:55 etc. (read) | parked (visible in software only; a design call) |
| P5 | Piece LOD / fewer triangles (3–5k a piece, ~1 px² each) | raster | memory, numerical | pieces.test.ts cap 5000 (read) | parked (changes pixels, golden hashes) |
| P6 | Computer game replays the whole game ~4× per move | computer moves | scaling | computerGame.ts:111 (read) | open (no primary row) |
| P7 | Per-route modulepreload lists, preload before the stylesheet, low priority | real phone networks | build, I/O | vite.config.ts:17-56 (read) | open (bench on localhost can't see it) |
| P8 | Server: one modal.Dict call per move (write-through copy) | production move echo | I/O, boundaries | modal_app.py:190 (read) | parked (container overlap on deploy: verify) |
| S1′ | (S1 as built) the page's socket from index.html | join page, reopen | — | — | **kept** (2d1d40d, fix 0afb606): Join button −38%, reopen record shown −41% with M1 (A/Bs in `ab-20261009-early-socket*.md`) |
| M1′ | (M1) one text node per move-list row | reopen | — | — | **kept** (c2253ee): with S1, the reopen's longest task −10% (was +15% with S1 alone) |
| J1′ | (J1) the lobby links ahead of its first frame | join | — | — | **rejected**: creator's first frame −41% (called) but the joiner's +17% (not called; pairs 1.21 0.71 1.02 2.14), its longest task ×2; `patches/lobby-link-ahead.patch` |
| G1′ / G2′ | lean glaze; glass without its build blocks | every frame at rest | — | — | **rejected on measurement** (`surgery.mjs`): −5% / −3% of a frame, each costing 1–3 programs to warm (cf. MARK_KIND) |
| F1 | Reuse programs across canvases through byte-identical sources (Chromium's program cache is per GPU process) | join, first frame | final review | lobby and game garden sources: verify identical; verify the cache works under SwiftShader | open |
| F2 | `content-visibility: auto` on each move-list block | reopen | final review | MoveCard blocks (read) | open |
| F3 | Parse the early socket's messages as they arrive (before the entry runs) | reopen | final review | useState initialiser parses them now (read) | open (small) |
| F4 | A reopened game's record from a local copy (localStorage), the server's replacing it | reopen | final review | — | parked (a design call: a record shown before the server confirms it) |
| F5 | Bench: wait for `data-warm="done"` before the idle and move windows | measurement | final review | idle windows met the warm-up's compiles (measured, this run) | open |
| F6 | Vite 7 / `build.target` baseline-widely-available | bytes | final review | Vite 6 here (read) | open (< 1%) |


## Run 20261009-1606 (perf-iteration, base 454bd45)

Ideas from 13 read-only reviewers (one per lens), each claim checked against the code before entry (checked = I read the cited lines). EV order within each group; correctness and visibility first.

| # | Idea | Moment / kind | Lens | Claim checked | Status |
| --: | :-- | :-- | :-- | :-- | :-- |
| H0 | `bench/run.mjs --base` symlinks this checkout's node_modules and venv into the base worktree: an A/B across a dependency bump times the head's packages on both sides, silently | measurement | (found in setup) | run.mjs:690-691 (read) | **kept** (92d7d73): the regression A/B across #111/#112/#114 installed both sides' own packages |
| V1 | The "click → first frame with the piece held" primary row takes the first frame begun after a time read *before* `mouse.click` (move, press, release): a hover frame (the piece lifts on hover) can be timed instead of the selection's, with no check | measurement (primary row) | visibility | bench-browser.mjs:1466-1471 (read); move latency has such checks | **kept** (355236d): 0 of 32 picks had a hover frame first (the row was right), but 1 run of 5 drew no frame after a click (selected nothing), which the old code would have timed; such a click is now counted in its own row and left out of the times (ff01097) (`probe-20261009-select.md`) |
| U1 | Board remounts (each tutorial step: `boardKey`; each pass of the start page's demo) dispose the glass, rims, glaze and label sprites: their programs drop to 0 users and relink in the next frame | tutorial step, start page demo | reuse | plates.tsx:483-489, pieces.tsx:470, smartLabels.tsx sprite (r3f disposes), LearnScreen boardKey (read); verify: links per step | **kept** (4d9d855): tutorial step 4 programs and a median 342 ms of long tasks → 0 and none (`probe-20261009-learn-links.md`); start page: no relink seen in 90 s on either side (not confirmed); guard in learn.spec.ts |
| D1 | Dead code: `blendPose`/`mixPose`/local `easeInOutCubic` (lobbyMotion.ts, tests only since #70), `useHeld`/`subscribeHeld` (claims.ts, no caller), `motion.ts` `easeInOutCubic` (no importer), `Ctx.quality` (set, never read) | code | dead code | grep: no other users (checked) | **kept** (55e141d): −88 lines |
| E1 | Lint: only GameCanvas assigns `__r3fState`; wire types never from `schema.ts`; no `setTimeout`/`setInterval`/`Date.now` in `three/` (4 legitimate sites annotated) | enforce | enforce | eslint.config.js has no restricted rules (read) | **kept** (c011de5), mutation-tested |
| E2 | `keep-scene-out-of-entry` walks only the entry: also from LearnScreen/ComputerGameScreen's chunks, and forbid the search (`ai/` but levels/computer) in the entry | enforce | enforce | vite.config.ts:138-163 (read) | **kept** (c011de5), mutation-tested |
| E3 | test_store_ops: every `store`-first function in STORE_OPERATIONS; AST walk instead of substring blacklist; no `.aio` | enforce | enforce | test_store_ops.py:221-242 (read) | **kept** (e8865d5), mutation-tested |
| S1 | Deploy with `modal deploy --strategy recreate`: the default rolling deploy lets the old container keep live sockets up to an hour while new sockets go to the new one (`connections` is per process: moves recorded but not relayed; two event loops on one Dict) | correctness (production) | concurrency | ci.yml deploy step has no strategy (verify modal 1.6.1 CLI) | split out to PR #118 (not merged): a production behaviour change, the owner's call |
| S2 | Game id checked (`[A-Z0-9]{6}`) in the store operations before any `store.get`; optional frame-size cap | security | security | schema gameId is a bare string; earlySocket sends any `/game/<x>` (read) | open |
| S3 | ARCHITECTURE.md / modal_app.py say records expire after ~30 days; modal 1.6.1's Dict docstring says 7 days of inactivity for Dicts created after 2025-05-20 | docs truth | security | modal/dict.py docstring (reported by reviewer; verify) | open: verify the Dict's creation date (`modal dict list`) before changing the docs |
| V2 | WebGL unavailable → r3f rethrows → root ErrorBoundary replaces the whole app (start page included); Chrome removed the SwiftShader fallback (~143) | visibility | visibility | ChunkBoundary rethrows non-chunk errors (reported; verify) | **kept** (9e45471): reproduced (`--disable-webgl`: "Something went wrong" on /, /learn, /computer); now the scene is left out, a game plays by the move box; e2e/noWebGL.spec.ts |
| V3 | A/B: a row missing on one side counts as "unchanged" and prints NaN; samples lost to NaN are invisible (`metric` has no n) | visibility (bench) | visibility | run.mjs:841, 849 (reported) | **kept** (967c219, + ab2jsonl keeps one-sided rows) |
| V4 | Computer player: worker failure / search exception fall back silently (first legal move), a dead worker never answers | visibility | visibility | computer.ts:84-100, useComputerGame.ts:120 (reported) | open |
| V5 | Repeated 1011 closes show as endless "Reconnecting" | visibility | visibility | useGameSocket.ts:218-229 (reported) | open |
| I1 | A half-open socket after a phone wakes: a sent move never echoes, the board stays disabled, status says connected | interface | interface | no heartbeat (reported) | open |
| I2 | bfcache: Chrome 149+ closes sockets on cache entry; restore waits 500 ms backoff showing "reconnecting"; close in pagehide, reconnect in pageshow | interface | concurrency | useGameSocket onclose (reported) | open |
| I3 | `overscroll-behavior: none` (pull-to-refresh mid-game); start page lacks the touch guards; body colour gray-900 vs pages' near-black | interface | interface | 0 hits for overscroll (reported) | open |
| C1 | One `VIEW_FOV`, one game fit window shared by GameCanvas, `gameOpening`, the bench (`openingCamera` has drifted: no sweep/inset/clamp) and the tests (ledger C7) | derive | derive | interaction.bench.ts:41-53 (reported) | open |
| C2 | Test the TS copies of CSS values (HUD_TOP_PX, 480 px breakpoint, landing clamps) against index.css | derive | derive | ~20 comments cite CSS (reported) | open |
| C3 | Close code 4001 defined on both sides; gameId 5 bare strings in schema.json | derive | derive | (reported) | open |
| T1 | backdropCache "garden at rest" test never advances r3f's clock: a `uTime = clock.elapsedTime` garden uniform would pass | check that can't fail | can't-fail | (reported; verify) | open |
| T2 | No test that the board asks no frames at rest (an ease that never lands redraws forever) | check | can't-fail | (reported) | open |
| T3 | history work guard never sees a log with a snapshot, nor GameScreen dropping `historyRef` | check | can't-fail | (reported) | open |
| T4 | programs.spec cannot see a dispose-instead-of-retire after warm-up (keepers hold the program); the start page has no WarmPrograms | check | can't-fail | warm.tsx:80-83 (read) | open |
| T5 | Engine work guards miss the outward attack scan and isCheckmate's early stop | check | can't-fail | (reported) | open |
| M1 | Three copies of the piece set's vertex data per page (raw parts, baked clone, merged); fuse bake into merge (~1.5 MB) | memory | memory | (reported; ledger #11) | open |
| M2 | Bench heap row reads only the V8 heap: add `backingStorageSize` (typed arrays) | visibility (bench) | memory | (reported; verify field) | open |
| M3 | Clear `window.__r3fState` when the game canvas unmounts (stale state passes e2e's wait; retains the old root) | memory, e2e hazard | memory | GameCanvas.tsx:110 sets, nothing clears (read) | **kept** (55e6627) |
| R2 | Garden geometry cached across canvases (attributes at module level, wrappers per canvas) | first board frame (real GPUs) | reuse, memory | (reported; verify ms) | open |
| P1 | Preload script injected after the stylesheet (waits for it): the scene chunk's preload starts one RTT late on mobile networks (ledger P7's cause) | first board frame, mobile | concurrency | vite.config.ts:51-56 order 'post' (reported) | open |
| P2 | Spawn the computer's worker during the entrance | computer's first move | concurrency | (reported) | open |
| X1 | Drop Tailwind (R6) | bytes | dead code | (reported) | open (R6) |
| X2 | Occlusion ray-caster out of the shipped chunk (bake throws on a stale bake instead) | bytes | dead code | (reported) | open |
| X3 | Rejected on reading: keep the search's table between moves (blind spots are redrawn per turn; unsound), cache legal moves/history (µs) | — | reuse | — | rejected on reading |
| F7 | The page painted white until main.tsx set the body's classes (no CSS on body) | first paint, slow phones | dependencies | main.tsx:11 (read); with scripts blocked base body = transparent (measured) | **kept** (2df6d01): `@apply` in index.css |
| A1 | Hard's search: don't start an iteration predicted to overrun (a stopped one is thrown away and the page waits) | computer's move | hot paths | search.ts:183 (read) | **rejected** (`probe-20261009-ai-iterations.md`): growth-ratio prediction −315 ms a move but shallower in 11 of 40 positions (3 moves differ); a ×2 floor keeps depth but saves nothing |
| W1 | A pick in the first seconds after the entrance waits 2–3 s (SwiftShader) on the warm-up's links: the select section's first pick is 3.2–4.7 s, 107–388 ms once `data-warm` is done | first selection | (found measuring V1) | measured, `probe-20261009-select.md` | open: next run's first item (bench: F5 + a "first pick" row; app: order or split the warm-up so the selection's programs are ready first) |
| B2 | create → share link shown +22% (1.63 → 1.93 s, every pair) since the last run | creator's wait | regression | A/B 454bd45 vs 89e9cd9 | **closed, not reproduced** on #116's harness (one page against a socket): #114 alone 1.73 → 1.60 s, #100/#111/#112 1.86 → 1.64 s, neither called (`ab-20261009-1606-bisect-*.md`); the +22% came from the old two-page harness |
| N1 | Keep a game alive (React 19.2 `<Activity>`, r3f 9.8 keeps a hidden Canvas root) while its tutorial is open: the return is a frame, not a reopen | return from /learn mid-game | what's new | r3f 9.8.1 source (reported) | open (a design call: two contexts on phones) |
| N2 | `build.chunkImportMap` (Vite 8.1, experimental) + three in its own chunk: the scene chunk's hash survives deploys that don't touch it | repeat visits | what's new | vite 8.3.4 index.d.ts (reported) | open |
| N3 | Poll `KHR_parallel_shader_compile` completion in linkAhead on real GPUs | first board frame (devices) | what's new | bench can't see it | parked (unmeasurable here) |
| N4 | pointerEvents.ts unneeded after r3f 9.8's synchronous configure | code (−45 lines) | dependencies | (reported) | open (verify leaving / and /learn at once on a slow renderer) |
| N5 | Tailwind generates ~60% false-positive utilities; `source(none)` + `@source` | CSS bytes | dependencies | (reported: 2.27 of 9.9 KB gz) | open (R6's lower-risk half) |
| N6 | `React.memo(GameCanvas)` + latest-ref callbacks: a presence message reconciles the whole scene (~1.8 ms) | non-board messages | hot paths | (reported) | open (low) |
| N7 | Hit proxies measured per colour though both draw the same geometry | first board frame | hot paths | PieceMesh.tsx:85-123 (reported) | open (low) |
| Q1 | #116's "start page answers its first click" is bimodal (each click ~15 ms or ~3.4 s, the first of a run always slow; 8 v 7 slow in 20 on two identical-path sides), which swings the suite's one-number primary speed between ×0.65 and ×1.29 on noise | measurement | (found verifying on #116) | ab-20261009-1606-primary-on-116.md, -recheck-on-116.md (measured) | open: make the row stable (click once the preview's first frame is drawn, or report both modes) or leave it out of the geomean |
