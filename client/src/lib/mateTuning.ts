// The mate's timings, shared by the scene (Board) and the pulse (scene/fx.tsx).

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
