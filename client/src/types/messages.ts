// Message types based on server/messages.py

export type CreateGame = {
  type: 'create_game';
};

export type GameCreated = {
  type: 'game_created';
  gameId: string;
};

export type JoinGame = {
  type: 'join_game';
  gameId: string;
};

export type Color = 'white' | 'black';

export type GameStart = {
  type: 'game_start';
  color: Color;
  initialPosition?: string;
};

export type Promotion = 'Q' | 'R' | 'B' | 'N' | 'U';

export type Move = {
  type: 'move';
  from: string; // Pattern: [A-E][a-e][1-5]
  to: string; // Pattern: [A-E][a-e][1-5]
  promotion?: Promotion;
};

export type MoveMade = {
  type: 'move_made';
  by: Color;
  from: string; // Pattern: [A-E][a-e][1-5]
  to: string; // Pattern: [A-E][a-e][1-5]
  promotion?: Promotion;
};

export type Error = {
  type: 'error';
  code: string;
  message: string;
};

export type WebSocketMessage = CreateGame | GameCreated | JoinGame | GameStart | Move | MoveMade | Error;