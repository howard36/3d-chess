// The landing page's demo: real games the board plays on its own, one after
// another, over and over. Like a live game each is a message log (move_made
// messages) replayed by deriveHistory, so the board it shows is exactly what
// the game screen would.

import type { MoveMade, Promotion, WebSocketMessage } from '../types/messages';

/**
 * Five games the computer played against itself on Hard, chosen from a
 * hundred for having something happen all the way through (no long stretch
 * without a capture, a check or a promotion), a lead that changes hands, and
 * a mate rather than a long chase, and between them both sides winning, a
 * rook's mate as well as queens', and queens traded early, late and never.
 * Moves as the wire has them (`=Q` on a promotion), White first.
 */
const GAMES: readonly (readonly string[])[] = [
  // 80212: White mates, 93 plies
  [
    'Ad1-Cc1 Dc5-Cc5 Ab1-Ac3 Dd4-Cd4 Aa2-Ba3 Ed5-Ec3 Ad2-Ae3 Da4-Ca4 Ba3-Ab3 Ee4-Ed3',
    'Bb2-Cb2 Ee5-Ee3 Be2-Be3 Ec4-Dd4 Aa1-Aa5 Eb5-Cb4 Ab2-Bc3 Cb4-Ab3 Ac2-Ab3 Da5-Ca5',
    'Ac3-Cd3 Ee3-Ce3 Cd3-Ec3 Eb4-Ec3 Ba2-Ca2 Dc4-Cc4 Ca2-Ca3 Cc4-Bc3 Ab3-Bc3 Ed3-De3',
    'Bc3-Bd4 Dd5-Cd5 Bd4-Bb2 Ed4-Dc3 Bb2-Dd4 De5-Dd4 Be1-Be2 Ce3-Cb3 Bc2-Cc2 Ec3-Cc1',
    'Bd1-Cc1 Cb3-Ab3 Ae3-Ce5 Ec5-Ed4 Ac1-Bc2 Ab3-Eb3 Cb2-Db2 Eb3-Ed3 Be2-Ce2 De3-Be5',
    'Ba1-Ca1 Ed3-Ea3 Cc2-Dc3 Dd4-Dc3 Bc2-Cb2 Ed4-Dd4 Be3-Be4 Cd4-Be4 Ce5-Be4 Dc3-Cc3',
    'Cb2-Ba2 Cd5-Cd4 Be4-De2 Dd4-Ed3 Bd2-Cd2 Cc5-Cc4 Ae1-De1 Be5-Bc3 De1-Ee1 Ed3-Ec3',
    'Ba2-Ca2 Db4-Db3 Ca3-Da3 Bc3-Ac2 Ca2-Cb1 Ac2-Ce2 Ee1-Ee3 Ec3-Eb2 Ee3-Ee2 Eb2-Ea1',
    'Cc1-Cc2 Ea3-Da3 De2-Ee1 Ea5-Ec5 Ee1-Cc1 Ea1-Eb1 Cc1-Db1 Ce2-Ec2 Ee2-Ee1 Ec2-Ed1',
    'Ee1-Ed1 Ec5-Ec1 Ed1-Ec1',
  ],
  // 80116: White mates, 135 plies
  [
    'Ab1-Ac3 Eb5-Ec3 Ac2-Ad3 Ee4-Ed3 Ad1-Cd2 Ed3-De3 Ab2-Bc3 Ed4-Dc3 Cd2-Bd4 Dd5-Cd5',
    'Ad2-Dd5 Ec5-Eb5 Dd5-Ee5 Cd5-Bd4 Ad3-Bd4 Ec4-Ee4 Ee5-Ec3 Ee4-Bb1 Ac1-Ad2 Eb4-Ec3',
    'Be2-Ce2 De3-Ce4 Bd4-Bc5 Dc3-Cb4 Bc5-Ab4 Ed5-Dd3 Ab4-Ab1 Bb1-Dd1 Be1-Ce1 Dd1-Ad4',
    'Ab1-Ad3 Ad4-Cd4 Ad2-Ac2 Cd4-Bd5 Ce2-De2 Dd3-Db2 Ad3-Ed3 Eb5-Eb4 Ed3-Eb1 Eb4-Ea3',
    'Ba2-Ca2 Db2-Ba2 Ac2-Bb1 Cb4-Bc3 Ca2-Da2 Ea3-Da3 Ac3-Ab5 Bd5-Ae5 Bb1-Ba2 Ae5-Ab2',
    'Ba2-Ca1 Ea4-Bd1 Ab5-Bb3 Da3-Cb4 Eb1-Ab5 Ab2-Ab5 Bb3-Ab5 Cb4-Bc4 Ab5-Aa3 Bd1-Ae2',
    'Ca1-Db2 Ec3-Ce3 Aa3-Bc3 Dc4-Cc4 Bb2-Bb3 Bc4-Ac3 Bc3-Bb5 Ac3-Bc2 Bb5-Dc5 Bc2-Bb3',
    'Dc5-Ea5 Ce3-Ae1 Aa1-Ae1 Da4-Da3 Db2-Eb3 Bb3-Aa2 Eb3-Eb4 Aa2-Bb1 Ae1-Be1 Ce4-De3',
    'Be1-Be2 Bb1-Bc1 Eb4-Da5 Bc1-Ad1 Be2-Be4 De4-Ce4 Da5-Db4 Ad1-Bd2 Ea5-Da3 Bd2-Ce1',
    'Da3-Db5 De3-Ce2 Db4-Dc4 Ce1-De2 Be4-Be5 Ce2-Cd3 Be5-De5 De2-Ce3 Da2-Da3 Cc4-Bc4',
    'Da3-Da4 Cd3-Bd4 Da4-Da5 Ae2-Db5 De5-Db5 Dd4-Dd3 Db5-Dd5 Dd3-Cd3 Da5-Ea5=Q Bc4-Bc3',
    'Dd5-Bd5 Bd4-Be3 Ea5-Cc3 Ce3-Be2 Bd5-Be5 Be2-Ad2 Cc3-Cd4 Ad2-Bd2 Be5-Be3 Cd3-Be3',
    'Cd4-Cc3 Bd2-Ac2 Dc4-Cb3 Ac2-Ad3 Cc3-Bc2 Ad3-Bd4 Bc2-Bc3 Bd4-Ce3 Cb3-Cc3 Ce3-Be2',
    'Bc3-Cd2 Be2-Ae2 Cc3-Bc3 Ae2-Ae3 Cd2-Bd3',
  ],
  // 80017: Black mates, 142 plies
  [
    'Ab1-Ac3 Eb5-Cc5 Aa2-Ba3 Ee4-Ec2 Be2-Ce2 Ea4-Db3 Ad1-Cd2 Ed5-Ee3 Ac3-Bc5 Ec2-Bc5',
    'Cd2-Ed3 Ec5-Ed5 Ed3-Eb4 Ec4-Eb4 Ba3-Bc5 Ee3-Dc3 Ab2-Bc3 Db5-Cb5 Bc5-Dc3 Ed4-Dc3',
    'Ac2-Bd3 Dd4-Cd4 Bd3-Ed3 Ed5-Ec5 Ad2-Ac3 Ee5-Ed5 Ed3-De3 Dc3-Ed4 De3-Dd2 Dc4-Cc4',
    'Dd2-Ec1 Cc5-Ec4 Bc3-Cd2 Eb4-Da3 Bb2-Cb2 Da3-Ad3 Ac3-Bb3 Db3-Ca4 Aa1-Aa3 Ad3-Ae4',
    'Ec1-Ec3 Db4-Cb4 Aa3-Da3 Ae4-Ae3 Ac1-Bb2 Cb4-Bb3 Ec3-Eb4 Ec5-Dd4 Da3-Da4 Dc5-Dc4',
    'Ba2-Bb3 Ae3-Ce3 Da4-Da2 Ed4-Cb2 Da2-Dd2 Dd4-Cd5 Eb4-Ec4 Ce3-Ae1 Ae2-Cc4 Cb5-Cc4',
    'Bb1-Cb2 Ae1-Bd1 Bc1-Cc1 Cd4-Bd4 Ba1-Ba2 Dd5-Dd4 Bc2-Bc3 De4-Ce4 Bc3-Bd4 Ce4-Bd4',
    'Dd2-Dc2 Bd1-Be2 Ce2-De2 Ed5-Ec5 Ec4-Ed3 Bd4-Bd3 Cb2-Cb3 Bd3-Ad3 Cb3-Cc4 Cd5-Cc4',
    'Cd2-Bc3 Dc4-Dc3 Ed3-Dd3 Cc4-Db3 Bb2-Ac3 Be2-Ae3 Bb3-Bb4 Ae3-Cc5 Ac3-Ad3 Cc5-Bb4',
    'Dc2-Bc2 Db3-Eb3 Ad3-Ad2 Bb4-Aa5 Ad2-Bc1 Aa5-Ae1 Bc1-Cd2 Ec5-Cc5 Dd3-Dc2 Eb3-Ec4',
    'Bd2-Bd3 De5-De4 Dc2-Ec1 Ec4-Eb4 Ec1-Ee1 Eb4-Db5 Ee1-Ec3 Ea5-Ec5 Ec3-Ca3 De4-Ce4',
    'Ba2-Ba3 Ce4-Ce3 Bd3-Ce3 Dc3-Cc3 Cd2-Dd3 Cc3-Bc2 Ca3-Cb4 Db5-Ea4 Dd3-Dd4 Ae1-Db4',
    'Cb4-Db4 Ea4-Db4 Dd4-Cd3 Bc2-Bc1 Cd3-Bc2 Cc5-Cc1 Bc2-Cc1 Bc1-Ac1=Q Cc1-Cd1 Ac1-Ce3',
    'Ba3-Ca4 Db4-Cc3 Ca4-Da5 Ce3-Dd2 Cd1-Be2 Cc3-Bc3 Be2-Be3 Dd2-Cd2 Be3-Be4 Cd2-Cd3',
    'Be4-Ae3 Cd3-Bd3',
  ],
  // 80123: Black mates, 136 plies
  [
    'Ab1-Ac3 Ea4-Db3 Ad1-Cc1 Ed5-Cc5 Ab2-Bc3 Ee4-Ec2 Ae2-Bd3 Eb5-Ec3 Bb2-Cb2 Dd4-Cd4',
    'Cb2-Db3 Ec4-Db3 Bd3-Cc2 Db3-Dc2 Bd2-Cd2 Dc2-Db2 Bd1-Bd2 Dc4-Cc4 Ac2-Bb2 Dd5-Dd4',
    'Bb2-Db2 Ec2-Db2 Bb1-Cb1 Db2-Dc3 Cd2-Cd3 Dd4-Cd3 Bc3-Cd2 Cc4-Bc4 Ac3-Cd3 Ec3-Cd3',
    'Cc1-Cd3 Dc3-Cd3 Cd2-Eb4 Cd3-Dd4 Eb4-Cd2 Ed4-Dc3 Ae1-Ae4 De4-Ce4 Bd2-Bd3 Cd4-Bd3',
    'Bc2-Bd3 Bc4-Bc3 Ad2-Ac3 Da5-Ca5 Aa2-Ac4 Dc3-Cd2 Be2-Cd2 Dd4-Cc4 Ac3-Cc5 Db5-Cc5',
    'Ae4-Ae5 Cc4-Bd4 Aa1-Aa4 Ca5-Ca4 Ba2-Ca2 Cc5-Bc5 Ac4-Ae2 Dc5-Cc5 Cc2-Dd3 Ec5-Dd5',
    'Dd3-Ec2 Dd5-Cc4 Ac1-Bc2 Cc4-Bd5 Ae5-Aa5 Ea5-Aa5 Aa4-Aa5 Ee5-Ee2 Ae2-Db2 Ee2-Ee1',
    'Aa5-Da5 Ee1-Be1 Da5-Da4 Be1-Be2 Bc2-Ad2 Be2-Ba2 Ec2-Ca4 Bd5-Ce5 Ca4-Db3 Ba2-Ba1',
    'Db2-Dc1 Ba1-Ba3 Ad2-Bc2 Db4-Cb4 Da4-Da3 Cb4-Bb4 Da3-Ba3 Bb4-Ba3 Dc1-Bc3 Bc5-Bc4',
    'Bc3-Bd4 Ce5-Bd4 Bd3-Bc4 Cc5-Bc4 Bc2-Ab2 Bd4-Cd3 Bc1-Cc1 Bc4-Bc3 Ab2-Ba3 Cd3-Bd2',
    'Cd2-Cd3 Bc3-Bc2 Cd3-Ce4 De5-Ce4 Cc1-Dc1 Bc2-Bc1 Ba3-Cb3 Bc1-Ac1=Q Db3-Ec2 Ac1-Ab1',
    'Cb3-Cb2 Ab1-Bc2 Cb2-Db2 Bc2-Bb2 Db2-Dc2 Bb2-Cc1 Dc2-Db3 Cc1-Cb1 Ca2-Ca3 Cb1-Dc1',
    'Ec2-Ce4 Dc1-De3 Db3-Cb3 De3-Cd3 Cb3-Db4 Cd3-Cc3 Db4-Db5 Bd2-Cc2 Db5-Ec4 Cc3-Dc3',
    'Ec4-Eb5 Cc2-Cb3 Ca3-Da3 Dc3-Dc4 Eb5-Ea4 Dc4-Da4',
  ],
  // 80001: Black mates, 154 plies
  [
    'Ad1-Cc1 Eb5-Ec3 Be2-Be3 Dd4-Cd4 Aa2-Ba3 Da4-Ca4 Ba3-Ab3 Eb4-Ea3 Aa1-Aa3 Ea3-Da4',
    'Ab3-Cd3 Dd5-Dd4 Cd3-Bd4 Ed5-Cc5 Ab1-Ac3 Dc4-Cc4 Bd4-Bc5 Db5-Cb5 Ac3-Ab5 Cc5-Dc3',
    'Bc5-Ac4 Ca4-Ba4 Cc1-Dc3 Ed4-Dc3 Aa3-Aa4 Ec4-Ed4 Bc2-Cc2 Cc4-Cc3 Cc2-Dc3 Dd4-Dc3',
    'Ab5-Cc5 Da5-Ca5 Cc5-Bc3 Cb5-Cb4 Ad2-Da2 Db4-Db3 Da2-Eb2 Cb4-Bb4 Bc3-Bd5 Bb4-Ac4',
    'Eb2-Ec3 Ed4-Dd5 Bd5-Bc3 Ec5-Db4 Ec3-Cc5 Ee4-Aa4 Ac2-Aa4 Dd5-Ec4 Aa4-Bb4 Db4-Eb3',
    'Bb4-Eb1 Eb3-Db4 Eb1-Db1 Ec4-Ed5 Db1-Ae4 Db4-Eb4 Cc5-Dc4 Eb4-Eb3 Dc4-Cd4 Ee5-Ee4',
    'Ae4-Ac4 Db3-Cb3 Bb2-Cb3 Dc3-Cb3 Ac4-Ab3 Ed5-Cd5 Ab3-Cb1 Eb3-Ec4 Bc3-Cc5 Ec4-Db4',
    'Cb1-Db2 Db4-Cb5 Cc5-Cb3 Ca5-Ca4 Cb3-Ec3 De4-Cd4 Ec3-Ee4 Da4-Bc4 Ee4-Ed2 Ea5-Aa5',
    'Ae1-Ad1 Aa5-Aa1 Ac1-Ac2 Aa1-Ad1 Ac2-Ad1 Cd5-Ad3 Ad1-Ac1 Ad3-Ac3 Ac1-Ab1 Ac3-Ae1',
    'Ab1-Bb2 Ae1-Ac3 Bb2-Aa1 Ac3-Aa5 Aa1-Ab1 Aa5-Ae1 Ab1-Bb2 Ae1-Ac3 Bb2-Ca2 Ac3-Ac2',
    'Ca2-Da3 Ac2-Ae2 Ab2-Cd4 Bc4-Cd4 Ed2-Ec4 Ae2-Ad2 Db2-Eb3 Cb5-Bb4 Ec4-Cd4 Ad2-Cd4',
    'Da3-Ea4 Cd4-Ab2 Eb3-Cb1 Ba4-Ba3 Ea4-Db3 Ba3-Aa3 Db3-Cc2 Cc3-Bc3 Cb1-Bc2 Bc3-Ac3',
    'Bc2-Be4 Bb4-Aa5 Bd2-Bd3 Ac3-Ac2 Be4-Ad5 Aa5-Ba4 Ad5-Bc4 Ba4-Ba3 Bc4-Bc5 Ba3-Aa2',
    'Bc5-Ac4 Aa2-Ab1 Ac4-Ae4 Ab1-Aa1 Cc2-Cd3 Ac2-Ac1=Q Ae4-Aa4 Ac1-Bc1 Aa4-Ca4 Ab2-Bc3',
    'Cd3-Be4 Bc1-Bd1 Be4-Ce5 Bd1-Bd3 Ce5-De4 Bc3-Cc3 Ca4-Ec4 Bd3-Ce3 De4-Ed3 Ce3-Dd2',
    'Ed3-De4 Cc3-Dd4 Ec4-Dd4 Dd2-Dd4',
  ],
];

/** Every game of the demo, as moves (`Ad1-Cc1`, `Ed5-Ed1=Q`). */
export const DEMO_GAMES: readonly (readonly string[])[] = GAMES.map((lines) =>
  lines.join(' ').split(' '),
);

/**
 * Every move of every game as the server would echo it. Built once: the log
 * for a ply is a slice of these, so deriveHistory sees the same message
 * objects from one ply to the next and hands back its previous result while
 * the ply is unchanged.
 */
const MESSAGES: readonly (readonly MoveMade[])[] = DEMO_GAMES.map((game) =>
  game.map((move, i) => {
    const [from, rest] = move.split('-');
    const [to, promotion] = rest.split('=');
    return {
      type: 'move_made',
      by: i % 2 === 0 ? 'white' : 'black',
      from,
      to,
      ...(promotion ? { promotion: promotion as Promotion } : {}),
    };
  }),
);

/** Game `game`'s message log once `ply` moves have been played. */
export const demoLog = (game: number, ply: number): WebSocketMessage[] => {
  const messages = MESSAGES[game];
  return messages.slice(0, Math.max(0, Math.min(ply, messages.length)));
};

/** The demo's pace, in seconds. */
export const DEMO_PACE = {
  /** The opening position, before the first move. */
  open: 2,
  /** From one move to the next (a glide takes about half a second of it). */
  ply: 1.8,
  /** The mate, the king's fall and the result, before the board fades. */
  mate: 5,
  /** The veil closing over the finished game (easing in)... */
  fadeOut: 0.7,
  /** ...and opening on the next one (easing out). */
  fadeIn: 0.9,
} as const;

/** One pass of game `game`: the opening, every move, the mate's hold and the fade out and in. */
export const passSeconds = (game: number): number =>
  DEMO_PACE.fadeIn +
  DEMO_PACE.open +
  (DEMO_GAMES[game].length - 1) * DEMO_PACE.ply +
  DEMO_PACE.mate +
  DEMO_PACE.fadeOut;

/** Every game once, whatever their order. */
export const DEMO_LOOP_SECONDS = DEMO_GAMES.reduce((sum, _, game) => sum + passSeconds(game), 0);

/**
 * An order to play the games in: each once, shuffled (Fisher–Yates) with
 * `random`, so the page opens on any of them and the loop runs through the
 * rest before it comes round again.
 */
export function demoOrder(random: () => number = Math.random): number[] {
  const order = DEMO_GAMES.map((_, game) => game);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export interface DemoFrame {
  /** Which pass this is, from 0, counting every game played: a new pass starts a fresh board. */
  pass: number;
  /** Which game the pass plays (an index into DEMO_GAMES). */
  game: number;
  /** Moves played. */
  ply: number;
  /** How far the veil over the board has closed: 0 open, 1 shut (the board is swapped under it). */
  veil: number;
}

/**
 * Where the demo stands `seconds` after it started, playing the games in
 * `order` and then round again. Each pass fades in on the opening position,
 * holds it, plays a move every DEMO_PACE.ply, holds the mate, and fades out;
 * the next starts under the closed veil. The very first pass opens without
 * a fade: the page arrives on the board.
 */
export function demoFrame(seconds: number, order: readonly number[]): DemoFrame {
  const t = Math.max(0, seconds);
  const round = Math.floor(t / DEMO_LOOP_SECONDS);
  let s = t - round * DEMO_LOOP_SECONDS;
  let at = 0;
  while (at < order.length - 1 && s >= passSeconds(order[at])) s -= passSeconds(order[at++]);
  const game = order[at];
  const pass = round * order.length + at;
  const length = passSeconds(game);
  const { open, ply: step, fadeIn, fadeOut } = DEMO_PACE;
  // The veil opens easing out (quick, then settling) and closes easing in
  const opening = pass === 0 ? 0 : Math.max(0, 1 - s / fadeIn) ** 2;
  const playFrom = fadeIn + open;
  const moves = DEMO_GAMES[game].length;
  const ply = s < playFrom ? 0 : Math.min(moves, 1 + Math.floor((s - playFrom) / step));
  const outFrom = length - fadeOut;
  const closing = s <= outFrom ? 0 : Math.min(1, (s - outFrom) / fadeOut) ** 2;
  return { pass, game, ply, veil: Math.max(opening, closing) };
}
