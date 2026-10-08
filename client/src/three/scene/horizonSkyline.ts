import { PieceType } from '../../engine/pieces';
import { sculptureOf } from './sculptures';

// The far hills (horizon.tsx): two ranges of low hills round the whole
// horizon, each rolling as a sum of whole waves round the circle (so it
// closes up behind), and here and there a crag that is a chess piece's
// silhouette standing out of the rock on a broad hill of its own: a rook's
// battlemented mesa, a knight's head with its ear and muzzle, a bishop's
// mitre with its cut showing sky through it, a king's cross and a queen's
// crown and pearl. The silhouettes are the garden's own (sculptures.ts), so
// a crag is the same piece as the neon giants. A range is a set of columns
// round the circle, each the heights at which it is rock (the ridge from the
// ground up, and a crag's parts above it, an arm of a cross or the slit of a
// mitre leaving sky between). Pure numbers, for tests.

type P2 = [number, number];
/** Heights (world units above the ground) between which a column is rock: [from, to] pairs. */
export type Column = number[];

const DEG = Math.PI / 180;

/** A piece's silhouette standing out of the hills. */
export interface Summit {
  type: PieceType;
  /** Azimuth of its axis (degrees, atan2(x, z) in the garden's frame, before the seat's turn). */
  azimuth: number;
  /** Piece units to world units. */
  scale: number;
  /** Its highest point above the ground (world units): its foot is sunk, only its top shows. */
  top: number;
  /** How high its own hill rises, as a share of its height (SHOULDER if not given). */
  hill?: number;
}

export interface Range {
  /** Distance from the tower's axis (world units). */
  radius: number;
  /** The ridge's mean height above the ground, and how far it rolls (world units). */
  base: number;
  roll: number;
  /** Seed of its waves. */
  seed: number;
  summits: readonly Summit[];
}

/** One range as columns round the circle: each column's azimuth (radians) and its rock. */
export interface Skyline {
  azimuth: number[];
  columns: Column[];
}

/** The ridge's step round the circle, and across a crag (degrees). */
const STEP = 0.4;
const FINE = 0.035;
/** Half the width of a tube drawn as a stroke (the cross's arms), and of the mitre's cut (piece units). */
const STROKE = 0.016;
const CUT = 0.007;
/** How high a crag's own hill rises, as a share of the crag, and how wide, as its width. */
const SHOULDER = 0.5;
const SHOULDER_WIDTH = 2.4;

/**
 * Where white's opening view looks (the camera stands at about 16° and looks
 * across the tower's axis): azimuth 196° in the garden's frame. Black's sees
 * the garden turned half about, so it looks at 16°.
 */
export const WHITE_LOOK = 196;
export const BLACK_LOOK = 16;

/**
 * The two ranges. The nearer is low and dark, the farther taller and paler
 * with distance. Each seat finds a piece or two on its own side of the
 * world, out toward the edges of the opening view (its frame spans about 27°
 * either side of its line on a desktop): the neon sculptures flanking the
 * tower sweep the bands beside it as the camera sinks and climbs, and a
 * secret piece never stands in line with one (horizonPlacement.test.ts).
 * The two knights stand at the sides of the world, each the other turned
 * half about.
 */
export const RANGES: readonly Range[] = [
  {
    radius: 365,
    base: 11,
    roll: 6,
    seed: 3,
    summits: [
      // Behind black's side of the world, at the left edge of white's view: the royal pair
      { type: PieceType.King, azimuth: WHITE_LOOK + 28, scale: 58, top: 27, hill: 0.62 },
      { type: PieceType.Queen, azimuth: WHITE_LOOK + 33, scale: 58, top: 25.5, hill: 0.62 },
    ],
  },
  {
    radius: 300,
    base: 4.5,
    roll: 3.2,
    seed: 11,
    summits: [
      // At the right edge of white's view: a rook's mesa
      { type: PieceType.Rook, azimuth: WHITE_LOOK - 26, scale: 46, top: 12.5, hill: 0.4 },
      // At the edges of black's view: the bishop at the left, a pawn's knoll at the right
      { type: PieceType.Bishop, azimuth: BLACK_LOOK + 28, scale: 52, top: 19 },
      { type: PieceType.Pawn, azimuth: BLACK_LOOK - 25, scale: 46, top: 13 },
      // The knights, at the sides of the world, each the other turned half
      // about (as the board is for Black)
      { type: PieceType.Knight, azimuth: BLACK_LOOK + 90, scale: 50, top: 25, hill: 0.3 },
      { type: PieceType.Knight, azimuth: BLACK_LOOK - 90, scale: 50, top: 25, hill: 0.3 },
    ],
  },
];

/** A rectangle round a stroke from a to b, `w` either side. */
const strokeOf = ([ax, ay]: P2, [bx, by]: P2, w: number): P2[] => {
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const nx = (-(by - ay) / len) * w;
  const ny = ((bx - ax) / len) * w;
  return [
    [ax + nx, ay + ny],
    [bx + nx, by + ny],
    [bx - nx, by - ny],
    [ax - nx, ay - ny],
  ];
};

interface Silhouette {
  /** Closed polygons that are rock. */
  solid: P2[][];
  /** Closed polygons cut out of it (sky through the rock). */
  cut: P2[][];
}

/**
 * A piece's silhouette as closed polygons (piece units, base at y = 0):
 * its outline closed along the base, and its strokes made solid: the
 * queen's sides and coronet joined, her pearl on a stem; the king's cross;
 * the bishop's cut taken out of the mitre.
 */
export const silhouetteOf = (type: PieceType): Silhouette => {
  const { outlines } = sculptureOf(type);
  if (type === PieceType.Queen) {
    const [left, coronet, right, pearl] = outlines;
    return {
      solid: [
        [...left.points.slice().reverse(), ...coronet.points, ...right.points.slice().reverse()],
        pearl.points,
        strokeOf([0, 0.72], [0, 0.78], STROKE * 0.8),
      ],
      cut: [],
    };
  }
  const [body, ...strokes] = outlines;
  if (type === PieceType.Bishop)
    return {
      solid: [body.points],
      cut: strokes.map(({ points: [a, b] }) => {
        // Run on past the outline's edge, so the slit opens to the sky
        const ext: P2 = [b[0] + (b[0] - a[0]) * 0.8, b[1] + (b[1] - a[1]) * 0.8];
        return strokeOf(a, ext, CUT);
      }),
    };
  return {
    solid: [body.points, ...strokes.map(({ points: [a, b] }) => strokeOf(a, b, STROKE))],
    cut: [],
  };
};

/** Where a vertical line at x crosses a closed polygon: the heights inside it, in pairs. */
const crossings = (poly: P2[], x: number): number[] => {
  const ys: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    // Half-open, so a vertex is counted once
    if (ax <= x !== bx <= x) ys.push(ay + ((by - ay) * (x - ax)) / (bx - ax));
  }
  return ys.sort((a, b) => a - b);
};

/** The union of interval lists ([from, to] pairs). */
const union = (cols: Column[]): Column => {
  const spans: P2[] = [];
  for (const c of cols) for (let i = 0; i + 1 < c.length; i += 2) spans.push([c[i], c[i + 1]]);
  spans.sort((a, b) => a[0] - b[0]);
  const out: Column = [];
  for (const [a, b] of spans) {
    if (b <= a) continue;
    if (out.length && a <= out[out.length - 1])
      out[out.length - 1] = Math.max(out[out.length - 1], b);
    else out.push(a, b);
  }
  return out;
};

/** Intervals minus intervals. */
const subtract = (from: Column, cut: Column): Column => {
  let out = from;
  for (let i = 0; i + 1 < cut.length; i += 2) {
    const [c0, c1] = [cut[i], cut[i + 1]];
    const next: Column = [];
    for (let j = 0; j + 1 < out.length; j += 2) {
      const [a, b] = [out[j], out[j + 1]];
      if (c1 <= a || c0 >= b) next.push(a, b);
      else {
        if (c0 > a) next.push(a, c0);
        if (c1 < b) next.push(c1, b);
      }
    }
    out = next;
  }
  return out;
};

/** The heights at which a silhouette is solid at x (piece units). */
export const silhouetteColumn = (s: Silhouette, x: number): Column =>
  subtract(union(s.solid.map((p) => crossings(p, x))), union(s.cut.map((p) => crossings(p, x))));

/** Columns across a silhouette, sampled once per piece. */
const TABLE = 320;

interface Shape {
  /** Its silhouette's columns at TABLE + 1 even steps from -half to half (piece units). */
  table: Column[];
  half: number;
  peak: number;
}

/**
 * silhouetteColumn at every step of the table, edge by edge: each edge
 * drops its crossings into the few columns it spans (rather than every
 * column testing every edge), then each column pairs them up.
 */
const tableOf = (s: Silhouette, half: number): Column[] => {
  const x = (i: number) => -half + (2 * half * i) / TABLE;
  const crossingsOf = (poly: P2[]) => {
    const per: (number[] | undefined)[] = new Array(TABLE + 1);
    for (let k = 0; k < poly.length; k++) {
      const [ax, ay] = poly[k];
      const [bx, by] = poly[k + 1 === poly.length ? 0 : k + 1];
      const lo = Math.max(0, Math.ceil(((Math.min(ax, bx) + half) / (2 * half)) * TABLE) - 1);
      const hi = Math.min(TABLE, Math.floor(((Math.max(ax, bx) + half) / (2 * half)) * TABLE) + 1);
      for (let i = lo; i <= hi; i++) {
        const xi = x(i);
        // Half-open, as in crossings()
        if (ax <= xi !== bx <= xi) (per[i] ??= []).push(ay + ((by - ay) * (xi - ax)) / (bx - ax));
      }
    }
    for (const c of per) c?.sort((a, b) => a - b);
    return per;
  };
  const solid = s.solid.map(crossingsOf);
  const cut = s.cut.map(crossingsOf);
  return Array.from({ length: TABLE + 1 }, (_, i) =>
    subtract(union(solid.map((p) => p[i] ?? [])), union(cut.map((p) => p[i] ?? []))),
  );
};

const shapes = new Map<PieceType, Shape>();
const shapeOf = (type: PieceType): Shape => {
  let s = shapes.get(type);
  if (!s) {
    const shape = silhouetteOf(type);
    const pts = shape.solid.flat();
    const half = Math.max(...pts.map(([x]) => Math.abs(x)));
    s = {
      table: tableOf(shape, half),
      half,
      peak: Math.max(...pts.map(([, y]) => y)),
    };
    shapes.set(type, s);
  }
  return s;
};

/**
 * Rock from the ground up to `base`, and the runs of `above` (sorted, apart)
 * over it: those reaching down into it join it, those below ground go.
 */
const onBase = (base: number, above: Column): Column => {
  const out: Column = [0, base];
  for (let i = 0; i + 1 < above.length; i += 2) {
    const [a, b] = [above[i], above[i + 1]];
    if (b <= out[out.length - 1]) continue;
    if (a <= out[out.length - 1]) out[out.length - 1] = b;
    else out.push(a, b);
  }
  return out;
};

/** Signed angle from a to b (radians), in (-π, π]. */
const turn = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** A crag's rock at an azimuth (radians): its own hill, and the piece above it. */
const summitColumn = (s: Summit, radius: number, az: number): Column => {
  const { table, half, peak } = shapeOf(s.type);
  const across = (turn(s.azimuth * DEG, az) * radius) / s.scale;
  const hill = s.top * (s.hill ?? SHOULDER) * Math.exp(-((across / (half * SHOULDER_WIDTH)) ** 2));
  const at = Math.round(((across + half) / (2 * half)) * TABLE);
  if (at < 0 || at > TABLE) return [0, hill];
  const lift = s.top - peak * s.scale;
  // Worn: every edge a little rough, as weathered rock is, and no two crags alike
  const seed = s.azimuth * 0.37;
  const wear =
    0.0022 * Math.sin(across * 523 + seed) +
    0.0014 * Math.sin(across * 1229 + seed * 3.1) +
    0.0009 * Math.sin(across * 2731 + seed * 7.3) +
    0.003 * Math.sin(across * 97 + seed * 1.7);
  return onBase(
    hill,
    table[at].map((y) => (y + wear) * s.scale + lift),
  );
};

/** A tiny repeatable random sequence. */
const random = (seed: number) => {
  let s = seed * 2654435761;
  return () => {
    s = (s ^ (s >>> 15)) * 2246822519;
    s = (s ^ (s >>> 13)) * 3266489917;
    s ^= s >>> 16;
    return ((s >>> 0) % 1e6) / 1e6;
  };
};

/** The ridge's rolling height at an azimuth (radians): whole waves round the circle. */
const ridge = (range: Range) => {
  const r = random(range.seed);
  const waves = Array.from({ length: 24 }, (_, i) => {
    const k = 3 + Math.round(i * 2.3 + r() * 2);
    return { k, amp: (1 / Math.pow(k, 0.85)) * (0.6 + 0.8 * r()), phase: r() * Math.PI * 2 };
  });
  const norm = waves.reduce((s, w) => s + w.amp, 0) * 0.45;
  return (az: number) => {
    let h = 0;
    for (const { k, amp, phase } of waves) h += amp * Math.sin(k * az + phase);
    // Rounded tops and sharper saddles, as worn hills have
    const u = h / norm;
    return Math.max(range.base + range.roll * (u - 0.25 * u * u), 0.4);
  };
};

/**
 * One range's columns round the circle: finely across a crag's piece,
 * coarsely along the ridge and over the crags' hills.
 */
export const skylineOf = (range: Range): Skyline => {
  let done = skylines.get(range);
  if (!done) skylines.set(range, (done = buildSkyline(range)));
  return done;
};

/** Each range's skyline, built once for the page (the lobby's canvas and the game's share it). */
const skylines = new WeakMap<Range, Skyline>();

const buildSkyline = (range: Range): Skyline => {
  const crags = range.summits.map((s) => {
    const { half } = shapeOf(s.type);
    return {
      s,
      at: s.azimuth * DEG,
      piece: (half * s.scale * 1.05) / range.radius,
      hill: (half * s.scale * SHOULDER_WIDTH * 2.2) / range.radius,
    };
  });
  const height = ridge(range);
  const azimuth: number[] = [];
  const columns: Column[] = [];
  let a = 0;
  while (a < Math.PI * 2 - 1e-9) {
    const ground = height(a);
    const cols: Column[] = [];
    let fine = false;
    for (const c of crags) {
      const d = Math.abs(turn(c.at, a));
      if (d <= c.hill) cols.push(summitColumn(c.s, range.radius, a));
      if (d <= c.piece) fine = true;
    }
    azimuth.push(a);
    columns.push(
      cols.length === 0
        ? [0, ground]
        : cols.length === 1
          ? onBase(Math.max(ground, cols[0][1]), cols[0])
          : union([[0, ground], ...cols]),
    );
    // Never stepping over a crag's edge
    let step = (fine ? FINE : STEP) * DEG;
    if (!fine)
      for (const c of crags) {
        const ahead = turn(a, c.at) - c.piece;
        if (ahead > 0 && ahead < step) step = ahead + 1e-7;
      }
    a += step;
  }
  // Closed: the first column again at a full turn
  azimuth.push(Math.PI * 2);
  columns.push(columns[0]);
  return { azimuth, columns };
};

/** The highest rock in a column. */
export const columnTop = (c: Column) => (c.length ? c[c.length - 1] : 0);
