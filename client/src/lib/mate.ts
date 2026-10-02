// How a checkmate plays out, shared by the scene (Board, the mated king, the
// pulse) and the screen (when the result card comes). Kept apart from the
// scene, so the screen can read it without loading three.js.
//
// The mating piece knocks the king over (three/pieceMotion.tsx, KNOCK_FALL);
// as he strikes the floor a pulse of light spreads across his level, and a
// moment later the winning army hops in a wave out from him.

export const MATE_TUNING: Readonly<{
  knockLeadMs: number;
  pulseSpeed: number;
  waveSpeed: number;
  waveDelayMs: number;
}> = {
  /**
   * How long before the mating piece comes to rest its arrival counts (ms):
   * the glide eases in so slowly at its end that the piece looks landed a
   * moment before it is, and the knock lands then (a check's strike too).
   */
  knockLeadMs: 85,
  /** How fast the pulse of light spreads across the mated king's level (world units a second). */
  pulseSpeed: 4.5,
  /** How fast the winners' wave of hops travels out from the king (world units a second). */
  waveSpeed: 15,
  /** How long after the king strikes the floor the wave sets off (ms). */
  waveDelayMs: 370,
};

/** How long the final board is held after the king strikes the floor before the result card comes (ms). */
export const MATE_HOLD_MS = 1300;
