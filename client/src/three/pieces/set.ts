import { BufferGeometry, ExtrudeGeometry, Matrix4, Shape, SphereGeometry } from 'three';
import { PieceType } from '../../engine/pieces';
import { cutSlot } from './cut';
import { buildKnight } from './knight';
import { flatPolygon, gridSurface, mergeShells } from './mesh';
import type { Vec3 } from './mesh';
import { arc, corner, revolve, sampleProfile } from './profile';
import type { Profile, ProfileNode, RevolveOptions } from './profile';

// The shared Staunton set (round 3). Every piece is modelled base-at-y=0,
// facing +x (the knight's muzzle, the bishop's cut), inside the envelope the
// layouts assume: the king stands 0.87 tall and no base is wider than 0.27
// in radius. Each piece is a few closed shells, merged into one geometry per
// part so a design can paint the parts differently:
//
//   foot    a thin band at the very bottom (y 0 to FOOT_HEIGHT): paint it in
//           the colour of the piece's level, or like the body
//   body    everything else that is turned or carved
//   collar  the ring (or rings) where the stem meets the head
//   accent  the details that identify a piece up close and from above: the
//           knight's mane and eyes, the bishop's cut, the unicorn's spiral,
//           the queen's pearls, the king's cross (pawn and rook have none)
//
// The turned shells come from PROFILES (exported, so a design can derive
// its own cut); the knight's head is sculpted (knight.ts).

export type PiecePart = 'body' | 'collar' | 'accent' | 'foot';
export type PieceParts = Record<'body' | 'collar' | 'foot', BufferGeometry> & {
  accent?: BufferGeometry;
};
export type PieceSet = Record<PieceType, PieceParts>;

/** Height of the foot band. */
export const FOOT_HEIGHT = 0.04;

const smoothstep = (t: number) => t * t * (3 - 2 * t);
const ramp = (a: number, b: number, x: number) =>
  smoothstep(Math.min(Math.max((x - a) / (b - a), 0), 1));

// --- Profiles ------------------------------------------------------------------

/**
 * The turned base every piece stands on, from just inside the foot band up
 * to where the stem begins (radius `stem` at height `top`): a torus roll, a
 * fillet, then a cove sweeping in to a small bead (or, without it, straight
 * into the stem).
 */
const base = (R: number, top: number, stem: number, bead = true): ProfileNode[] => {
  const F = FOOT_HEIGHT;
  const roll = 0.024;
  const rollY = F + roll * 0.92;
  const coveFrom = R - roll * 1.5;
  const beadY = top - 0.012;
  return [
    corner([0, F - 0.006]),
    corner([R - 0.014, F - 0.006]),
    // The roll
    ...arc(R - roll, rollY, roll - 0.003, -62, 96, 6),
    // A narrow fillet above the roll, then the cove
    corner([coveFrom, rollY + roll * 0.98]),
    [coveFrom - 0.012, rollY + roll * 1.12],
    [stem + (coveFrom - stem) * 0.45, beadY - 0.018],
    ...(bead
      ? [
          [stem + 0.018, beadY - 0.006] as const,
          // A small bead where the cove meets the stem
          ...arc(stem + 0.01, beadY + 0.002, 0.009, -80, 120, 4),
        ]
      : [[stem + 0.008, beadY] as const, [stem, top] as const]),
  ];
};

/**
 * A collar: a disc with a half-round edge and a smaller bead above it,
 * centred at height `y` with radius `r`.
 */
const collar = (y: number, r: number, h = 0.046): Profile => {
  const disc = h * 0.55;
  const y0 = y - h / 2;
  const bead = h - disc;
  return [
    corner([0, y0]),
    [r - disc / 2, y0],
    ...arc(r - disc / 2, y0 + disc / 2, disc / 2, -90, 90, 4),
    [r - disc / 2 - 0.006, y0 + disc],
    corner([r - disc / 2 - 0.014, y0 + disc + 0.002]),
    ...arc(r - disc / 2 - 0.018, y0 + disc + bead / 2, bead / 2, -90, 90, 3),
    corner([0, y0 + h]),
  ];
};

/** A single ring with a half-round edge (the knight's collar). */
const ring = (y: number, r: number, h: number): Profile => [
  corner([0, y - h / 2]),
  [r - h / 2, y - h / 2],
  ...arc(r - h / 2, y, h / 2, -90, 90, 4),
  corner([0, y + h / 2]),
];

/**
 * A grand collar, for the king and queen: a bead, a broad disc with a
 * half-round edge, and another bead, centred at `y` with radius `r`.
 */
const grandCollar = (y: number, r: number, h: number): Profile => {
  const bead = h * 0.26;
  const disc = h - 2 * bead;
  const y0 = y - h / 2;
  const rb = r - disc / 2 - 0.02;
  return [
    corner([0, y0]),
    [rb, y0],
    ...arc(rb, y0 + bead / 2, bead / 2, -90, 90, 3),
    corner([rb, y0 + bead]),
    [r - disc / 2, y0 + bead],
    ...arc(r - disc / 2, y0 + bead + disc / 2, disc / 2, -90, 90, 4),
    corner([r - disc / 2, y0 + bead + disc]),
    [rb, y0 + bead + disc],
    ...arc(rb, y0 + h - bead / 2, bead / 2, -90, 90, 3),
    corner([0, y0 + h]),
  ];
};

/** The foot band: a short cylinder with softened edges, closed underneath. */
const foot = (R: number): Profile => [
  corner([0, 0]),
  [R - 0.006, 0],
  ...arc(R - 0.006, 0.006, 0.006, -90, 0, 2),
  [R, FOOT_HEIGHT - 0.004],
  // The top edge ends in a corner, so the top runs straight in to the axis
  ...arc(R - 0.004, FOOT_HEIGHT - 0.004, 0.004, 0, 90, 2).slice(0, -1),
  corner([R - 0.004, FOOT_HEIGHT]),
  corner([0, FOOT_HEIGHT]),
];

export interface PieceProfiles {
  /** Base radius per piece (the foot band's radius). */
  radius: Record<PieceType, number>;
  pawn: { body: Profile; collar: Profile };
  /** `body` ends at the turret's rim; `well` (the accent) is the crenels' sills and the hollow. */
  rook: { body: Profile; well: Profile; collar: Profile; merlon: Profile };
  knight: { body: Profile; collar: Profile };
  bishop: { body: Profile; collar: Profile; mitre: Profile; finial: Profile };
  unicorn: { body: Profile; collar: Profile; socket: Profile };
  /** `coronet` is one of the crown's tines, turned upright from y = 0. */
  queen: { body: Profile; collar: Profile; crown: Profile; coronet: Profile };
  /** The crown's flare is ribbed as it is turned (see KING_RIBS). */
  king: { body: Profile; collar: Profile; crown: Profile };
}

const R = {
  [PieceType.Pawn]: 0.205,
  [PieceType.Rook]: 0.235,
  [PieceType.Knight]: 0.235,
  [PieceType.Bishop]: 0.232,
  [PieceType.Unicorn]: 0.24,
  [PieceType.Queen]: 0.252,
  [PieceType.King]: 0.265,
};

/** Every turned profile of the set, radius and height in piece units. */
export const PROFILES: PieceProfiles = {
  radius: R,
  pawn: {
    body: [
      ...base(R.Pawn, 0.13, 0.092),
      [0.085, 0.16],
      [0.07, 0.21],
      [0.061, 0.26],
      [0.058, 0.3],
      // Through the collar into the head
      [0.055, 0.33],
      ...arc(0, 0.415, 0.104, -58, 90, 10),
    ],
    collar: collar(0.3, 0.13, 0.042),
  },
  rook: {
    body: [
      ...base(R.Rook, 0.14, 0.158),
      [0.152, 0.17],
      [0.142, 0.23],
      [0.136, 0.29],
      [0.138, 0.34],
      [0.146, 0.375],
      [0.15, 0.4],
      // The corbel, flaring out under the turret
      [0.153, 0.418],
      [0.166, 0.438],
      [0.184, 0.453],
      corner([0.195, 0.462]),
      // The turret's drum, with a course of masonry cut round it
      corner([0.195, 0.488]),
      corner([0.187, 0.4945]),
      corner([0.195, 0.501]),
      corner([0.195, 0.532]),
    ],
    // The sills of the crenels (sloping outward) and the hollow they surround
    // (the floor dished, so from above it shades apart from the merlons' tops)
    well: [
      corner([0.195, 0.532]),
      corner([0.146, 0.543]),
      corner([0.146, 0.5]),
      [0.1, 0.49],
      [0, 0.484],
    ],
    collar: collar(0.398, 0.166, 0.032),
    // A merlon's cross-section (r, y), counter-clockwise, before it is swept
    // (a hair inside the turret's walls, so no two faces coincide)
    merlon: [
      corner([0.1485, 0.525]),
      corner([0.1948, 0.525]),
      [0.1948, 0.588],
      ...arc(0.1828, 0.588, 0.012, 0, 90, 3),
      [0.1605, 0.6],
      ...arc(0.1605, 0.588, 0.012, 90, 180, 3),
      corner([0.1485, 0.525]),
    ],
  },
  knight: {
    body: [...base(R.Knight, 0.14, 0.158, false), corner([0.158, 0.155]), corner([0, 0.155])],
    collar: ring(0.155, 0.18, 0.03),
  },
  bishop: {
    body: [
      ...base(R.Bishop, 0.14, 0.116),
      [0.102, 0.18],
      [0.086, 0.26],
      [0.076, 0.34],
      [0.07, 0.41],
      [0.064, 0.455],
      // The neck, up into the mitre
      [0.05, 0.5],
      [0.048, 0.52],
      corner([0.048, 0.54]),
      corner([0, 0.54]),
    ],
    collar: collar(0.445, 0.14),
    // A tall egg, pointed at the top (convex, for the cut)
    mitre: [
      corner([0, 0.488]),
      [0.04, 0.498],
      [0.078, 0.52],
      [0.103, 0.548],
      [0.113, 0.58],
      [0.11, 0.612],
      [0.096, 0.645],
      [0.072, 0.678],
      [0.042, 0.705],
      [0.016, 0.722],
      corner([0, 0.727]),
    ],
    finial: [
      corner([0, 0.71]),
      [0.02, 0.71],
      [0.015, 0.722],
      corner([0.018, 0.726]),
      ...arc(0, 0.745, 0.026, -45, 90, 7),
    ],
  },
  unicorn: {
    body: [
      ...base(R.Unicorn, 0.14, 0.12),
      [0.106, 0.18],
      [0.09, 0.26],
      [0.08, 0.34],
      [0.074, 0.4],
      // The neck, up into the socket
      [0.064, 0.445],
      [0.058, 0.47],
      corner([0.056, 0.5]),
      corner([0, 0.5]),
    ],
    collar: collar(0.425, 0.14),
    // The rolled ring the horn rises from
    socket: [
      corner([0, 0.455]),
      [0.056, 0.458],
      [0.068, 0.468],
      [0.08, 0.482],
      ...arc(0.078, 0.492, 0.011, -40, 140, 5),
      corner([0.058, 0.505]),
      corner([0, 0.505]),
    ],
  },
  queen: {
    body: [
      ...base(R.Queen, 0.145, 0.126),
      [0.112, 0.19],
      [0.096, 0.28],
      [0.086, 0.37],
      [0.08, 0.44],
      [0.077, 0.48],
      corner([0.075, 0.52]),
      corner([0, 0.52]),
    ],
    collar: grandCollar(0.49, 0.158, 0.062),
    // Neck, the flared cup with a rolled rim, and the dome and ball inside
    crown: [
      corner([0, 0.47]),
      corner([0.068, 0.47]),
      [0.066, 0.53],
      [0.07, 0.555],
      [0.088, 0.6],
      [0.115, 0.638],
      [0.14, 0.664],
      [0.154, 0.68],
      ...arc(0.151, 0.688, 0.009, -40, 150, 4),
      corner([0.134, 0.692]),
      [0.12, 0.706],
      [0.094, 0.728],
      [0.06, 0.744],
      [0.03, 0.751],
      [0.018, 0.757],
      ...arc(0, 0.787, 0.032, -40, 90, 7),
    ],
    // One tine of the coronet, upright; a pearl crowns each
    coronet: [
      corner([0, 0]),
      [0.018, 0],
      [0.017, 0.018],
      [0.012, 0.035],
      [0.006, 0.048],
      corner([0, 0.05]),
    ],
  },
  king: {
    body: [
      ...base(R.King, 0.15, 0.132),
      [0.118, 0.2],
      [0.1, 0.3],
      [0.09, 0.4],
      [0.085, 0.46],
      [0.082, 0.49],
      corner([0.08, 0.53]),
      corner([0, 0.53]),
    ],
    collar: grandCollar(0.497, 0.17, 0.064),
    // Neck, the ribbed flare with its rim, the domed cap and the boss the cross stands on
    crown: [
      corner([0, 0.48]),
      corner([0.072, 0.48]),
      [0.07, 0.535],
      [0.074, 0.555],
      [0.088, 0.582],
      [0.11, 0.612],
      [0.135, 0.642],
      [0.154, 0.664],
      ...arc(0.151, 0.672, 0.01, -40, 120, 4),
      corner([0.139, 0.68]),
      [0.137, 0.694],
      [0.125, 0.716],
      [0.1, 0.737],
      [0.066, 0.751],
      [0.036, 0.757],
      corner([0.03, 0.759]),
      ...arc(0.022, 0.766, 0.012, -30, 90, 3),
      corner([0, 0.778]),
    ],
  },
};

// --- Options ---------------------------------------------------------------------

export type PieceQuality = 'low' | 'medium' | 'high';

interface Detail {
  /** Sides of the turned shells. */
  segments: number;
  /** How far a thinned profile may stray from its curve. */
  tolerance: number;
  /** Grid step of the sculpted knight, before it is decimated... */
  step: number;
  /** ...to this many triangles (head, mane and eyes). */
  knight: number;
}

const DETAIL: Record<PieceQuality, Detail> = {
  low: { segments: 14, tolerance: 0.003, step: 0.018, knight: 1400 },
  medium: { segments: 24, tolerance: 0.002, step: 0.013, knight: 2900 },
  high: { segments: 48, tolerance: 0.0004, step: 0.0065, knight: 14000 },
};

export interface PieceSetOptions {
  /** Mesh density: 'medium' (the default) is sized for 40 pieces on screen. */
  quality?: PieceQuality;
  /** Override the sides of every turned shell (a handful gives a faceted, cut-gem look). */
  segments?: number;
  /** Replace any of the turned profiles (see PROFILES). */
  profiles?: Partial<PieceProfiles>;
  /**
   * Reshape every turned shell: gets a point's radius and height (and the
   * piece), returns the radius to use. E.g. slimmer stems:
   * `(r, y) => r * (1 - 0.25 * bump(y, 0.15, 0.45))`.
   */
  radius?: (r: number, y: number, type: PieceType) => number;
}

// --- Builders --------------------------------------------------------------------

interface Ctx {
  d: Detail;
  segments: number;
  profiles: PieceProfiles;
  radius?: PieceSetOptions['radius'];
}

const turn = (
  c: Ctx,
  type: PieceType,
  profile: Profile,
  opts: Partial<RevolveOptions> = {},
): BufferGeometry => {
  const pts = sampleProfile(profile, c.d.tolerance).map(([r, y]): [number, number] => [
    c.radius ? c.radius(r, y, type) : r,
    y,
  ]);
  return revolve(pts, { ...opts, segments: opts.segments ?? c.segments });
};

const footOf = (c: Ctx, type: PieceType) =>
  turn(c, type, foot(c.profiles.radius[type]), { segments: Math.max(c.segments, 16) });

/**
 * A closed ring swept from a closed (r, y) cross-section through `sweep`
 * radians starting at `from`, with flat end caps: a rook's merlon.
 */
const sector = (
  c: Ctx,
  section: Profile,
  from: number,
  sweep: number,
  segments: number,
): BufferGeometry[] => {
  const pts = sampleProfile(section, c.d.tolerance);
  // Drop the repeated closing point; the surface wraps round instead
  const loop = pts.slice(0, -1);
  const at = (theta: number, [r, y]: [number, number]): Vec3 => [
    r * Math.cos(theta),
    y,
    r * Math.sin(theta),
  ];
  const wall = gridSurface({
    cols: segments,
    rows: loop.length + 1,
    wrapV: true,
    point: (i, j) => at(from + (sweep * i) / segments, loop[j % loop.length]),
  });
  const tangent = (theta: number): Vec3 => [-Math.sin(theta), 0, Math.cos(theta)];
  // The cross-section's loop is counter-clockwise in (r, y), which faces +θ
  const uniq = loop.filter(
    (p, k) => k === 0 || Math.hypot(p[0] - loop[k - 1][0], p[1] - loop[k - 1][1]) > 1e-9,
  );
  const end = uniq.map((p) => at(from + sweep, p));
  const start = uniq.map((p) => at(from, p)).reverse();
  const t0 = tangent(from);
  return [
    wall,
    flatPolygon(end, tangent(from + sweep)),
    flatPolygon(start, [-t0[0], -t0[1], -t0[2]]),
  ];
};

const pawn = (c: Ctx): PieceParts => ({
  body: mergeShells([turn(c, PieceType.Pawn, c.profiles.pawn.body)]),
  collar: mergeShells([turn(c, PieceType.Pawn, c.profiles.pawn.collar)]),
  foot: mergeShells([footOf(c, PieceType.Pawn)]),
});

/** Merlons of the rook's turret, and how much of the circle they fill. */
const MERLONS = 6;
const MERLON_FILL = 0.52;

const rook = (c: Ctx): PieceParts => {
  const span = ((Math.PI * 2) / MERLONS) * MERLON_FILL;
  const merlons = Array.from({ length: MERLONS }, (_, k) =>
    sector(
      c,
      c.profiles.rook.merlon,
      (k * Math.PI * 2) / MERLONS - span / 2 + Math.PI / MERLONS,
      span,
      Math.max(3, Math.round(c.segments / 5)),
    ),
  ).flat();
  return {
    body: mergeShells([turn(c, PieceType.Rook, c.profiles.rook.body), ...merlons]),
    collar: mergeShells([turn(c, PieceType.Rook, c.profiles.rook.collar)]),
    // The crenels' floors and the hollow inside the turret: painted dark,
    // they show the crenellation from above
    accent: mergeShells([turn(c, PieceType.Rook, c.profiles.rook.well)]),
    foot: mergeShells([footOf(c, PieceType.Rook)]),
  };
};

const knight = (c: Ctx): PieceParts => {
  const k = buildKnight(c.d.step, c.d.knight);
  return {
    body: mergeShells([turn(c, PieceType.Knight, c.profiles.knight.body), k.head]),
    collar: mergeShells([turn(c, PieceType.Knight, c.profiles.knight.collar)]),
    accent: mergeShells([k.mane, k.eyes]),
    foot: mergeShells([footOf(c, PieceType.Knight)]),
  };
};

/** The bishop's cut: a slot rising toward the front (+x) at 40°, two thirds through the mitre. */
const MITRE_CUT = (() => {
  const a = (40 * Math.PI) / 180;
  return {
    at: [0.0, 0.615, 0] as Vec3,
    normal: [-Math.sin(a), Math.cos(a), 0] as Vec3,
    mouth: [Math.cos(a), Math.sin(a), 0] as Vec3,
    width: 0.03,
    depth: 0.052,
  };
})();

const bishop = (c: Ctx): PieceParts => {
  const p = c.profiles.bishop;
  // The mitre is cut at twice the turned resolution: its surface carries the
  // slot's edges, which want the extra rings
  const mitre = turn(c, PieceType.Bishop, p.mitre, { segments: Math.round(c.segments * 1.5) });
  const { body: cutMitre, cut } = cutSlot(mitre, MITRE_CUT);
  mitre.dispose();
  return {
    body: mergeShells([
      turn(c, PieceType.Bishop, p.body),
      cutMitre,
      turn(c, PieceType.Bishop, p.finial, { segments: Math.max(8, Math.round(c.segments * 0.75)) }),
    ]),
    collar: mergeShells([turn(c, PieceType.Bishop, p.collar)]),
    accent: mergeShells(cut),
    foot: mergeShells([footOf(c, PieceType.Bishop)]),
  };
};

/** The unicorn's horn: a tall cone rising from the socket, its tip at HORN.top. */
const HORN = { bottom: 0.49, top: 0.815, radius: 0.064, turns: 3.25, ridge: 0.0115 };

const hornRadius = (t: number) => HORN.radius * (1 - t) ** 0.95;

const hornCone = (c: Ctx): BufferGeometry => {
  const rows = Math.max(8, Math.round(c.segments * 0.6));
  const pts: [number, number][] = [[0, HORN.bottom]];
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    pts.push([hornRadius(t), HORN.bottom + (HORN.top - HORN.bottom) * t]);
  }
  return revolve(pts, { segments: c.segments });
};

/** The raised spiral round the horn: a tube that tapers to nothing at both ends. */
const hornSpiral = (c: Ctx): BufferGeometry => {
  const along = Math.round(c.segments * HORN.turns);
  const around = Math.max(5, Math.round(c.segments / 4));
  const H = HORN.top - HORN.bottom;
  const t0 = 0.04;
  const t1 = 0.96;
  const centre = (s: number): Vec3 => {
    const t = t0 + (t1 - t0) * s;
    const phi = HORN.turns * Math.PI * 2 * s;
    const r = hornRadius(t) + ridge(s) * 0.35;
    return [r * Math.cos(phi), HORN.bottom + H * t, r * Math.sin(phi)];
  };
  const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : Math.sin((x * Math.PI) / 2));
  const ridge = (s: number) => HORN.ridge * (1 - 0.55 * s) * ease(s / 0.05) * ease((1 - s) / 0.08);
  const frame = (s: number) => {
    const e = 1e-4;
    const a = centre(Math.max(0, s - e));
    const b = centre(Math.min(1, s + e));
    const T: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const lt = Math.hypot(...T);
    T.forEach((v, i) => (T[i] = v / lt));
    const p = centre(s);
    const out: Vec3 = [p[0], 0, p[2]];
    const dotTN = out[0] * T[0] + out[2] * T[2];
    const N: Vec3 = [out[0] - dotTN * T[0], -dotTN * T[1], out[2] - dotTN * T[2]];
    const ln = Math.hypot(...N);
    N.forEach((v, i) => (N[i] = v / ln));
    const B: Vec3 = [
      T[1] * N[2] - T[2] * N[1],
      T[2] * N[0] - T[0] * N[2],
      T[0] * N[1] - T[1] * N[0],
    ];
    return { p, N, B };
  };
  const frames = Array.from({ length: along + 1 }, (_, i) => frame(i / along));
  return gridSurface({
    cols: along,
    rows: around + 1,
    wrapV: true,
    point: (i, j) => {
      const { p, N, B } = frames[i];
      const rho = ridge(i / along);
      const a = (j / around) * Math.PI * 2;
      const cn = Math.cos(a) * rho;
      const sn = Math.sin(a) * rho;
      return [
        p[0] + N[0] * cn + B[0] * sn,
        p[1] + N[1] * cn + B[1] * sn,
        p[2] + N[2] * cn + B[2] * sn,
      ];
    },
  });
};

const unicorn = (c: Ctx): PieceParts => {
  const p = c.profiles.unicorn;
  return {
    body: mergeShells([
      turn(c, PieceType.Unicorn, p.body),
      turn(c, PieceType.Unicorn, p.socket),
      hornCone(c),
    ]),
    collar: mergeShells([turn(c, PieceType.Unicorn, p.collar)]),
    accent: mergeShells([hornSpiral(c)]),
    foot: mergeShells([footOf(c, PieceType.Unicorn)]),
  };
};

/** The queen's coronet: eight tines round the rim, leaning out, a pearl on each. */
const TINES = 8;
const TINE = { radius: 0.147, y: 0.684, lean: (7 * Math.PI) / 180, pearl: 0.0195 };

const queen = (c: Ctx): PieceParts => {
  const p = c.profiles.queen;
  const tineSegments = Math.max(6, Math.round(c.segments / 3));
  const tineLength = Math.max(...p.coronet.map((n) => n[1]));
  const sphereSeg = Math.max(6, Math.round(c.segments / 3));
  const tines: BufferGeometry[] = [];
  const pearls: BufferGeometry[] = [];
  for (let k = 0; k < TINES; k++) {
    const theta = (k * Math.PI * 2) / TINES;
    // An upright tine, leaned out, then set in its place round the rim
    const place = new Matrix4()
      .makeRotationY(-theta)
      .multiply(new Matrix4().makeTranslation(TINE.radius, TINE.y, 0))
      .multiply(new Matrix4().makeRotationZ(-TINE.lean));
    tines.push(turn(c, PieceType.Queen, p.coronet, { segments: tineSegments }).applyMatrix4(place));
    pearls.push(
      new SphereGeometry(TINE.pearl, sphereSeg, Math.max(4, Math.round(sphereSeg * 0.75)))
        .translate(0, tineLength + TINE.pearl * 0.45, 0)
        .applyMatrix4(place),
    );
  }
  return {
    body: mergeShells([
      turn(c, PieceType.Queen, p.body),
      turn(c, PieceType.Queen, p.crown),
      ...tines,
    ]),
    collar: mergeShells([turn(c, PieceType.Queen, p.collar)]),
    accent: mergeShells(pearls),
    foot: mergeShells([footOf(c, PieceType.Queen)]),
  };
};

/** The king's cross: a cross pattée in each of two planes, so it reads as a cross from every side and as a plus from above. */
const kingCross = (c: Ctx): BufferGeometry[] => {
  const s = new Shape();
  // Half the cross in x-y (x across, y up), arms flaring toward their ends
  // Slender arms, barely flared, so the notches between them stay open
  // (and the cross reads as one) from every side, the diagonals included
  const w = 0.0145; // half the width of the arms at the centre
  const flare = 0.02; // half the width at an arm's end
  const arm = 0.068; // reach of a side arm from the centre
  const top = 0.054; // reach of the upper arm
  const foot = 0.044; // reach of the lower arm
  const pts: [number, number][] = [
    [-w, -w],
    [-flare * 0.8, -foot],
    [flare * 0.8, -foot],
    [w, -w],
    [arm, -flare],
    [arm, flare],
    [w, w],
    [flare, top],
    [-flare, top],
    [-w, w],
    [-arm, flare],
    [-arm, -flare],
  ];
  s.moveTo(...pts[0]);
  pts.slice(1).forEach((p) => s.lineTo(...p));
  s.closePath();
  const depth = 0.026;
  const bevel = 0.005;
  const make = () => {
    const g = new ExtrudeGeometry(s, {
      depth,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: c.segments >= 32 ? 3 : 2,
      curveSegments: 1,
    });
    g.translate(0, 0, -depth / 2);
    return g;
  };
  // Seated on the boss (its top is at 0.778), a little buried
  const centre = 0.767 + foot;
  const a = make().applyMatrix4(new Matrix4().makeTranslation(0, centre, 0));
  const b = make().applyMatrix4(
    new Matrix4().makeTranslation(0, centre, 0).multiply(new Matrix4().makeRotationY(Math.PI / 2)),
  );
  return [a, b];
};

/** The ribs round the king's crown: how many, how proud, and the heights they span. */
const KING_RIBS = { count: 12, depth: 0.09, from: 0.565, to: 0.668 };

const king = (c: Ctx): PieceParts => {
  const p = c.profiles.king;
  const { count, depth, from, to } = KING_RIBS;
  const crown = turn(c, PieceType.King, p.crown, {
    // Enough sides to carry the ribs
    segments: count * Math.max(3, Math.round(c.segments / 6)),
    modulate: (theta, _row, r, y) => {
      const along = ramp(from, from + 0.03, y) * (1 - ramp(to - 0.012, to, y));
      const rib = (0.5 + 0.5 * Math.cos(count * theta)) ** 2;
      return [r * (1 + depth * rib * along), y];
    },
  });
  return {
    body: mergeShells([turn(c, PieceType.King, p.body), crown]),
    collar: mergeShells([turn(c, PieceType.King, p.collar)]),
    accent: mergeShells(kingCross(c)),
    foot: mergeShells([footOf(c, PieceType.King)]),
  };
};

const BUILDERS: Record<PieceType, (c: Ctx) => PieceParts> = {
  [PieceType.Pawn]: pawn,
  [PieceType.Rook]: rook,
  [PieceType.Knight]: knight,
  [PieceType.Bishop]: bishop,
  [PieceType.Unicorn]: unicorn,
  [PieceType.Queen]: queen,
  [PieceType.King]: king,
};

/** Builds a whole set (every piece, every part). Prefer `pieceSet`, which shares one per quality. */
export const buildPieceSet = (options: PieceSetOptions = {}): PieceSet => {
  const d = DETAIL[options.quality ?? 'medium'];
  const c: Ctx = {
    d,
    segments: options.segments ?? d.segments,
    profiles: { ...PROFILES, ...options.profiles },
    radius: options.radius,
  };
  const set = {} as PieceSet;
  for (const type of Object.values(PieceType)) set[type] = BUILDERS[type](c);
  return set;
};

const shared = new Map<PieceQuality, PieceSet>();

/**
 * The shared set at a quality, built on first use and reused by every
 * design and piece: never dispose or edit these geometries (clone first).
 */
export const pieceSet = (quality: PieceQuality = 'medium'): PieceSet => {
  let set = shared.get(quality);
  if (!set) {
    set = buildPieceSet({ quality });
    shared.set(quality, set);
  }
  return set;
};

/**
 * Builds the shared set when the browser is next idle, so the first board
 * does not wait for it (building the medium set takes a few hundred ms).
 * Does nothing where there is no idle callback (tests, old browsers): the set
 * is then built on first use.
 */
export const preloadPieceSet = (quality: PieceQuality = 'medium') => {
  if (typeof window === 'undefined' || typeof window.requestIdleCallback !== 'function') return;
  window.requestIdleCallback(() => pieceSet(quality), { timeout: 4000 });
};
