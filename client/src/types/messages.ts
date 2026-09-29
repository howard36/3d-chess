// Stable names for the wire-format types. The definitions themselves live in
// ./schema.ts, which is GENERATED from server/schema.json — regenerate with
// `npm run generate:types` after any schema change (CI fails if it's stale).
// App code imports from here so the generated file's naming (e.g. the long
// envelope name) never leaks into call sites.

export type {
  GameCreated,
  GameInfo,
  GameJoined,
  GameStart,
  GameState,
  Move,
  MoveMade,
  MoveRecord,
  Error,
  Color,
  Promotion,
} from './schema';

export type { WebSocketV1MessageEnvelope as WebSocketMessage } from './schema';
