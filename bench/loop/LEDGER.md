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
| 10 | Tree-shake fallback piece builders (sdf/decimate/knight) out of the lazy chunk | bytes (preview chunk) | memory | verify in built chunk | open |
| 11 | Fuse build→bake→merge in the piece set (fewer copies) | first board frame | memory | ~46 ms total build, idle callbacks | open |
| 12 | Lazy-load lobby/game screens out of the entry | start page | build config | App.tsx imports them directly (read) | open |
| 13 | Dedupe `scheduler` | bytes | build config | package-lock has 0.25 ×2 + 0.26 | open |
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
| R1 | The replay applies any move from an occupied square: an opponent can move your pieces or jump across the board (devtools); check side and legality in `deriveHistory` | correctness | security | history.ts:136-153 applies `moveFromMessage` unchecked (read) | **rejected (scope)**: README "Non-goals" trusts all clients ("a modified client could submit illegal moves… the threat model is 'my friends'"). Measured anyway: with `generateLegalMoves` replay ×2–5 (`ab-r1-legal-list.md`); with a new allocation-free `Board.isLegalMove`, within noise (3,000 plies −3%, 98 plies +22% uncalled; `ab-r1-legal-move.md`), +48 engine lines, exhaustive agreement test. Patch kept: `patches/replay-legality.patch`. Needs a decision |
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
