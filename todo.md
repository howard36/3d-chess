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

### 0-E-2 inCheck()

- [x] Implement `inCheck(color)` (uses king locator + attack map) with tests
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

- [x] Add `findKing(color)` and `isSquareAttacked(target, byColor)` with unit tests
- [x] Implement `inCheck(color)` (uses king locator + attack map) with tests
- [x] Create `generateLegalMoves(color)` that filters out moves leaving king in check
- [x] Add `isCheckmate(color)` & `isStalemate(color)` (with helper `hasLegalMove`)
- [x] Write 3D-specific scenario tests (corner mate, 3D Fool's-mate fail, stalemate box)
- [x] Commit: `feat(engine): check, mate, stalemate detection`

### 1-F Coverage & public API barrel

- [x] Create `src/engine/index.ts` exporting public API
- [x] Enforce Vitest coverage ≥ 90 % (engine only)
- [x] Commit: `chore(engine): barrel export & coverage gate`

---

## Phase 2 – Backend Skeleton on Modal

### 2-A FastAPI scaffold

- [x] Create `server/modal_app.py` with `modal.App`
- [x] Decorate `serve()` with `@app.function`
- [x] Decorate `serve()` with `@modal.asgi_app`
- [x] Add a `/health` GET route to the FastAPI app

### 2-B Pydantic models from JSON Schema

- [x] Add `server/schema.json` containing the WebSocket JSON Schema
- [x] Generate `server/messages.py` via `datamodel-code-generator`
- [x] Write tests that instantiate each generated message model from sample JSON
- [x] Update Pydantic 'const' usage to 'Literal' in server/messages.py

### 2-C create_game handler

- [x] Implement `/ws` WebSocket endpoint in `modal_app.py`
- [x] Handle `"create_game"` messages by generating a UUID
- [x] Store the creator's `WebSocket` in an in-memory map keyed by gameId
- [x] Send back a `"game_created"` message with the new gameId

### 2-D join_game & game_start

- [x] Extend the `/ws` handler to process `"join_game"` messages
- [x] Attach the second client under a random color assignment
- [x] Record the initial `turn` state for the game
- [x] Broadcast a `"game_start"` message to both players
- [x] Refactor: track player color per WebSocket connection in `ws_endpoint` (commit cf6be1f)

### 2-E move relay & turn validation

- [x] Within the `/ws` handler, accept `"move"` only from the socket matching the current `turn`
- [x] Relay a `"move_made"` message to both clients when valid
- [x] Flip the `turn` state after relaying
- [x] Send an `"error"` message on out-of-turn attempts

### 2-F Server coverage & CI

- [x] Refactor websocket tests to use ws_connect fixture (shared async factory for DRYness)
- [x] Add end-to-end WebSocket integration test covering create, join, move, and error flows

---

## Phase 3 – 3D Board MVP

### 3-A 5×5×5 grid rendering

- [x] Create `client/src/three/Board.tsx` rendering 125 cubes
- [x] Parent group with `data-testid="board-grid"` (now `name="board-grid"`)
- [x] Update `App.test.tsx` to assert 125 meshes (now asserts canvas only; mesh count in Board.test.tsx)
- [x] Commit: `feat(ui): render empty 5×5×5 grid`

### 3-B Placeholder piece meshes

- [x] Add `PieceMesh.tsx` with simple geometries per piece type
- [x] Prop types: `type` and `color`
- [x] Snapshot tests
- [x] Commit: `feat(ui): placeholder piece meshes`

### 3-C Orbit controls & responsive canvas

- [x] Add `<OrbitControls makeDefault />`
- [x] Implement `useWindowSize` hook for full-window canvas
- [x] Commit: `chore(ui): orbit controls & responsive canvas`

### 3-D Static starting position

- [x] Import `Board` engine to iterate pieces
- [x] Render `<PieceMesh>` at correct world coords
- [x] Test: count 40 piece meshes
- [x] Test: clicking a piece highlights legal move cubes
- [x] Commit: `feat(ui): starting position rendered`

---

## Phase 4 – Local Play Slice

### 4-A Raycast selection & highlights

- [x] Add `useSelectedPiece` state
- [x] On piece click: compute legal moves & highlight cubes
- [x] RTL + `@react-three/test-renderer` test for highlighting
- [x] Commit: `feat(ui): piece selection & highlights`

### 4-B Local move execution

- [x] On highlight click: call `applyMove`, update state
- [x] Toggle turn
- [x] RTL test: mesh relocates & highlights clear
- [x] Commit: `feat(ui): local move application`

### 4-C Board selection event logic improvements

- [x] Add onPointerDown to <group> to unselect piece when clicking outside pieces/highlights
- [x] Ensure highlighted cube clicks call e.stopPropagation()
- [x] Ensure piece clicks call e.stopPropagation()
- [x] Test: selecting a piece and clicking empty space unselects it
- [x] Test: clicking a piece does not immediately unselect it
- [x] Commit: `fix(ui): board click unselect and event propagation logic`

### 4-D Turn banner

- [x] Add simple `TurnIndicator` component top-center, shows "White to move" etc.
- [x] Unit test: after each move, text flips.
- [x] Commit: `feat(ui): turn indicator synced with moves`

---

## Phase 5 – Online Play Slice

### 5-A `useGameSocket` hook

- [x] Create hook with `send()` and `lastMessage`
- [x] No auto-reconnect
- [x] Test with `jest-websocket-mock`
- [x] Commit: `feat(ws): socket hook`

### 5-B Start screen & create game

- [x] `/` route → `StartScreen` with "Create New Game" button
- [x] On click: send `create_game`, await `game_created`, redirect to `/game/:id`
- [x] Playwright test: flow from button to game URL
- [x] Commit: `feat(ui): start screen & create game flow`

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

- [x] When `inCheck`, set king emissive red
- [x] RTL test for material property
- [x] Commit: `feat(ui): king glows when in check`

### 6-B End-game modal

- [ ] After `applyMove`, check for checkmate/stalemate
- [ ] Show modal with result + "Start New Game" link
- [ ] Playwright test: fool's mate triggers modal
- [ ] Commit: `feat(ui): end-game modal`

### 6-C Pawn promotion dialog

- [x] Detect promotion square moves
- [x] Show picker for Q/R/B/N/U, then send with `promotion` field
- [x] RTL test: promote pawn, verify queen mesh
- [x] Commit: `feat(ui): promotion workflow`

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

- [ ] Create `modal_deploy.sh` for `
