// The tutorial opened from a game leads back to it: the game's page hands
// its address over in the router's state, and the tutorial keeps it as it
// moves from lesson to lesson.

/** What a page opening the tutorial hands it: the game to lead back to. */
export interface LearnState {
  back: string;
}

/** The game page the tutorial leads back to, if it was opened from one. */
export const backToGame = (state: unknown): string | null => {
  const back = (state as Partial<LearnState> | null)?.back;
  return typeof back === 'string' && /^\/(game|computer)\/[^/]+$/.test(back) ? back : null;
};
