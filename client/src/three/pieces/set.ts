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
//           knight's eyes, the bishop's cut, the lines in the unicorn's
//           twist, the queen's pearls, the king's cross, the rook's crenel
//           sills and hollow (the pawn has none). Every piece is also named
//           by its carved relief alone, so an accent painted like the body
//           loses nothing that matters.
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
  /** `bead` rings the neck at the mitre's foot; the mitre is convex, for the cut. */
  bishop: { body: Profile; collar: Profile; bead: Profile; mitre: Profile; finial: Profile };
  unicorn: { body: Profile; collar: Profile; socket: Profile };
  /**
   * `crown` is the open tulip cup, whose rim is drawn up into the coronet's
   * pointed tines as it is turned (see CORONET); `dome` is the dome, bead
   * and ball inside it.
   */
  queen: { body: Profile; collar: Profile; crown: Profile; dome: Profile };
  /**
   * `crown` is the straight-sided bucket, fluted as it is turned (see
   * KING_FLUTES); `cap` is the rolled rim, the ledge inside it, the low dome
   * and the bead the cross stands on.
   */
  king: { body: Profile; collar: Profile; crown: Profile; cap: Profile };
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
      [0.102, 0.176],
      [0.086, 0.248],
      [0.076, 0.32],
      [0.07, 0.383],
      [0.064, 0.424],
      // The neck, up into the mitre
      [0.05, 0.464],
      [0.048, 0.482],
      corner([0.048, 0.5]),
      corner([0, 0.5]),
    ],
    collar: collar(0.415, 0.14),
    bead: ring(0.462, 0.058, 0.014),
    // A tall mitre (about 1.33 times as tall as it is wide), pointed at the
    // top, and convex, for the cut
    mitre: [
      corner([0, 0.458]),
      [0.036, 0.467],
      [0.068, 0.487],
      [0.088, 0.513],
      [0.096, 0.542],
      [0.094, 0.572],
      [0.086, 0.602],
      [0.072, 0.634],
      [0.054, 0.664],
      [0.034, 0.69],
      [0.016, 0.708],
      corner([0, 0.714]),
    ],
    finial: [
      corner([0, 0.689]),
      [0.019, 0.689],
      [0.014, 0.7],
      corner([0.017, 0.704]),
      ...arc(0, 0.721, 0.024, -45, 90, 7),
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
      [0.062, 0.468],
      [0.07, 0.482],
      ...arc(0.068, 0.492, 0.011, -40, 140, 5),
      corner([0.056, 0.505]),
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
    // The neck and an open tulip cup (its rim becomes the coronet's tines)
    crown: [
      corner([0, 0.47]),
      corner([0.068, 0.47]),
      [0.066, 0.53],
      [0.07, 0.555],
      [0.084, 0.59],
      [0.104, 0.622],
      [0.128, 0.648],
      [0.148, 0.668],
      [0.16, 0.684],
      ...arc(0.155, 0.69, 0.006, -20, 160, 3),
      // The inner lip, kept at least 0.008 inside the outer wall
      [0.143, 0.68],
      [0.134, 0.666],
      corner([0.122, 0.652]),
      corner([0, 0.648]),
    ],
    // The dome inside the coronet, a bead, and the ball
    dome: [
      corner([0, 0.655]),
      corner([0.126, 0.655]),
      [0.124, 0.672],
      [0.116, 0.694],
      [0.1, 0.716],
      [0.076, 0.738],
      [0.05, 0.754],
      [0.03, 0.762],
      corner([0.02, 0.764]),
      ...arc(0.012, 0.772, 0.01, -60, 90, 3),
      corner([0.012, 0.782]),
      ...arc(0, 0.797, 0.028, -30, 90, 6),
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
    // The neck and a straight-sided bucket, fluted (its top hides in the cap)
    crown: [
      corner([0, 0.48]),
      corner([0.072, 0.48]),
      [0.07, 0.535],
      [0.074, 0.556],
      [0.084, 0.576],
      [0.1, 0.6],
      [0.116, 0.622],
      [0.13, 0.64],
      [0.139, 0.655],
      corner([0.142, 0.666]),
      corner([0, 0.666]),
    ],
    // The rolled rim, a flat ledge inside it, a low dome and the cross's bead
    cap: [
      corner([0, 0.648]),
      corner([0.126, 0.648]),
      corner([0.132, 0.654]),
      ...arc(0.141, 0.664, 0.0095, -130, 100, 5),
      corner([0.134, 0.673]),
      corner([0.118, 0.673]),
      [0.116, 0.686],
      [0.106, 0.704],
      [0.088, 0.719],
      [0.062, 0.729],
      [0.036, 0.733],
      corner([0.022, 0.734]),
      ...arc(0.012, 0.74, 0.008, -50, 90, 3),
      corner([0, 0.748]),
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
  medium: { segments: 24, tolerance: 0.002, step: 0.013, knight: 3300 },
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
    // The mane and the eyes are the accent
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
    at: [0.0, 0.595, 0] as Vec3,
    normal: [-Math.sin(a), Math.cos(a), 0] as Vec3,
    mouth: [Math.cos(a), Math.sin(a), 0] as Vec3,
    width: 0.034,
    depth: 0.045,
  };
})();

const bishop = (c: Ctx): PieceParts => {
  const p = c.profiles.bishop;
  // The mitre is cut at twice the turned resolution: its surface carries the
  // slot's edges, which want the extra rings
  const mitre = turn(c, PieceType.Bishop, p.mitre, { segments: Math.round(c.segments * 1.5) });
  const { body: cutMitre, cut } = cutSlot(mitre, MITRE_CUT);
  mitre.dispose();
  // The whole cut is the accent, floor and walls: the floor is the face an
  // elevated camera sees, so it carries the band at game size
  return {
    body: mergeShells([
      turn(c, PieceType.Bishop, p.body),
      cutMitre,
      turn(c, PieceType.Bishop, p.finial, { segments: Math.max(8, Math.round(c.segments * 0.75)) }),
    ]),
    collar: mergeShells([turn(c, PieceType.Bishop, p.collar), turn(c, PieceType.Bishop, p.bead)]),
    accent: mergeShells(cut),
    foot: mergeShells([footOf(c, PieceType.Bishop)]),
  };
};

/**
 * The unicorn's horn: a tapering cone rising from the socket to a blunted
 * tip, wound with a raised spiral (one start, HORN.turns turns): a
 * half-round bead grown out of the horn's surface, standing about a fifth
 * of the local radius proud, with a groove carved along its lower edge, so
 * each turn casts a line of shadow under it like a twisted horn. The bead is
 * the accent; the cone and its groove are body.
 */
const HORN = {
  bottom: 0.49,
  top: 0.79,
  radius: 0.058,
  taper: 1.1,
  tip: 0.005,
  /** Turns of the spiral up the horn (t 0 to 1). */
  turns: 3,
  /** How deep the groove under the bead cuts, as a fraction of the radius. */
  groove: 0.13,
  /** How far the bead stands proud, as a fraction of the horn's radius at its foot... */
  bead: 0.013,
  /** ...and at least this, near the tip. */
  beadMin: 0.004,
};

/** The horn's radius at t (0 at its foot, 1 at the tip), before the groove. */
const hornRadius = (t: number) => Math.max(HORN.radius * (1 - t) ** HORN.taper, 0);
/** Where the taper reaches the tip's radius: the blunted cap takes over there. */
const HORN_END = 1 - (HORN.tip / HORN.radius) ** (1 / HORN.taper);
const hornY = (t: number) => HORN.bottom + ((HORN.top - HORN.tip - HORN.bottom) * t) / HORN_END;
/** The spiral's angle at t. */
const spiralAngle = (t: number) => 2 * Math.PI * HORN.turns * t;
/**
 * The groove: 1 along its middle, a sixth of a turn below the bead (so just
 * under its lower edge), fading out at the foot and toward the tip.
 */
const hornGroove = (theta: number, t: number) =>
  (0.5 + 0.5 * Math.cos(theta - spiralAngle(t) + Math.PI / 3)) ** 4 *
  ramp(0, 0.06, t) *
  (1 - ramp(0.8, 0.97, t / HORN_END));

const hornCone = (c: Ctx): BufferGeometry => {
  const rows = Math.max(24, Math.round(c.segments * 1.25));
  const pts: [number, number][] = [[0, HORN.bottom]];
  const ts: number[] = [0];
  for (let j = 0; j <= rows; j++) {
    const t = (HORN_END * j) / rows;
    pts.push([hornRadius(t), hornY(t)]);
    ts.push(t);
  }
  // The blunted tip: a small round cap
  for (let k = 1; k <= 3; k++) {
    const a = (k * Math.PI) / 2 / 3;
    pts.push([HORN.tip * Math.cos(a), HORN.top - HORN.tip + HORN.tip * Math.sin(a)]);
    ts.push(HORN_END);
  }
  return revolve(pts, {
    segments: c.segments,
    modulate: (theta, row, r, y) => [r * (1 - HORN.groove * hornGroove(theta, ts[row])), y],
  });
};

/** A tube along a curve, its radius tapering to nothing at both ends. */
const sweepTube = (
  centre: (s: number) => Vec3,
  radius: (s: number) => number,
  along: number,
  around: number,
): BufferGeometry => {
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
      const rho = radius(i / along);
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

/**
 * The spiral bead: a tube whose centre runs on the horn's surface, so half
 * of it stands proud as a half-round bead, from low on the horn up to the
 * tip's cap, tapering to nothing at both ends.
 */
const hornSpiral = (c: Ctx): BufferGeometry => {
  const t0 = 0.04;
  const t1 = HORN_END;
  const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : Math.sin((x * Math.PI) / 2));
  const at = (s: number) => t0 + (t1 - t0) * s;
  return sweepTube(
    (s) => {
      const t = at(s);
      const theta = spiralAngle(t);
      const r = hornRadius(t);
      return [r * Math.cos(theta), hornY(t), r * Math.sin(theta)];
    },
    (s) => {
      const t = at(s);
      const proud = Math.max(HORN.beadMin, (HORN.bead * hornRadius(t)) / HORN.radius);
      return proud * ease(s / 0.04) * ease((1 - s) / 0.08);
    },
    Math.round(c.segments * HORN.turns * 1.25),
    5,
  );
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

/**
 * The queen's coronet: the cup's rim drawn up into eight pointed tines with
 * V-notches between them, flaring out a little as they rise, and a small
 * pearl seated on each tip.
 */
const CORONET = { tines: 8, rise: 0.05, flare: 0.24, from: 0.64, to: 0.68, pearl: 0.016 };

const queen = (c: Ctx): PieceParts => {
  const p = c.profiles.queen;
  const { tines, rise, flare, from, to, pearl } = CORONET;
  // A pointed tine: a triangle wave, sharp at the tip and at the notch
  const point = (theta: number) => {
    const f = ((((theta * tines) / (Math.PI * 2)) % 1) + 1) % 1;
    return Math.abs(2 * f - 1) ** 1.2;
  };
  const lift = (theta: number, y: number) => rise * point(theta) * ramp(from, to, y);
  const cup = turn(c, PieceType.Queen, p.crown, {
    // Six sides per tine: one at each tip and each notch
    segments: tines * 6,
    modulate: (theta, _row, r, y) => {
      const l = lift(theta, y);
      return [r + flare * l, y + l];
    },
  });
  // The tips: the rim's highest point, lifted
  const rimTop = sampleProfile(p.crown, c.d.tolerance).reduce((a, q) => (q[1] > a[1] ? q : a));
  const tipR = rimTop[0] + flare * rise;
  const tipY = rimTop[1] + rise;
  const sphereSeg = Math.max(6, Math.round(c.segments / 4));
  const pearls = Array.from({ length: tines }, (_, k) => {
    const theta = (k * Math.PI * 2) / tines;
    return new SphereGeometry(
      pearl,
      sphereSeg,
      Math.max(4, Math.round(sphereSeg * 0.75)),
    ).translate(
      (tipR - 0.002) * Math.cos(theta),
      tipY + pearl * 0.55,
      (tipR - 0.002) * Math.sin(theta),
    );
  });
  return {
    body: mergeShells([turn(c, PieceType.Queen, p.body), cup, turn(c, PieceType.Queen, p.dome)]),
    collar: mergeShells([turn(c, PieceType.Queen, p.collar)]),
    accent: mergeShells(pearls),
    foot: mergeShells([footOf(c, PieceType.Queen)]),
  };
};

/**
 * The king's cross: a cross pattée, taller than it is wide, in each of two
 * planes (thin plates, so they stay two crosses from any side rather than
 * a knot), standing on the cap's bead; a plus from above.
 */
const kingCross = (c: Ctx): BufferGeometry[] => {
  const s = new Shape();
  // The cross in x-y (x across, y up), its arms flaring toward their ends
  const w = 0.011; // half the width of the arms at the centre
  const flare = 0.025; // half the width at an arm's end
  const arm = 0.05; // reach of a side arm from the centre
  const top = 0.078; // reach of the upper arm
  const foot = 0.05; // reach of the lower arm
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
  const depth = 0.012;
  const bevel = 0.003;
  const make = () => {
    const g = new ExtrudeGeometry(s, {
      depth,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: c.segments >= 32 ? 2 : 1,
      curveSegments: 1,
    });
    g.translate(0, 0, -depth / 2);
    return g;
  };
  // Standing on the cap's bead (its top is at 0.748), a little into it
  const centre = 0.789;
  const a = make().applyMatrix4(new Matrix4().makeTranslation(0, centre, 0));
  const b = make().applyMatrix4(
    new Matrix4().makeTranslation(0, centre, 0).multiply(new Matrix4().makeRotationY(Math.PI / 2)),
  );
  return [a, b];
};

/** The flutes cut round the king's crown: how many, how deep, and the heights they span. */
const KING_FLUTES = { count: 16, depth: 0.05, from: 0.575, to: 0.653 };

const king = (c: Ctx): PieceParts => {
  const p = c.profiles.king;
  const { count, depth, from, to } = KING_FLUTES;
  const crown = turn(c, PieceType.King, p.crown, {
    // Enough sides to carry the flutes
    segments: count * Math.max(2, Math.round(c.segments / 6)),
    modulate: (theta, _row, r, y) => {
      const along = ramp(from, from + 0.015, y) * (1 - ramp(to - 0.013, to, y));
      const flute = (0.5 + 0.5 * Math.cos(count * theta)) ** 4;
      return [r * (1 - depth * flute * along), y];
    },
  });
  return {
    body: mergeShells([turn(c, PieceType.King, p.body), crown, turn(c, PieceType.King, p.cap)]),
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

/**
 * A whole set (every piece, every part), each piece built on first use.
 * Prefer `pieceSet`, which shares one per quality.
 */
export const buildPieceSet = (options: PieceSetOptions = {}): PieceSet => {
  const d = DETAIL[options.quality ?? 'medium'];
  const c: Ctx = {
    d,
    segments: options.segments ?? d.segments,
    profiles: { ...PROFILES, ...options.profiles },
    radius: options.radius,
  };
  // Each piece is built when it is first asked for, then kept: a design or
  // a test that draws only pawns never pays for the sculpted knight
  const set = {} as PieceSet;
  for (const type of Object.values(PieceType)) {
    let parts: PieceParts | undefined;
    Object.defineProperty(set, type, {
      enumerable: true,
      get: () => (parts ??= BUILDERS[type](c)),
    });
  }
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
 * Builds the shared set's pieces while the browser is idle, one piece per
 * idle moment, so the first board does not wait for them (the sculpted
 * knight takes a few hundred milliseconds). Does nothing where there is no
 * idle callback (tests, some browsers): each piece is then built when it is
 * first drawn.
 */
export const preloadPieceSet = (quality: PieceQuality = 'medium') => {
  if (typeof window === 'undefined' || typeof window.requestIdleCallback !== 'function') return;
  const set = pieceSet(quality);
  const pending = Object.values(PieceType);
  const next = () => {
    const type = pending.shift();
    if (!type) return;
    void set[type];
    window.requestIdleCallback(next, { timeout: 4000 });
  };
  window.requestIdleCallback(next, { timeout: 4000 });
};
