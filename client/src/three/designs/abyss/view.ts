// Facts about the view that several parts of the design react to, written once
// a frame by the decks (decks.tsx, always mounted) and read by the pieces'
// floor marks and the marks of play. Uniform-shaped where a shader reads them.

export const view = {
  /** 0 up to about 58° of elevation, 1 from about 75°: how nearly top-down the view is. */
  steep: { value: 0 },
  /** 0 up to about 50°, 1 from about 62°: the level ticks under the pieces fade in. */
  ticks: { value: 0 },
  /** 1 below about 12° of elevation, 0 from about 18°: how low the view is. */
  low: { value: 0 },
  /** 0 below about 15°, 1 from about 25°: the water behind the tower darkens. */
  raised: { value: 0 },
  /** Eased focus weight per level (1 for the level in play), and whether any level is focused. */
  focus: [0, 0, 0, 0, 0],
  anyFocus: 0,
};

/** How much a level is in play (1) or receding (0): all in play while nothing is focused. */
export const inPlay = (level: number) => 1 - view.anyFocus * (1 - (view.focus[level] ?? 0));
