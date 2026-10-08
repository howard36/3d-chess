import { BufferAttribute, BufferGeometry, Color, Vector3 } from 'three';
import { rng } from './textures';
import { LEVEL_COLORS, PALETTE } from './palette';
import type { Constellation, P2, Placement } from './skyPlace';
import { placeStar } from './skyPlace';

// The constellations drawn as a star chart draws them (the richer sky,
// envPreview `constellations: crafted`): each line runs whole from
// star to star (a hairline under each star's glow, so the joints stay clean),
// each figure has one brighter star, and its lines fade a little toward its
// base. Anyone looking closely also finds two asterisms with no figure
// drawn in lines (`skyEggs`):
// - the tower's echo: five stars climbing one above another, tinted in the
//   five level colours, A's at the foot to E's at the top, between the
//   unicorn and the pawn;
// - the eight queens: eight stars set as a solution of the puzzle in the
//   faintest lattice of an 8x8 board, low between the bishop and the rook.
// The low ones also stand above the horizon from the camera's 6° view.

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

/** The queens' board: the faintest lattice of points on its empty squares. */
const QUEENS_BOARD: Constellation = {
  stars: Array.from({ length: 64 }, (_, i): P2 => [(i % 8) / 7, Math.floor(i / 8) / 7]).filter(
    ([u, v]) => EIGHT_QUEENS[Math.round(u * 7)] !== Math.round(v * 7),
  ),
  lines: [],
};

export const EGG_PLAN = {
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

/** How the eight and the asterisms are drawn. */
export const majorEntries = (plans: Placement[]): ChartEntry[] =>
  plans.map((plan, i) => ({
    plan,
    id: i,
    bright: [0.34, 0.5],
    size: [2, 2.7],
    line: 1,
    alpha: [0.66, 3.4],
  }));

export const eggEntries = (): ChartEntry[] => {
  const neon = new Color(PALETTE.neon);
  return [
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
    { plan: EGG_PLAN.queensBoard, id: -10, bright: [0.05, 0.06], size: [1.1, 1.1], line: 0 },
  ];
};
