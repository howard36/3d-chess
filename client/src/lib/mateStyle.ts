// How a checkmate plays out, shared by the scene (Board, the mated king) and
// the screen (when the result card comes, and where). Kept apart from the
// scene, so the screen can read it without loading three.js.

/**
 * The mating piece knocks the king over (three/pieceMotion.tsx, KNOCK_FALL), and
 * as he strikes the floor the winning army hops in a wave out from him. The
 * final board is held this long after he strikes (ms), the wave included,
 * before the result card comes.
 */
export const MATE_HOLD_MS = 1600;
