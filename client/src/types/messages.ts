// Message types based on server/messages.py

export type CreateGame = {
  type: 'create_game';
};

export type Color = 'white' | 'black';

export type GameCreated = {
  type: 'game_created';
  gameId: string;
  color: Color;
};

export type JoinGame = {
  type: 'join_game';
  gameId: string;
};

export type RejoinGame = {
  type: 'rejoin_game';
  gameId: string;
  color: Color;
};

export type GameStart = {
  type: 'game_start';
  color: Color;
  initialPosition?: string;
};

export type Promotion = 'Q' | 'R' | 'B' | 'N' | 'U';

// A move as stored in a game's history: move_made without the message tag.
export type MoveRecord = {
  by: Color;
  from: string; // Pattern: [A-E][a-e][1-5]
  to: string; // Pattern: [A-E][a-e][1-5]
  promotion?: Promotion;
};

export type GameState = {
  type: 'game_state';
  color: Color;
  started: boolean;
  moves: MoveRecord[];
};

export type Move = {
  type: 'move';
  from: string; // Pattern: [A-E][a-e][1-5]
  to: string; // Pattern: [A-E][a-e][1-5]
  promotion?: Promotion;
};

export type MoveMade = MoveRecord & {
  type: 'move_made';
};

export type Error = {
  type: 'error';
  code: string;
  message: string;
};

export type WebSocketMessage =
  | CreateGame
  | GameCreated
  | JoinGame
  | RejoinGame
  | GameStart
  | GameState
  | Move
  | MoveMade
  | Error;
