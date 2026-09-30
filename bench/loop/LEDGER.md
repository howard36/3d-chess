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
| 4 | Sky: skip its shading where the ground covers it (pixel-identical) | every frame (raster) | numerical | ground opaque, drawn over sky; sky shader has atan/sin/pow (read) | open |
| 5 | Scissored repaint of the tower's rect when the camera hasn't moved (preserveDrawingBuffer) | move landing, selection | bespoke, vectorization | garden depends only on camera + a few uniforms (read) | open |
| 6 | Cache the garden (backdrop) in a render target | move landing, selection | bespoke, numerical | correctness lens: shade gradient, tonemap variants, MSAA, context loss all break it | open (risky) |
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
