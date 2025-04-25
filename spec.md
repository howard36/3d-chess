# Project Specification: 3D Chess Online Multiplayer (Version 1.0)

**Preface: Software Engineering Practices**

This project should adhere to standard software engineering best practices, emphasizing:

- **Simplicity:** Keep the code straightforward and avoid unnecessary complexity.
- **Readability & Maintainability:** Write clean, well-formatted code with meaningful variable names and comments where necessary to clarify complex logic.
- **Modularity:** Structure the code into logical, reusable components/modules (especially within the React frontend).
- **Version Control:** Use Git for version control throughout the development process.
- **Testing:** Follow the testing plan outlined in Section 9.
- **Tooling:** Utilize the specified development tools (Vite, ESLint, Prettier, GitHub Actions) as outlined in Section 11.

**1. Overview**

This document outlines the requirements for Version 1.0 (V1) of a web-based, online multiplayer application for playing a specific variant of **3D chess**. The primary goal of V1 is to deliver the core gameplay experience with the specified rules, using the specified technology stack and adhering to best practices.

**2. Core Game Rules & Logic**

- **2.1. Board & Coordinates:**
  - **Grid:** 5x5x5 cubic grid (125 cells).
  - **Internal Representation:** Code should use a 0-indexed coordinate system (x, y, z), where x represents the file (0-4), y represents the rank (0-4), and z represents the level (0-4).
  - **User Display Format:** When displaying coordinates to the user (e.g., potentially in move lists or debugging), use the format ZXY (Level, File, Rank).
    - Z (Level): 'A' through 'E' (corresponds to internal z = 0 through 4).
    - X (File): 'a' through 'e' (lowercase) (corresponds to internal x = 0 through 4).
    - Y (Rank): '1' through '5' (corresponds to internal y = 0 through 4).
    - Example: Internal (x=0, y=0, z=0) displays as Aa1. Internal (x=4, y=4, z=4) displays as Ee5.
  - **Orientation:** Assume White starts at low y and z ranks/levels, moving towards increasing y ('forward') and z ('up'). Black starts at high y and z, moving towards decreasing y and z.
- **2.2. Pieces:** Standard chess pieces (King, Queen, Rook, Bishop, Knight, Pawn) plus the Unicorn.
- **2.3. Starting Setup (Using Internal 0-Indexed Coordinates):**
  - **White Pieces:**
    - Pawns (10): (x, 1, 0) and (x, 1, 1) for x=0 to 4. (Displayed Rank 2, Levels A & B).
    - Back Rank 1 (y=0, z=0 / Rank 1, Level A): R(0,0,0), N(1,0,0), K(2,0,0), N(3,0,0), R(4,0,0).
    - Back Rank 2 (y=0, z=1 / Rank 1, Level B): B(0,0,1), U(1,0,1), Q(2,0,1), B(3,0,1), U(4,0,1).
  - **Black Pieces:**
    - Pawns (10): (x, 3, 4) and (x, 3, 3) for x=0 to 4. (Displayed Rank 4, Levels E & D).
    - Back Rank 1 (y=4, z=4 / Rank 5, Level E): R(0,4,4), N(1,4,4), K(2,4,4), N(3,4,4), R(4,4,4).
    - Back Rank 2 (y=4, z=3 / Rank 5, Level D): **U(0,4,3), B(1,4,3), Q(2,4,3), U(3,4,3), B(4,4,3).**
- **2.4. Piece Movement:** Movement vectors (Δx, Δy, Δz) applied to internal coordinates. n denotes any number of steps. Pieces cannot move through other pieces (except Knight).
  - **Rook (R):** (±n, 0, 0), (0, ±n, 0), or (0, 0, ±n).
  - **Bishop (B):** Permutations of (±n, ±n, 0).
  - **Unicorn (U):** Permutations of (±n, ±n, ±n).
  - **Knight (N):** Permutations of (±2, ±1, 0). Jumps over pieces.
  - **Queen (Q):** Combines Rook, Bishop, and Unicorn moves.
  - **King (K):** Moves one square (n=1) in any direction a Queen can move.
- **2.5. Pawn Rules:**
  - **Non-Capture Move:** Player _chooses_ to move pawn either:
    - One square purely 'forward' (White: (0, +1, 0), Black: (0, -1, 0)).
    - OR One square purely 'up' (White: (0, 0, +1), Black: (0, 0, -1)).
  - **Capture Move:** Pawns capture by moving one square diagonally in one of 5 specific directions (relative to White's perspective, Black is reversed):
    - Forwards-Up: (0, +1, +1)
    - Forwards-Left: (-1, +1, 0)
    - Forwards-Right: (+1, +1, 0)
    - Up-Left: (-1, 0, +1)
    - Up-Right: (+1, 0, +1)
  - **Initial Move:** No two-square initial move option.
  - **Promotion Zone:** A pawn is promoted _only_ when it reaches a square where _both_ its 'forward' coordinate (y) _and_ its 'up' coordinate (z) are maximal (for White) or minimal (for Black).
    - White Promotion Zone: Internal (x, 4, 4) for x=0 to 4. (Displayed as Ea5 through Ee5).
    - Black Promotion Zone: Internal (x, 0, 0) for x=0 to 4. (Displayed as Aa1 through Ae1).
  - **Promotion Pieces:** Player chooses Queen, Rook, Bishop, Knight, or Unicorn.
- **2.6. Special Rules:**
  - **No Castling.**
  - **No En Passant.**
- **2.7. Endgame Conditions:**
  - **Check:** King is attacked.
  - **Checkmate:** King is in check, and no legal moves exist.
  - **Stalemate:** No legal moves exist, but the King is not in check.
  - **Automatic Detection:** Application must automatically detect and declare Checkmate/Stalemate.

**3. Application Type**

- Web Application, accessible via standard web browsers. Built using **React**.

**4. Multiplayer & Networking**

- **4.1. Mode:** Two-player, online only.
- **4.2. Connection:** Via unique shareable game link/URL. No lobby/matchmaking.
- **4.3. Joining:** Instant join on link access.
- **4.4. Color Assignment:** Random (White/Black) on Player 2 join.
- **4.5. Synchronization:** Real-time via **WebSocket** messages relayed through the backend server (hosted on Modal). Communication must adhere to the schema defined in section 4.7.
- **4.6. Disconnection Handling (V1 Simplification):** No specific handling. Game may become unresponsive if a player disconnects. No automatic forfeit.
- **4.7. WebSocket Message Schema:** All messages sent over the WebSocket connection MUST conform to the following JSON Schema:

json
{
"$schema": "[http://json-schema.org/draft-07/schema#](http://json-schema.org/draft-07/schema#)",
      "title": "WebSocket V1 Message Envelope",
      "oneOf": [
        { "$ref": "#/definitions/create_game" },
{ "$ref": "#/definitions/game_created" },
        { "$ref": "#/definitions/join_game" },
{ "$ref": "#/definitions/game_start" },
        { "$ref": "#/definitions/move" },
{ "$ref": "#/definitions/move_made" },
        { "$ref": "#/definitions/error" }
],
"definitions": {
"create_game": {
"type": "object",
"properties": {
"type": { "const": "create_game" }
},
"required": ["type"],
"additionalProperties": false
},
"game_created": {
"type": "object",
"properties": {
"type": { "const": "game_created" },
"gameId": { "type": "string" }
},
"required": ["type", "gameId"],
"additionalProperties": false
},
"join_game": {
"type": "object",
"properties": {
"type": { "const": "join_game" },
"gameId": { "type": "string" }
},
"required": ["type", "gameId"],
"additionalProperties": false
},
"game_start": {
"type": "object",
"properties": {
"type": { "const": "game_start" },
"color": { "enum": ["white", "black"] },
"initialPosition": { "type": "string" }
},
"required": ["type", "color"],
"additionalProperties": false
},
"move": {
"type": "object",
"properties": {
"type": { "const": "move" },
"from": { "type": "string", "pattern": "^[A-E][a-e][1-5]$" },
            "to":        { "type": "string", "pattern": "^[A-E][a-e][1-5]$" },
"promotion": { "enum": ["Q", "R", "B", "N", "U"] }
},
"required": ["type", "from", "to"],
"additionalProperties": false
},
"move_made": {
"type": "object",
"properties": {
"type": { "const": "move_made" },
"by": { "enum": ["white", "black"] },
"from": { "type": "string", "pattern": "^[A-E][a-e][1-5]$" },
            "to":        { "type": "string", "pattern": "^[A-E][a-e][1-5]$" },
"promotion": { "enum": ["Q", "R", "B", "N", "U"] }
},
"required": ["type", "by", "from", "to"],
"additionalProperties": false
},
"error": {
"type": "object",
"properties": {
"type": { "const": "error" },
"code": { "type": "string" },
"message": { "type": "string" }
},
"required": ["type", "code", "message"],
"additionalProperties": false
}
}
}

    * **Note on initialPosition:** The game_start message includes an optional initialPosition field (string). For V1, this field can likely be omitted as the starting position is fixed and known by the client. If included, it should represent the board state in a standard format (e.g., FEN-like, adapted for 3D).
    * **Note on move / move_made coordinates:** The from and to fields use the user-facing ZXY notation (e.g., Aa1, Ec3). The backend/frontend will need to translate these to/from the internal (x, y, z) representation.
    * **Note on promotion:** This field is only required/present if the move results in a pawn promotion.

**5. User Interface (UI) & User Experience (UX)**

- **5.1. Anonymity:** No user accounts, login, or profiles.
- **5.2. History:** No game history stored.
- **5.3. Screens (Implemented as React Components):**
  - **Start Screen:** Button: "Create New Game". Displays generated unique game URL for sharing (obtained via create_game / game_created WebSocket messages).
  - **Game Screen:** Main view. Triggered by join_game / game_start.
    - Displays 3D board/pieces via Three.js canvas managed within React, based on initial state from game_start (if provided) or default setup.
    - Indicator for current player's turn (derived from game state).
    - King piece highlights red when in check (derived from game state).
  - **End Screen:** Displays result (Checkmate/Stalemate). Button: "Start New Game".
- **5.4. Board Interaction:**
  - **View Control:** Free 3D rotation via mouse drag within the Three.js canvas.
  - **Move Execution:** Click-to-move (using raycasting in Three.js scene).
    1.  Click piece -> Calculate valid moves -> Highlight destinations in 3D scene.
    2.  Click highlighted destination -> Construct and send move WebSocket message. -> Upon receiving move_made message from server, update local game state and UI.
- **5.5. Visual Style (V1 Simplification):**
  - **Models:** Simple, clean 3D models (Three.js).
  - **Animations:** None in V1.
  - **Level Fading:** None in V1.
  - **Last Move Indicator:** None in V1.
  - **Captured Pieces:** None in V1.

**6. Architecture**

- **6.1. Frontend:**
  - **Framework:** **React** is required.
  - **3D Rendering:** **Three.js** is required. **@react-three/fiber** and its ecosystem (e.g., **@react-three/drei**) **must** be used to integrate Three.js declaratively within the React application structure.
- **6.2. Backend:**
  - **Platform:** **Modal ([modal.com](https://modal.com))** is required for hosting the backend service.
  - **Requirement:** The backend **must** implement a **WebSocket server** functionality deployed on Modal, handling messages according to the schema in section 4.7.
  - **Functionality:** The primary role of the backend is to act as a WebSocket **message relay** and minimal game coordinator. It should:
    - Manage WebSocket connections.
    - Handle create_game requests, generate a unique gameId, store game/connection mappings (see State Management below), and respond with game_created.
    - Handle join_game requests, validate gameId, associate the second player, and send game_start to both players with randomized colors.
    - Handle move messages, validate basic correctness (e.g., is it the sender's turn based on stored state?), relay valid moves as move*made messages to \_both* players in the game.
  - **Implementation & Deployment:**
    - Use an ASGI framework (**FastAPI** recommended) deployed via Modal's @modal.asgi_app().
    - The application **must** be configured to run within a **single Modal container** by setting concurrency_limit=1 in the Modal app definition for the ASGI app.
    - The FastAPI application running within this single container should handle multiple concurrent WebSocket connections asynchronously.
- **6.3. State Management:**
  - **Frontend:** Managed within React (e.g., useState, useReducer, Context API). Includes board state, turn, check status, interaction state, connection status.
  - **Backend:** Active game state (mapping gameId to player connections, whose turn it is, etc.) **must** be stored using a standard **in-memory Python dictionary** within the scope of the single running FastAPI application instance. State is ephemeral and exists only while the Modal container is running.
- **7. Data Handling**

- **7.1. Game State:** Master game state is effectively managed by the sequence of moves validated and relayed by the backend. Clients maintain their local representation based on the initial state and received move_made messages.
- **7.2. Persistence:** No database required for V1. Game state exists only ephemerally within the single backend container's memory during its runtime.

**8. Error Handling**

- **8.1. Invalid Moves:** Frontend UI prevents selecting invalid destinations. Backend should perform basic validation (e.g., correct player moving based on in-memory state) before relaying. Backend sends error message for invalid operations. Frontend should display errors received from the backend.
- **8.2. Connection Issues (V1 Limitation):** No specific robust handling for WebSocket errors/interruptions in V1 beyond browser/library defaults.
- **8.3. UI Errors:** Use standard React error boundaries and handle potential Three.js rendering issues.

**9. Testing Plan**

- **9.1. Unit Tests:**
  - **Game Logic:** Rigorous testing of move generation/validation (esp. pawns), check/mate/stalemate detection.
  - **React Components:** Test rendering, state changes, and basic interactions using **Vitest** and **React Testing Library**.
- **9.2. Integration Tests:**
  - **Frontend:** Test @react-three/fiber component interactions, state flow between React and Three.js. Test WebSocket message handling (sending move, receiving move_made/game_start/error).
  - **Backend (Modal):** Test WebSocket connection handling, message validation, in-memory state management, and message relay logic within the Modal environment (running locally or via Modal's tools).
  - **Full Stack:** Test end-to-end message flow via the deployed Modal WebSocket endpoint.
- **9.3. End-to-End (E2E) Tests:** (Using **Playwright**) Simulate full user flows against the deployed application: Creating a game, sharing link, joining, playing moves via UI clicks in 3D canvas, checking UI feedback (turn, check), triggering endgame. Test 3D rotation interaction. Validate WebSocket message exchanges.
- **9.4. Manual Testing:** Essential for 3D usability (rotation, selection), visual correctness, cross-browser checks, and exploring edge cases in gameplay and network scenarios.

**10. Development Tooling & Practices**

- **10.1. Build Tool / Dev Server:** **Vite** must be used for frontend development and bundling.
- **10.2. Linting:** **ESLint** must be configured and used to enforce code quality and style consistency.
- **10.3. Formatting:** **Prettier** must be configured and used for automatic code formatting.
- **10.4. Continuous Integration (CI):** **GitHub Actions** should be configured to run linting, testing, and potentially build checks on commits/pull requests.

**11. Future Considerations (Post-V1)**

Features deferred from V1 include:

- Animations
- Level fading
- Robust disconnect handling
- Draw offers/resignation
- Captured piece display
- Last move indicator
- **Backend move validation** (full legality check)
- **Accessibility** (e.g., keyboard navigation, screen reader support)
- Time controls
- User accounts/history
- Matchmaking
