# 3D Chess Online Multiplayer v1.0 — TODO Checklist

---

## Phase 0 – Project Bootstrap

### 0-A Repo & CI skeleton

- [x] `git init`
- [x] Add `README.md` (project title + one-sentence description)
- [x] Add `LICENSE` (MIT)
- [x] Add `.github/workflows/ci.yml` that checks out code & echoes "CI pipeline online"
- [x] Commit: `chore: repo bootstrap & empty CI`

### 0-B Vite + React + ESLint/Prettier

- [x] Scaffold frontend: `npm create vite@latest` → React + TS → `client/`
- [x] Install & configure ESLint (AirBnB + TS) and Prettier
- [x] Add `husky` + `lint-staged` pre-commit hook to run `eslint --fix` & `prettier --write`
- [x] Update CI to install Node 20 and run:
  - `npm ci`
  - `npm run lint`
  - `npm run build`
- [x] Run `npm run lint` locally
- [x] Commit: `chore: Vite React template, ESLint, Prettier, CI lint stage`

### 0-C Vitest + React Testing Library

- [x] Install `vitest`, `@testing-library/react`, `user-event`, `jest-dom`
- [x] Configure `vitest.config.ts` for JSDOM
- [x] Create `src/App.test.tsx` smoke test for "Vite + React" heading
- [x] Add `test` script to `package.json`
- [x] Update CI to run `npm run test -- --coverage`
- [x] Run tests locally
- [x] Commit: `test: vitest + RTL smoke test`

### 0-D Playwright smoke E2E

- [x] Install `playwright` and run `npx playwright install chromium`
- [x] Create `e2e/homepage.spec.ts`:
  - Launch dev server on 5173
  - Assert page title includes "Vite + React"
- [x] Add `e2e` script: `playwright test`
- [x] Update CI to run Playwright headless after build
- [x] Commit: `test(e2e): Playwright bootstrap`

### 0-E Three.js placeholder

- [x] Install `three`, `@react-three/fiber`, `@react-three/drei`
- [x] Replace `src/App.tsx` with a `<Canvas>` spinning cube example + orbit controls
- [x] Add minimal lighting
- [x] Update `App.test.tsx` to assert presence of the canvas (`data-testid="r3f-canvas"`)
- [x] Run unit & e2e tests
- [x] Commit: `feat(ui): Three.js spinning cube scaffold`
- [x] Update `.gitignore` for test/build outputs

### 0-E-1 Attack map builder

- [x] Implement `findKing(color)` and `isSquareAttacked(target, byColor)` with unit tests
- [x] Implement `inCheck(color)` (uses king locator + attack map) with tests
- [x] Create `generateLegalMoves(color)` that filters out moves leaving king in check
- [x] Add `isCheckmate(color)` & `isStalemate(color)` (with helper `hasLegalMove`)
- [x] Write 3D-specific scenario tests (corner mate, 3D Fool's-mate fail, stalemate box)
- [x] Commit: `feat(engine): check, mate, stalemate detection`

---

## Phase 1 – Core Rules Engine

### 1-A Coordinate helpers

- [x] Create `src/engine/coords.ts` with:
  - `Coord` type
  - `toZXY()` & `fromZXY()` functions
  - `LEVELS`, `FILES`, `RANKS` constants
- [x] Add `coords.test.ts` for round-trip and spec examples
- [x] Run coverage
- [x] Commit: `feat(engine): coordinate converters with tests`

### 1-B Piece & move-vector enums

- [x] Add `src/engine/pieces.ts`:
  - `enum PieceType`
  - `interface Piece`
  - Movement-vector constants for R, B, U, N, Q, K
- [x] Tests verifying vector counts (e.g. knight = 24)
- [x] Commit: `feat(engine): piece definitions & movement vectors`

### 1-C Generic move generation

- [x] Create `src/engine/board.ts` with `Board` class:
  - 5×5×5 `grid`
  - Constructor for starting setup
  - `isInside()`
  - `generateMoves()` for sliding & knight
- [x] Tests: rook rays, knight moves, boundary enforcement
- [x] Commit: `feat(engine): base move generation (non-pawns)`

### 1-D Pawn logic & promotion detection

- [x] Extend `generateMoves()` for pawn rules (§2.5)
- [x] Implement `applyMove(from, to, promotion?)`
- [x] Tests: forward/up moves, captures, promotion at (x,4,4)/(x,0,0)
- [x] Commit: `feat(engine): pawn moves & promotion`

### 1-E Check / checkmate / stalemate

- [ ] Add `findKing(color)` and `isSquareAttacked(target, byColor)` with unit tests
- [ ] Implement `inCheck(color)` (uses king locator + attack map) with tests
- [ ] Create `generateLegalMoves(color)` that filters out moves leaving king in check
- [ ] Add `isCheckmate(color)` & `isStalemate(color)` (with helper `hasLegalMove`)
- [ ] Write 3D-specific scenario tests (corner mate, 3D Fool's-mate fail, stalemate box)
- [ ] Commit: `feat(engine): check, mate, stalemate detection`

### 1-F Coverage & public API barrel

- [ ] Create `src/engine/index.ts` exporting public API
- [ ] Enforce Vitest coverage ≥ 95 %
- [ ] Commit: `chore(engine): barrel export & coverage gate`

---

## Phase 2 – Backend Skeleton on Modal

### 2-A FastAPI scaffold

- [ ] Create `server/modal_app.py` with `FastAPI` + `modal.Stub(concurrency_limit=1)`
- [ ] Add `/health` route
- [ ] Create `requirements.txt`
- [ ] Dev script: `uvicorn modal_app:app --reload`
- [ ] Pytest for `/health` using `httpx`
- [ ] Commit: `feat(server): FastAPI health endpoint under Modal`

### 2-B Pydantic models from JSON Schema

- [ ] Add `server/schema.json` (WebSocket schema)
- [ ] Generate `messages.py` via `datamodel-code-generator` (or manual)
- [ ] Tests: validate sample envelopes
- [ ] Commit: `feat(server): pydantic models for WS schema`

### 2-C create_game handler

- [ ] Add `/ws` WebSocket endpoint
- [ ] Handle "create_game" → generate UUID, store in-memory, reply "game_created"
- [ ] Pytest with `websockets` client for round-trip
- [ ] Commit: `feat(server): create_game flow`

### 2-D join_game & game_start

- [ ] Handle "join_game": add second connection, randomize colors, send "game_start"
- [ ] Track `turn` state
- [ ] Pytest: two clients receive complementary colors
- [ ] Commit: `feat(server): join_game & game_start`

### 2-E move → move_made relay

- [ ] Accept "move" only from correct-turn player
- [ ] Broadcast "move_made" and flip turn
- [ ] Send "error" on wrong-turn
- [ ] Pytest: validate relay & error
- [ ] Commit: `feat(server): move relay with basic validation`

### 2-F Server coverage & CI

- [ ] Add `pytest --cov=server` to CI
- [ ] Enforce ≥ 90 % coverage
- [ ] Commit: `chore(server): coverage gate`

---

## Phase 3 – 3D Board MVP

### 3-A 5×5×5 grid rendering

- [ ] Create `client/src/three/Board.tsx` rendering 125 cubes
- [ ] Parent group with `data-testid="board-grid"`
- [ ] Update `App.test.tsx` to assert 125 meshes
- [ ] Commit: `feat(ui): render empty 5×5×5 grid`

### 3-B Placeholder piece meshes

- [ ] Add `PieceMesh.tsx` with simple geometries per piece type
- [ ] Prop types: `type` and `color`
- [ ] Snapshot tests
- [ ] Commit: `feat(ui): placeholder piece meshes`

### 3-C Orbit controls & responsive canvas

- [ ] Add `<OrbitControls makeDefault />`
- [ ] Implement `useWindowSize` hook for full-window canvas
- [ ] Commit: `chore(ui): orbit controls & responsive canvas`

### 3-D Static starting position

- [ ] Import `Board` engine to iterate pieces
- [ ] Render `<PieceMesh>` at correct world coords
- [ ] Test: count 32 piece meshes
- [ ] Commit: `feat(ui): starting position rendered`

---

## Phase 4 – Local Play Slice

### 4-A Raycast selection & highlights

- [ ] Add `useSelectedPiece` state
- [ ] On piece click: compute legal moves & highlight cubes
- [ ] RTL + `@react-three/test-renderer` test for highlighting
- [ ] Commit: `feat(ui): piece selection & highlights`

### 4-B Local move execution

- [ ] On highlight click: call `applyMove`, update state
- [ ] Toggle turn
- [ ] RTL test: mesh relocates & highlights clear
- [ ] Commit: `feat(ui): local move application`

### 4-C Illegal move toast

- [ ] Install `react-hot-toast`
- [ ] Show toast on invalid click
- [ ] RTL test with fake timers for toast
- [ ] Commit: `feat(ui): invalid move toast`

### 4-D Turn indicator

- [ ] Add `TurnIndicator` component showing "White to move" etc.
- [ ] Test: turns flip after moves
- [ ] Commit: `feat(ui): turn indicator synced with moves`

---

## Phase 5 – Online Play Slice

### 5-A `useGameSocket` hook

- [ ] Create hook with `send()` and `lastMessage`
- [ ] No auto-reconnect
- [ ] Test with `jest-websocket-mock`
- [ ] Commit: `feat(ws): socket hook`

### 5-B Start screen & create game

- [ ] `/` route → `StartScreen` with "Create New Game" button
- [ ] On click: send `create_game`, await `game_created`, redirect to `/game/:id`
- [ ] Playwright test: flow from button to game URL
- [ ] Commit: `feat(ui): start screen & create game flow`

### 5-C Join game from link

- [ ] `/game/:id` sends `join_game` on mount
- [ ] On `game_start`: set color & board state
- [ ] RTL test mocking socket for `join_game`
- [ ] Commit: `feat(ws): join game route wiring`

### 5-D Relay moves to server

- [ ] On local move: send `move` envelope
- [ ] Optimistic UI update; reconcile on `move_made`
- [ ] Test: simulate incoming `move_made` updates board
- [ ] Commit: `feat(ws): move relay client side`

### 5-E Cross-tab manual QA

- [ ] Manually test two tabs: create, join, play moves, confirm sync
- [ ] Commit: `docs: cross-tab manual validation OK`

---

## Phase 6 – Game States & UX Polish

### 6-A King in check glow

- [ ] When `inCheck`, set king emissive red
- [ ] RTL test for material property
- [ ] Commit: `feat(ui): king glows when in check`

### 6-B End-game modal

- [ ] After `applyMove`, check for checkmate/stalemate
- [ ] Show modal with result + "Start New Game" link
- [ ] Playwright test: fool's mate triggers modal
- [ ] Commit: `feat(ui): end-game modal`

### 6-C Pawn promotion dialog

- [ ] Detect promotion square moves
- [ ] Show picker for Q/R/B/N/U, then send with `promotion` field
- [ ] RTL test: promote pawn, verify queen mesh
- [ ] Commit: `feat(ui): promotion workflow`

### 6-D Styling pass

- [ ] Install & configure Tailwind CSS
- [ ] Style buttons, modals, banners
- [ ] Commit: `style(ui): tailwind base styles`

### 6-E Accessibility audit

- [ ] Add `aria-label` to meshes (e.g. "White Knight at Bb2")
- [ ] Enable `eslint-plugin-jsx-a11y` rules
- [ ] Run lint & fix violations
- [ ] Commit: `chore(ui): a11y labels & lint rules`

---

## Phase 7 – Hardening & E2E

### 7-A Full Playwright flow

- [ ] `e2e/full_game.spec.ts`: create, join, execute mate, expect modal
- [ ] Commit: `test(e2e): full-game happy path`

### 7-B Coverage gate ≥ 90 %

- [ ] Merge Vitest, Pytest & Playwright coverage in CI
- [ ] Fail if overall < 90 %
- [ ] Commit: `chore(ci): enforce 90 % coverage`

### 7-C OS/Node CI matrix

- [ ] Expand CI to ubuntu/windows × Node 18/20
- [ ] Ensure all tests pass
- [ ] Commit: `ci: OS/Node matrix added`

### 7-D Schema-fuzz tests

- [ ] Use `jsonschema-faker` to generate 100 valid envelopes
- [ ] Feed to WS server in tests; assert behavior
- [ ] Commit: `test(server): schema-fuzz message tests`

---

## Phase 8 – Deployment

### 8-A Modal deploy script

- [ ] Create `modal_deploy.sh` for `modal deploy` (with ENV vars)
- [ ] Document `BACKEND_WS_URL` injection
- [ ] Commit: `ci: modal deploy script`

### 8-B Static site hosting

- [ ] Configure Cloudflare Pages or GH Pages
- [ ] Inject `BACKEND_WS_URL` into Vite build
- [ ] Commit: `ci: static site deploy pipeline`

### 8-C Prod smoke & tag

- [ ] After deploy, run Playwright against prod URLs for full-game flow
- [ ] Create annotated git tag `v1.0.0` on success
- [ ] Commit: `release: v1.0.0 🎉`

---

> Check off items from this list as you land each commit
