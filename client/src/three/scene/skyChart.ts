import { BufferAttribute, BufferGeometry, Color, Vector3 } from 'three';
import { rng } from './textures';
import { LEVEL_COLORS, PALETTE } from './palette';
import type { Constellation, P2, Placement } from './skyPlace';
import { placeStar } from './skyPlace';

// The constellations drawn as a star chart draws them (the richer sky,
// envPreview `constellations: crafted | expanded`): each line runs whole from
// star to star (a hairline under each star's glow, so the joints stay clean),
// each figure has one brighter star, and its lines fade a little toward its
// base. Between today's eight (heavens.tsx) the expanded
// sky adds four smaller, dimmer figures, and anyone looking closely finds
// three asterisms with no figure drawn in lines (`skyEggs`):
// - castling: a small king and rook joined by the arc of their move, low
//   just past the tower from the opening's look up (turn a little right);
// - the fork: a small knight with two lines out to two bright stars, high
//   between the rook and the queen;
// - a pawn chain: five stars climbing a diagonal, each with a collar, low
//   between the pawn and the western knight;
// - the toppled king, lying on its side low over the horizon between the two
//   knights, the king that lost;
// - a knight's tour: 25 dim stars in a loose 5x5 lattice low behind White's seat
//   (look up the way the opening camera came from), whose path only a
//   tracing event lights (skyEvents.tsx);
// - the tower's echo: five stars climbing one above another, tinted in the
//   five level colours, cyan at the foot to rose at the top, between the
//   unicorn and the pawn;
// - the eight queens: eight stars set as a solution of the puzzle, each in
//   its square of the faintest 8x8 board drawn in whole hairlines round them,
//   low between the bishop and the rook.
// The low ones also stand above the horizon from the camera's 6° view.

const loop = (n: number, from = 0): [number, number][] =>
  Array.from({ length: n }, (_, i) => [from + i, from + ((i + 1) % n)]);

/** A small king and rook, the arc of castling over them. */
const CASTLING: Constellation = {
  stars: [
    // The king: its foot, shoulders, crown and cross
    [0.07, 0.0],
    [0.27, 0.0],
    [0.23, 0.4],
    [0.17, 0.5],
    [0.11, 0.4],
    [0.17, 0.74],
    // The rook
    [0.74, 0.0],
    [0.96, 0.0],
    [0.96, 0.46],
    [0.74, 0.46],
    // The arc of the move
    [0.33, 0.88],
    [0.5, 0.96],
    [0.66, 0.83],
  ],
  marks: [
    // The cross's arm, the rook's crenel
    [0.12, 0.64],
    [0.22, 0.64],
    [0.81, 0.46],
    [0.81, 0.37],
    [0.89, 0.37],
    [0.89, 0.46],
  ],
  lines: [
    ...loop(5),
    [3, 5],
    [13, 14],
    [6, 7],
    [7, 8],
    [9, 6],
    [9, 15],
    [15, 16],
    [16, 17],
    [17, 18],
    [18, 8],
    [5, 10],
    [10, 11],
    [11, 12],
    [12, 9],
  ],
  alpha: 5,
};

/** The knight's outline (heavens.tsx keeps the big one; this is its shape). */
export const KNIGHT_SHAPE: P2[] = [
  [0.52, 1.0],
  [0.66, 0.84],
  [0.8, 0.6],
  [0.86, 0.28],
  [0.82, 0.0],
  [0.24, 0.0],
  [0.3, 0.3],
  [0.36, 0.42],
  [0.04, 0.48],
  [0.1, 0.66],
  [0.38, 0.86],
];

/** A small knight forking two bright stars. */
const FORK: Constellation = {
  stars: [
    ...KNIGHT_SHAPE.map(([u, v]): P2 => [0.3 + u * 0.42, v * 0.5]),
    [0.04, 0.96],
    [0.97, 0.88],
  ],
  lines: [...loop(11), [0, 11], [0, 12]],
  alpha: 11,
};

/**
 * Five pawns defending each other up a diagonal, each with its collar: a
 * short bar a little under its star, crossing the chain's line (never
 * standing off it on its own), the chain running on to the lowest pawn's.
 */
const PAWN_CHAIN: Constellation = (() => {
  const stars: P2[] = [0, 1, 2, 3, 4].map((i) => [0.1 + i * 0.2, 0.08 + i * 0.21]);
  // Where the chain's line passes a little under each star
  const neck = ([u, v]: P2): P2 => [u - 0.04 * (0.2 / 0.21), v - 0.04];
  const marks: P2[] = stars.flatMap((s): P2[] => {
    const [u, v] = neck(s);
    return [
      [u - 0.05, v],
      [u + 0.05, v],
    ];
  });
  marks.push(neck(stars[0]));
  return {
    stars,
    marks,
    lines: [
      ...[0, 1, 2, 3].map((i): [number, number] => [i, i + 1]),
      ...[0, 1, 2, 3, 4].map((i): [number, number] => [5 + 2 * i, 6 + 2 * i]),
      [0, 15],
    ],
    alpha: 4,
  };
})();

/** The king's outline, for the toppled king (heavens.tsx keeps the standing one). */
export const KING_SHAPE: Constellation = {
  stars: [
    [0.5, 1.0],
    [0.5, 0.78],
    [0.39, 0.9],
    [0.61, 0.9],
    [0.3, 0.7],
    [0.7, 0.7],
    [0.63, 0.32],
    [0.76, 0.06],
    [0.24, 0.06],
    [0.37, 0.32],
  ],
  lines: [[0, 1], [2, 3], [1, 4], [1, 5], ...loop(6, 4).slice(1), [9, 4]],
  alpha: 0,
};

/**
 * The smaller figures, in the gaps between the eight, each lower or higher
 * than its neighbours so no row of figures lines up round the sky; the low
 * ones (9°–15°) also stand above the horizon from the camera's 6° view.
 */
export const SKY_MINOR: Placement[] = [
  { c: KING_SHAPE, azimuth: 150, elevation: 10.5, size: 5, tilt: 1.5 },
  { c: CASTLING, azimuth: 204, elevation: 12.5, size: 6, tilt: 0.03 },
  { c: FORK, azimuth: 330, elevation: 23.5, size: 5.5, tilt: -0.04 },
  { c: PAWN_CHAIN, azimuth: 105, elevation: 12, size: 5, tilt: 0 },
];

/** A 5x5 knight's tour, the squares in the order the knight visits them (row by row, 1–25). */
export const TOUR_5X5 = [
  [1, 14, 9, 20, 3],
  [24, 19, 2, 15, 10],
  [13, 8, 23, 4, 21],
  [18, 25, 6, 11, 16],
  [7, 12, 17, 22, 5],
];

/** How far a tour star stands off its square's middle (of the lattice's side). */
const TOUR_NUDGE = 0.045;

const TOUR: Constellation = (() => {
  const stars: P2[] = [];
  const order: number[] = [];
  TOUR_5X5.forEach((row, r) =>
    row.forEach((n, c) => {
      order[n - 1] = stars.length;
      // Each a little off its square's middle, as real stars stand, so the
      // lattice's rows and columns never read as dotted rules
      const i = stars.length;
      stars.push([
        c / 4 + TOUR_NUDGE * Math.sin(i * 2.39 + 0.7),
        1 - r / 4 + TOUR_NUDGE * Math.sin(i * 3.77 + 2.1),
      ]);
    }),
  );
  return {
    stars,
    lines: order.slice(1).map((s, i): [number, number] => [order[i], s]),
  };
})();

/** Eight queens, none attacking another: the queen's row in each file. */
export const EIGHT_QUEENS = [0, 4, 7, 5, 2, 6, 1, 3];

/** The tower's echo: five stars stacked, A at the foot. */
const ECHO: Constellation = {
  // Leaning a little and stepping unevenly, as real stars stand: never a
  // ruled column of dots
  stars: [
    [0.42, 0],
    [0.58, 0.23],
    [0.48, 0.5],
    [0.66, 0.72],
    [0.57, 1],
  ],
  lines: [],
};

const QUEENS: Constellation = {
  stars: EIGHT_QUEENS.map((row, file): P2 => [file / 7, row / 7]),
  lines: [],
};

/**
 * The queens' board: its nine lines each way, whole hairlines (not a
 * lattice of points, which reads as dotted rules), each queen at the middle
 * of her square (the queens stand at k/7, the lines halfway between).
 */
const QUEENS_BOARD: Constellation = (() => {
  const at = (k: number) => (k - 0.5) / 7;
  const marks: P2[] = [];
  const lines: [number, number][] = [];
  for (let k = 0; k <= 8; k++) {
    for (const [a, b] of [
      [
        [at(k), at(0)],
        [at(k), at(8)],
      ],
      [
        [at(0), at(k)],
        [at(8), at(k)],
      ],
    ] as [P2, P2][]) {
      lines.push([marks.length, marks.length + 1]);
      marks.push(a, b);
    }
  }
  return { stars: [], marks, lines };
})();

export const EGG_PLAN = {
  tour: { c: TOUR, azimuth: 16, elevation: 14.5, size: 3.6, tilt: 0.02 } as Placement,
  echo: { c: ECHO, azimuth: 63, elevation: 16, size: 3.2, tilt: 0 } as Placement,
  queens: { c: QUEENS, azimuth: 285, elevation: 13, size: 3.5, tilt: -0.03 } as Placement,
  queensBoard: {
    c: QUEENS_BOARD,
    azimuth: 285,
    elevation: 13,
    size: 3.5,
    tilt: -0.03,
  } as Placement,
};

/** How one figure is drawn. */
export interface ChartEntry {
  plan: Placement;
  /** The figure's number in `aFigure`, for a tracing event (skyTrace). */
  id: number;
  /** Its stars' brightness, from–to (the alpha star is brighter still). */
  bright: [number, number];
  /** Its stars' size (CSS px), from–to. */
  size: [number, number];
  /** Its lines' strength, a share of the material's (0: lit only by a trace). */
  line: number;
  /** Each star's colour, if not the neon. */
  colors?: Color[];
  /** The brightest star's brightness and size. */
  alpha?: [number, number];
}

/** Star geometry: position, aSize, aBright, aColor. */
export const starBuffers = (pos: number[], size: number[], bright: number[], color: number[]) => {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aSize', new BufferAttribute(new Float32Array(size), 1));
  g.setAttribute('aBright', new BufferAttribute(new Float32Array(bright), 1));
  g.setAttribute('aColor', new BufferAttribute(new Float32Array(color), 3));
  return g;
};

const a3 = new Vector3();
const b3 = new Vector3();

/** One figure's stars and lines, appended to the lists. */
const drawEntry = (
  e: ChartEntry,
  random: () => number,
  s: { pos: number[]; size: number[]; bright: number[]; color: number[] },
  l: { pos: number[]; along: number[]; figure: number[]; base: number[] },
) => {
  const { plan } = e;
  const neon = new Color(PALETTE.neon);
  const all = [...plan.c.stars, ...(plan.c.marks ?? [])];
  const points = all.map((p) => placeStar(p, plan));
  plan.c.stars.forEach((_, i) => {
    s.pos.push(...points[i]);
    const isAlpha = e.alpha && plan.c.alpha === i;
    s.size.push(isAlpha ? e.alpha![1] : e.size[0] + random() * (e.size[1] - e.size[0]));
    s.bright.push(isAlpha ? e.alpha![0] : e.bright[0] + random() * (e.bright[1] - e.bright[0]));
    const c = e.colors?.[i] ?? neon;
    s.color.push(c.r, c.g, c.b);
  });
  for (const p of plan.c.loose ?? []) {
    s.pos.push(...placeStar(p, plan));
    s.size.push(1.6);
    s.bright.push(0.2);
    s.color.push(neon.r, neon.g, neon.b);
  }
  // The lines, whole from star to star, numbered along the figure
  const lengths = plan.c.lines.map(([i, j]) =>
    a3.fromArray(points[i]).distanceTo(b3.fromArray(points[j])),
  );
  const total = lengths.reduce((x, y) => x + y, 0) || 1;
  let run = 0;
  plan.c.lines.forEach(([i, j], k) => {
    a3.fromArray(points[i]);
    b3.fromArray(points[j]);
    l.pos.push(a3.x, a3.y, a3.z, b3.x, b3.y, b3.z);
    l.along.push(run / total, (run + lengths[k]) / total);
    run += lengths[k];
    l.figure.push(e.id, e.id);
    // A little quieter toward the figure's base
    const v = (all[i][1] + all[j][1]) / 2;
    const base = e.line * (0.72 + 0.28 * Math.min(Math.max(v, 0), 1));
    l.base.push(base, base);
  });
};

/** Stars and lines of some figures, for skyPointMaterial and skyLineMaterial. */
export const chartGeometry = (entries: ChartEntry[], seed = 71) => {
  const random = rng(seed);
  const s = {
    pos: [] as number[],
    size: [] as number[],
    bright: [] as number[],
    color: [] as number[],
  };
  const l = {
    pos: [] as number[],
    along: [] as number[],
    figure: [] as number[],
    base: [] as number[],
  };
  for (const e of entries) drawEntry(e, random, s, l);
  const lines = new BufferGeometry();
  lines.setAttribute('position', new BufferAttribute(new Float32Array(l.pos), 3));
  lines.setAttribute('aAlong', new BufferAttribute(new Float32Array(l.along), 1));
  lines.setAttribute('aFigure', new BufferAttribute(new Float32Array(l.figure), 1));
  lines.setAttribute('aBase', new BufferAttribute(new Float32Array(l.base), 1));
  return { stars: starBuffers(s.pos, s.size, s.bright, s.color), lines };
};

/** The figures' numbers: the eight from 0, the smaller from 10, the tour 20. */
export const FIGURE_ID = { minor: 10, tour: 20 } as const;

/** How the eight, the smaller figures and the asterisms are drawn. */
export const majorEntries = (plans: Placement[]): ChartEntry[] =>
  plans.map((plan, i) => ({
    plan,
    id: i,
    bright: [0.34, 0.5],
    size: [2, 2.7],
    line: 1,
    alpha: [0.66, 3.4],
  }));

export const minorEntries = (): ChartEntry[] =>
  SKY_MINOR.map((plan, i) => ({
    plan,
    id: FIGURE_ID.minor + i,
    bright: [0.22, 0.32],
    size: [1.7, 2.2],
    line: 0.62,
    alpha: [0.44, 2.6],
  }));

export const eggEntries = (): ChartEntry[] => {
  const neon = new Color(PALETTE.neon);
  return [
    {
      plan: EGG_PLAN.tour,
      id: FIGURE_ID.tour,
      bright: [0.12, 0.22],
      size: [1.6, 1.8],
      line: 0,
    },
    {
      plan: EGG_PLAN.echo,
      id: -10,
      bright: [0.44, 0.48],
      size: [2.3, 2.4],
      line: 0,
      // The level colours, pale: starlight with a tint
      colors: LEVEL_COLORS.map((c) => new Color(c).lerp(neon, 0.25)),
    },
    { plan: EGG_PLAN.queens, id: -10, bright: [0.24, 0.28], size: [1.8, 2], line: 0 },
    // The queens' board: hairlines alone, fainter than any figure's
    { plan: EGG_PLAN.queensBoard, id: -10, bright: [0, 0], size: [1, 1], line: 0.13 },
  ];
};
