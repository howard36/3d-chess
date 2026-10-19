// The landing page's demo: real games the board plays on its own, one after
// another, over and over. Like a live game each is a message log (move_made
// messages) replayed by deriveHistory, so the board it shows is exactly what
// the game screen would.

import type { MoveMade, Promotion, WebSocketMessage } from '../types/messages';

/**
 * Seven games the computer played against itself on Hard, chosen from a
 * thousand (research/levels/selfplay.ts, games 0–999) for something happening
 * all the way through: after the opening, never more than 10 plies without a
 * capture, a check or a promotion (once 14, in the bishop's game), and a mate
 * soon after the game is decided rather than a long chase. Between them: both
 * sides winning, short games and long ones, queens traded early, late and
 * never, no promotion and two, a lead thrown away, and a bishop's mate beside
 * the queens'. Moves as the wire has them (`=Q` on a promotion), White first.
 */
const GAMES: readonly (readonly string[])[] = [
  // 900: White mates, 89 plies
  [
    'Ab1-Cc1 Da4-Da3 Bb2-Bb3 Dc5-Cc5 Ab2-Bc3 Eb5-Db3 Ad1-Ce1 Dc4-Cc4 Aa2-Bb2 Cc4-Bc3',
    'Bd2-Bc3 Da5-Ca5 Ac2-Ad3 Ca5-Ca4 Ac1-Ac2 Eb4-Ec3 Ae2-Bd3 Cc5-Cc4 Bb1-Cb1 Ec3-Cc1',
    'Bd1-Cc1 Cc4-Bc3 Bb2-Bc3 Ed5-Cc5 Bc3-Cc2 Ec4-Dc5 Bc2-Bc3 Ee4-Ec2 Ad2-Bc2 Ec5-Ed5',
    'Cc2-Ea2 Cc5-Ec4 Cc1-Dc1 Ec2-Bc5 Ea2-Ec4 Ed5-Ec4 Ad3-Bc4 Ec4-Eb5 Bc4-Cc3 Db4-Cb4',
    'Cc3-Ec3 Dd4-Cd4 Ae1-Ae3 Ee5-Ee4 Ac2-Ab2 De4-Ce4 Bd3-Cc2 Cb4-Bb3 Ba2-Bb3 Ce4-Be4',
    'Cc2-Db3 Dc5-Ba3 Ab2-Ab1 Be4-Ae3 Ec3-Ec5 Eb5-Da4 Ec5-Dd5 Ea4-Db3 Dd5-Ee4 Ed4-Dc3',
    'Ee4-De4 Da4-Ea4 De4-Ae4 Cd4-Bd4 Bc3-Bd4 Ba3-Ab3 Ab1-Bb1 Bc5-Ad5 Ae4-Ee4 Ea4-Da4',
    'Ee4-De5 Dc3-Be1 Bd4-Cd4 Da4-Cb3 Bc2-Ab2 Ab3-Ad3 De5-Db5 Ad3-Be4 Bb1-Ac1 Be4-Be2',
    'Db5-Cb4 Cb3-Da2 Cb1-Cb2 Da2-Ea1 Ba1-Ba2 Ea1-Db1 Cb4-Db3 Db1-Ec1 Db3-Ec2',
  ],
  // 952: Black mates, 110 plies
  [
    'Ba2-Ca2 Ee4-Eb1 Bb2-Bb3 Ed4-Dc3 Ad1-Bd3 Ed5-Cc5 Ab1-Ca1 Eb1-Ed3 Bc2-Cc2 Dc3-Cb4',
    'Bb3-Cb4 Eb5-Cb4 Be2-Ce2 Ec4-Eb3 Aa2-Bb2 Ea4-Db3 Bd3-Bb4 De4-Ce4 Ae2-Db5 Eb4-Db5',
    'Ad2-Dd5 Ec5-Ec4 Bb4-Cb2 Eb3-Ed1 Dd5-Cc5 Db5-Cc5 Ab2-Bc3 Cb4-Cd5 Bb2-Cb1 Ed1-Bd4',
    'Bc1-Bc2 Ea5-Ea1 Ca1-Dc1 Dc4-Dc3 Be1-Be2 Ea1-Eb1 Bc3-Da5 Eb1-Cb1 Cc2-Dc3 Dd4-Dc3',
    'Ba1-Cb1 Dc5-Dc4 Bc2-Bc3 Bd4-Ad5 Ac2-Dc2 Ad5-Ad3 Dc2-Eb3 Ec4-Dd4 Cb2-Db4 Ee5-Ea5',
    'Dc1-De2 Dd4-Ec5 Eb3-Eb4 Ec5-Ed5 Eb4-Eb3 Db3-Ec4 Bd2-Bd3 Ad3-Ac3 Ac1-Bc1 Cd5-Ec5',
    'Eb3-Eb2 Cc5-Ee5 Eb2-Bb2 Ed3-Cd1 Bc1-Cb2 Ec5-Eb3 Cb2-Ca1 Ac3-Ce5 Ca1-Da2 Eb3-Ec1',
    'Ae1-Ee1 Ec1-Ed3 Ee1-Ee5 Ed3-Ee5 Da5-Eb4 Ec4-Ce2 De2-Dc3 Ce5-Ec3 Dc3-Cc5 Ed5-Ec5',
    'Eb4-Cd2 Ec5-Dc5 Cc5-Ce4 Ee5-Ce4 Db4-Bb5 Dc5-Ec5 Be2-Be3 Ce4-Cc5 Bd3-Bd4 Cc5-Ca4',
    'Da2-Db1 Ce2-Bd3 Bb2-Cc2 Bd3-Cc2 Cb1-Cc2 Ec3-Dd3 Db1-Da1 Dd3-Dd1 Da1-Cb1 Dd1-Cc2',
    'Cb1-Da1 Ca4-Ea3 Da1-Da2 Cc2-Ca2 Da2-Eb2 Ca2-Db3 Eb2-Ea1 Ea3-Cb3 Ea1-Da1 Db3-Db1',
  ],
  // 107: White mates, 129 plies
  [
    'Bd2-Cd2 Eb4-Ed2 Ab1-Ac3 Dc5-Cc5 Ab2-Bc3 Ea4-Db3 Ae2-Bd3 Eb5-Ec3 Bc3-Da5 Da4-Ca4',
    'Ac2-Bc3 Db4-Cb4 Bc3-Ba5 Ee4-Ed3 Ba2-Ba3 Ca4-Ba3 Aa2-Ba3 De4-De3 Bd3-Cc2 Ee5-Ee1',
    'Ba5-Cb5 Ed3-Ba3 Ac3-Ba3 Ed2-Ec1 Ad2-Ae3 Ec4-Dc3 Ae3-Be4 Ee1-Ee5 Cc2-Db3 Dc3-Da5',
    'Cb5-Eb3 Da5-Eb4 Eb3-Db2 Ee5-Ee4 Db3-Ca4 Eb4-Ea3 Db2-Bd4 Ea3-Da3 Ca4-Db5 Ee4-Be4',
    'Bd4-Be4 Ed5-Db5 Be4-Ce3 Da3-Ea3 Be1-Ce1 Cb4-Bb4 Ba3-Ac3 De5-De4 Ce3-Ae5 Bb4-Ab4',
    'Ac3-Cc2 Ec5-Ed5 Cc2-Ec3 Ea3-Ec3 Ae5-Ae3 Dd4-Cd4 Bd1-Bd2 Ea5-Ec5 Ba1-Ba2 Cc5-Cc4',
    'Ad1-Cc1 Ec1-Ce1 Ae1-Ce1 Ec3-Ce1 Ac1-Ab1 Dd5-Dd4 Bd2-Bd3 Ce1-Ac3 Ae3-Ac3 Ab4-Ac3',
    'Aa1-Aa5 Ec5-Ec1 Cc1-Ca2 Dc4-Dc3 Ab1-Ac2 Cc4-Bc4 Bd3-Bc4 Cd4-Bc4 Bb2-Bb3 Dd4-Cd4',
    'Aa5-Ab5 Db5-Da3 Ba2-Ba3 Da3-Ca5 Ab5-Ad5 Ed5-Dd4 Ca2-Dc2 Dd4-Dc4 Bb3-Bc4 Cd4-Bc4',
    'Bb1-Bb2 Ca5-Cc4 Dc2-Cc4 Dc4-Cc4 Bc2-Bc3 Cc4-Cb5 Bc1-Bc2 Ed4-Dc5 Ad5-Ad3 De4-Ce4',
    'Bb2-Bb3 Ce4-Be4 Bb3-Bc4 Cb5-Bc4 Ad3-Ac3 Ec1-Ac1 Ac2-Ac1 Bc4-Ac3 Bc3-Cc3 Dc5-Ba3',
    'Cc3-Cc4 Be4-Be3 Cc4-Dc4 Dc3-Cc3 Dc4-Ec4 Cc3-Bc2 Ac1-Bc1 Ba3-Ab2 Bc1-Cc2 Bc2-Bc1',
    'Ec4-Ec5=Q Ac3-Bd4 Ec5-Cc3 Bd4-Ad5 Cc2-Bd3 De3-Ce3 Be2-Ce3 Ad5-Bc5 Cc3-Bc4',
  ],
  // 303: Black mates, 124 plies
  [
    'Ab1-Ca1 Ed5-Ec3 Bd1-Cd1 De5-Ce5 Aa2-Ac4 Dd4-Cd4 Ad2-Ac3 Eb5-Cb4 Ac2-Bb3 Dc4-Cc4',
    'Be2-Be3 Cc4-Cc3 Bc2-Cc3 Cb4-Ac4 Ac3-Bc2 Ec5-Ed5 Ae2-Bd3 Cd4-Bd3 Ad1-Bd3 Ed4-Dc3',
    'Bc1-Cc1 Db4-Cb4 Bb3-Ac3 Ec4-Cc4 Cd1-Cd2 Dd5-Dd4 Cd2-Cd3 Cc4-Bc4 Cd3-Dc3 Bc4-Ac3',
    'Bc2-Ac3 Cb4-Cc3 Bd3-Cb3 Ec3-Cb3 Ca1-Cb3 Eb4-Dc4 Dc3-Ec3 Da4-Ca4 Aa1-Aa4 Ac4-Be4',
    'Ac3-Ca3 Ca4-Cb3 Ca3-Ea5 Cc3-Cc2 Ac1-Ac2 Ed5-Dd5 Ea5-Eb4 Cc2-Bd2 Be1-Bd2 Dd4-Dd3',
    'Eb4-Dc4 Dd5-Dc4 Aa4-Ba4 Ee4-Cc4 Ac2-Ad3 Be4-De3 Ae1-De1 De3-Cc3 Ad3-Bc2 Cb3-Bb2',
    'Ba1-Bb2 Dc4-Ec3 De1-De4 Db5-Cb5 Ba4-Bc4 Ee5-Ee3 De4-De5 Ee3-Ce3 Bc4-Cc4 Cb5-Cc4',
    'Ab2-Ba3 Ec3-Ec4 De5-Dc5 Cc3-Dc5 Ba3-Dc5 Ec4-Dc5 Cc1-Dc1 Da5-Da4 Dc1-Ec1 Dc5-Db4',
    'Ba2-Ca2 Ce3-Ce1 Ca2-Da2 Ce1-Ee1 Bc2-Cb2 Ee1-Ec1 Da2-Da3 Db4-Ea3 Cb2-Db1 Ec1-Ec3',
    'Da3-Ea4 Ea3-Ea4 Db1-Cc2 Ea4-Db4 Cc2-Dd3 Cc4-Bc4 Dd3-Dd4 Bc4-Ac4 Dd4-Ce5 Db4-Cc3',
    'Bb2-Cb2 Cc3-Bd2 Bb1-Cb1 Ac4-Ac3 Ce5-Dd4 Ac3-Ac2 Be3-Be4 Ec3-Bc3 Dd4-Cc4 Ac2-Ac1=Q',
    'Be4-Be5 Ac1-Bb2 Be5-Ce5 Bb2-Bb3 Cc4-Cd5 Bb3-Cb2 Ce5-De5 Bd2-Cd3 Cd5-Dc5 Cb2-Cb4',
    'Dc5-Eb5 Cd3-Cc4 De5-Ee5=Q Cb4-Db4',
  ],
  // 961: White mates, 147 plies
  [
    'Ab1-Aa3 Ed5-Ee3 Ad1-Cc1 Eb4-Ec3 Ac2-Bb3 Ee4-Ec2 Ba2-Ca2 Eb5-Cb4 Bd2-Cd2 De5-Ce5',
    'Bc2-Cc2 De4-De3 Aa3-Bc3 Ea4-Db3 Cc1-Ec2 Ee3-Ec2 Cc2-Dc2 Ec3-Eb4 Be2-Ce2 Db3-Bd5',
    'Ba1-Ca1 Ee5-Ee2 Cd2-Dd2 De3-Dd2 Ce2-Dd2 Cb4-Bd4 Bb3-Ac2 Ec2-Cc3 Ac2-Cc2 Ec4-Cc2',
    'Bb2-Cc2 Ee2-Ee4 Aa2-Bb2 Dc4-Cc4 Bc3-Ce3 Ee4-Ce4 Ce3-Cd1 Dc5-Dc4 Ad2-Bc2 Bd4-Bc2',
    'Bd1-Bc2 Cc3-Ca4 Ac1-Bd1 Ce4-Ee4 Bb2-Ba3 Dd5-Cd5 Ba3-Ca4 Da5-Ca4 Dd2-Ed2 Ca4-Ca3',
    'Cd1-Ce3 Ee4-Ce4 Ce3-Cd5 Ec5-Dd5 Cd5-Ac5 Bd5-Ac4 Bb1-Bb2 Ea5-Ec5 Ae2-Cc4 Db4-Cc4',
    'Ac5-Ad3 Dd4-Dd3 Bc1-Cc1 Ec5-Cc5 Aa1-Aa4 Dd3-Dc2 Cc1-Dc2 Ac4-Bb5 Aa4-Ae4 Cc4-Bc4',
    'Ae4-Ce4 Dd5-Ce4 Ad3-Cd2 Ce4-Dd5 Cd2-Cb3 Eb4-Ec5 Cb3-Bb5 Bc4-Ac4 Ab2-Bc3 Dc4-Cc4',
    'Dc2-Ec2 Cc5-Cb5 Bb5-Da5 Cb5-Cb1 Ca1-Da1 Ed4-De3 Ed2-Ed3 Cc4-Bc3 Bb2-Bc3 Ec5-Ed4',
    'Bd1-Ad2 Dd5-De4 Cc2-Dc2 De4-Dd4 Ae1-Ac1 Dd4-Dc3 Da5-Ea3 Dc3-Dc2 Ac1-Ac4 Dc2-Db3',
    'Ea3-Ec4 Ed4-Ec5 Ac4-Ac5 Ec5-Eb4 Ad2-Ad3 Eb4-Ec3 Ec4-Cc3 Cb1-Cb4 Ca2-Da2 Db3-Dc3',
    'Ac5-Dc5 Dc3-Dd4 Ad3-Bc4 Ec3-Dd3 Dc5-Ac5 Dd3-Cd4 Bc4-Bd4 Ce5-Be5 Bd4-Be5 Cd4-Cc3',
    'Bc2-Cc3 Dd4-Cc3 Be5-Ad4 Cc3-Cb2 Bc3-Bc4 Cb4-Ca4 Da2-Ea2 Cb2-Da1 Ec2-Ec3 Ca4-Aa4',
    'Ad4-Bd3 Aa4-Ba4 Ec3-Ec4 Da1-Ea2 Ec4-Ec5=Q Db5-Cb5 Ec5-Ca5 Cb5-Cb4 Bc4-Cb4 Da4-Cb4',
    'Ca5-Cb4 Ba4-Ba1 Bd3-Cc2 De3-Bc1 Cb4-Db3 Ea2-Eb1 Db3-Db2',
  ],
  // 416: Black mates, 158 plies
  [
    'Bd2-Cd2 Ed5-Ec3 Ab1-Bb3 Ea4-Db3 Bb2-Cb2 Db3-Ca4 Be2-Be3 De4-Ce4 Ae2-Db5 Eb4-Db5',
    'Bd1-Bd2 Db4-Cb4 Aa2-Ca4 Da5-Ca4 Bb3-Bc5 Da4-Da3 Ad1-Ce1 Ce4-Be3 Ce1-Be3 Dd5-Cd5',
    'Bc5-Ce5 Ed4-De3 Ad2-Be2 Db5-Cc5 Ba2-Ba3 Ca4-Ba3 Ab2-Ba3 Cb4-Bb4 Be3-De4 Ec4-Dd5',
    'De4-Dc5 Ee5-Ed5 Ac2-Ac5 Bb4-Ba3 Be2-De4 Dd5-Dc5 De4-Ee3 De3-Ed4 Ce5-Dc5 Ec5-Dc5',
    'Ac5-Ab4 Eb5-Ca5 Ee3-Aa3 Ec3-Eb5 Ab4-Ba5 Dc5-Dd5 Ba5-Bc3 Ed4-Cb2 Bc3-Bb3 Ca5-Cc4',
    'Bb1-Cb2 Ea5-Ba5 Bc2-Bc3 Ba3-Ba2 Aa1-Ab1 Cc5-Bd5 Bb3-Aa2 Dd4-Cd4 Bc1-Cc1 Eb5-Ec3',
    'Ac1-Ad2 Ed5-Ed2 Ab1-Db1 Ee4-Dd4 Aa2-Ca4 Cc4-Cb2 Ca4-Ba5 Ed2-Cd2 Cc1-Cb2 De5-Ce5',
    'Aa3-Ba2 Bd5-Ba2 Db1-Db5 Dd5-Ec5 Ad2-Bc1 Ba2-Bb3 Ba5-Aa5 Bb3-Db5 Aa5-Ee5 Ec5-Ec4',
    'Bc1-Cd2 Ec3-Dc5 Ee5-Ee2 Ec4-Dd5 Ee2-Aa2 Dd5-De4 Be1-Be2 Db5-Ca5 Cd2-Bc2 Dc5-Dd3',
    'Aa2-Ca4 Ca5-Ec5 Ca4-Da3 Dd4-Bd2 Ae1-De1 De4-Ee5 Da3-Eb2 Ee5-Dd4 De1-Dd1 Dc4-Cc4',
    'Bc2-Cd2 Ec5-Ca5 Cd2-De2 Ca5-Db5 Dd1-Dd3 Db5-Dd3 De2-Dd2 Dd3-Bb3 Eb2-Ec3 Dd4-De5',
    'Ec3-Db3 Cc4-Cc3 Ba1-Ba2 Bb3-Bc4 Db3-De3 De5-Dd5 Be2-Be3 Cc3-Cc2 De3-Dd3 Dd5-Cc5',
    'Dd3-Ec3 Cc5-Bc5 Ba2-Ba3 Ce5-Be5 Ba3-Ca3 Bc5-Ad4 Cb2-Db2 Bc4-Cc3 Ec3-Cc5 Bd2-Bc3',
    'Be3-Ce3 Cc3-Bc4 Cc5-Aa3 Cd4-Ce3 Dd2-Ce3 Cd5-Cd4 Ce3-Dd4 Cc2-Bc2 Aa3-Aa4 Ad4-Bc5',
    'Aa4-Ca2 Bc2-Bc1 Ca2-Bb1 Bc3-Bd2 Dd4-Ce5 Bc4-Cc3 Db2-Db3 Be5-Ae5 Ce5-Be5 Bd2-Bc3',
    'Be5-Ae5 Bc1-Ac1=Q Bb1-Ac1 Cc3-Ac1 Db3-Eb3 Bc3-Bd4 Eb3-Eb4 Ac1-Ab2',
  ],
  // 284: White mates, 161 plies
  [
    'Be1-Ce1 Eb5-Db3 Be2-Ce2 Ed5-Dd3 Ab1-Aa3 Dc4-Cc4 Ce2-De2 Dd3-Dc1 Bd1-Cd1 Dc1-Ec3',
    'Ae2-Bd1 Db3-Bb4 Bc2-Bc3 Ea4-Bd1 Ac1-Bd1 Bb4-Ad4 Ac2-Ac1 Eb4-Dc4 Ac1-Ac3 Ea5-Ea3',
    'Ac3-Ad4 Ea3-Aa3 Bc3-Cc4 Dd4-Cc4 Bb2-Cb2 Ed4-Dc3 Cd1-Cd2 Ee4-Eb1 Ad2-Ac1 Aa3-Aa2',
    'Aa1-Aa2 De5-Ce5 Ad1-Cc1 Ec3-Dc1 Bd1-Ad2 Ec4-Ec1 Ac1-Dc4 Dd5-Dc4 Ad2-Ac2 Ec5-Eb5',
    'Bb1-Cb1 Dc1-Cc3 Cb2-Cc3 Ec1-Cc1 Ad4-Ac3 Cc1-Ec3 Ac3-Ac5 Ce5-Be5 Ab2-Ba3 Db4-Cb4',
    'Cc3-Dc4 Ec3-Dc4 Ac5-Bb5 Ee5-Ee1 Bb5-Bb1 Dc4-Ec3 Cd2-Cd3 Cc4-Cd3 Bb1-Ab1 Eb5-Eb4',
    'Ab1-Cd3 Dc3-Ba1 Cd3-De4 Ec3-Cc1 De4-Cd4 Dc5-Dc4 Cd4-De3 Eb1-Cb3 Ba3-Dc1 Cb3-Cc4',
    'Ac2-Ad2 Ba1-Dc3 De3-Ce4 Cb4-Cb3 Dc1-Ed2 Dc3-Cb4 Ed2-Cb4 Dc4-Cb4 Bc1-Bc2 Cc4-Dc5',
    'Aa2-Aa1 Db5-Cb5 Bd2-Cd2 Eb4-Ea5 Ce1-Ce2 Cb5-Bb5 Aa1-Ac1 Cc1-Ea1 Ae1-Ee1 Ea1-Ee1',
    'Ac1-Dc1 Ee1-Aa5 Ad2-Bd3 Dc5-Bc3 De2-De3 Aa5-Ac5 Ce4-Be4 Bb5-Bb4 Cd2-Cd3 Ac5-Ac4',
    'Bd3-Cd2 Ac4-Ab4 Cd2-De2 Ab4-Aa3 Be4-Bd5 Ea5-Db4 Cd3-Dd3 Aa3-Ab2 Dc1-Dc2 Ab2-Ab1',
    'Dc2-Db2 Db4-Ca4 Bd5-Db5 Ca4-Ba3 Db5-Da5 Ba3-Ab4 Db2-Dc2 Ab1-Ba2 De2-Cd2 Ba2-Cb1',
    'Da5-Da4 Ab4-Ba5 De3-De4 Cb1-Eb1 Da4-Da3 Ba5-Cb5 De4-De5 Eb1-Be1 Cd2-Ce3 Be1-Bd2',
    'Ce3-De2 Bd2-Be2 Da3-Eb2 Bc3-De3 De5-Ee5=Q Be2-Ce2 De2-Ed2 Bb4-Ab4 Dc2-De2 Ce2-Cc2',
    'De2-De3 Ab4-Ab3 Ee5-Ce5 Cb5-Da4 Ce5-Be5 Da4-Ca5 Eb2-Ec3 Ca5-Cb5 Be5-Cd5 Cb5-Ba4',
    'Ec3-Ca5 Ba4-Aa4 Ca5-Cb4 Cc2-Ea2 Ed2-Ec3 Ea2-Ba2 Cd5-Cc4 Aa4-Aa3 Cb4-Bb3 Ba2-Bb3',
    'Cc4-Bb3',
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
