// The landing page's demo: a real game the board plays on its own, over and
// over. Like a live game it is a message log (move_made messages) replayed by
// deriveHistory, so the board it shows is exactly what the game screen would.

import type { MoveMade, WebSocketMessage } from '../types/messages';

/**
 * A short game that shows every kind of moment: quiet moves, captures both
 * ways, checks, and a mate by White (the same game scripts/showcase.mjs
 * records). Found by search over the rules engine.
 */
export const DEMO_GAME: readonly string[] = [
  'Ab2-De5 Ed4-Ba1', // unicorns trade pawns across the whole cube
  'Ac2-Cc4 Dc4-Dc3',
  'Ad2-Dd5 Ec4-Dd5', // bishop takes with check; the queen takes back
  'Aa1-Ba1 Dd5-Db3', // rook takes the unicorn
  'Cc4-Db3 Db4-Cb4', // queen trade
  'Ad1-Cd2 Dc3-Cc3',
  'Aa2-Da5 Eb4-Ed2',
  'Da5-Db4 Ed2-Cb2',
  'Db3-Ec4', // mate
]
  .join(' ')
  .split(' ');

/**
 * Every move of the demo as the server would echo it. Built once: the log
 * for a ply is a slice of this, so deriveHistory sees the same message
 * objects from one ply to the next and hands back its previous result while
 * the ply is unchanged.
 */
const MESSAGES: readonly MoveMade[] = DEMO_GAME.map((move, i) => {
  const [from, to] = move.split('-');
  return { type: 'move_made', by: i % 2 === 0 ? 'white' : 'black', from, to };
});

/** The demo's message log once `ply` moves have been played. */
export const demoLog = (ply: number): WebSocketMessage[] =>
  MESSAGES.slice(0, Math.max(0, Math.min(ply, MESSAGES.length)));

/** The demo's pace, in seconds. */
export const DEMO_PACE = {
  /** The opening position, before the first move. */
  open: 2,
  /** From one move to the next (a glide takes about half a second of it). */
  ply: 2.4,
  /** The mate, the king's fall and the result, before the board fades. */
  mate: 5,
  /** The veil closing over the finished game (easing in)... */
  fadeOut: 0.7,
  /** ...and opening on the next one (easing out). */
  fadeIn: 0.9,
} as const;

/** One pass of the demo: the opening, every move, the mate's hold and the fade out and in. */
export const DEMO_LOOP_SECONDS =
  DEMO_PACE.fadeIn +
  DEMO_PACE.open +
  (DEMO_GAME.length - 1) * DEMO_PACE.ply +
  DEMO_PACE.mate +
  DEMO_PACE.fadeOut;

export interface DemoFrame {
  /** Which pass of the game this is, from 0: a new pass starts a fresh board. */
  pass: number;
  /** Moves played. */
  ply: number;
  /** How far the veil over the board has closed: 0 open, 1 shut (the board is swapped under it). */
  veil: number;
}

/**
 * Where the demo stands `seconds` after it started. Each pass fades in on the
 * opening position, holds it, plays a move every DEMO_PACE.ply, holds the
 * mate, and fades out; the next pass starts under the closed veil.
 */
export function demoFrame(seconds: number): DemoFrame {
  const t = Math.max(0, seconds);
  const pass = Math.floor(t / DEMO_LOOP_SECONDS);
  const s = t - pass * DEMO_LOOP_SECONDS;
  const { open, ply: step, fadeIn, fadeOut } = DEMO_PACE;
  // The very first pass opens without a fade: the page arrives on the board.
  // The veil opens easing out (quick, then settling) and closes easing in.
  const opening = pass === 0 ? 0 : Math.max(0, 1 - s / fadeIn) ** 2;
  const playFrom = fadeIn + open;
  const ply = s < playFrom ? 0 : Math.min(DEMO_GAME.length, 1 + Math.floor((s - playFrom) / step));
  const outFrom = DEMO_LOOP_SECONDS - fadeOut;
  const closing = s <= outFrom ? 0 : Math.min(1, (s - outFrom) / fadeOut) ** 2;
  return { pass, ply, veil: Math.max(opening, closing) };
}
