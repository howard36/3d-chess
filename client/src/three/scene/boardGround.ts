// The colossal board's added detail, as GLSL for the ground's shader
// (stage.tsx): its frame, the life of its squares, and the light its
// sculptures pool on it. Everything here is drawn in the board's own
// coordinates (turned half about for Black, as the sculptures are) and in
// world units, at or under the board lines' brightness, and the ground's
// shader puts it all into the tower's shade and the far fade with the
// lines. Each part is compiled in only when it is on, so a frame pays for
// nothing it does not draw, and with everything off the shader is the
// board as it always was.

export interface BoardGroundOptions {
  /** A real board's frame: a double rule, a lozenge inlay, rosettes, electrodes. */
  frame: boolean;
  /** The squares: off, subtle (polish and inlays), rich (cracks and a mark too). */
  squares: 'off' | 'subtle' | 'rich';
  /** Light pooling on the board round each sculpture. */
  pools: boolean;
}

export const BOARD_GROUND_OFF: BoardGroundOptions = { frame: false, squares: 'off', pools: false };

type P2 = readonly [number, number];

/** Side of a square of the colossal board (world units; stage.tsx's SQUARE). */
const S = 8;
const f1 = (x: number) => (Number.isInteger(x) ? x.toFixed(1) : String(+x.toFixed(4)));

/**
 * A square by name as the shader's (column, row): columns a–h, rows from
 * rank 8 down (the board's uv runs toward +z, where White sits).
 */
const cell = (square: string): P2 => [square.charCodeAt(0) - 97, 8 - Number(square.slice(1))];

/** A set of squares as eight row bitmasks, for a lookup by bit. */
const rows = (squares: readonly string[]) => {
  const out = Array.from({ length: 8 }, () => 0);
  for (const s of squares) {
    const [c, r] = cell(s);
    out[r] |= 1 << c;
  }
  return out;
};

/**
 * GLSL: entry `i` (an int expression) of a short list of ints, as a chain
 * of choices (an array indexed at run time is copied whole for every pixel
 * by some compilers); 0 past its end.
 */
const pick = (list: readonly number[], i: string) =>
  list.reduceRight((rest, v, k) => (v === 0 ? rest : `(${i} == ${k} ? ${v} : ${rest})`), '0');

// Inlaid squares: an engraved border just inside the square's edge, on a
// scatter of the outer squares (never under a sculpture)
const INLAID = ['a1', 'c1', 'h2', 'a6', 'h7', 'c8', 'f8', 'b3', 'g5', 'f1'];
// ...and a few of those with a second border inside the first
const DOUBLE = ['c1', 'f8', 'g5'];

/** A small seeded random number generator (mulberry32). */
const random = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

interface Segment {
  a: P2;
  b: P2;
  /** Half-width of the line at each end (world units). */
  w: number;
}

/**
 * A crack across a square, in the square's own coordinates (0–8 each way):
 * a wandering line from one edge most of the way to the far one, and a
 * branch or two off it, thinning toward their ends, as stone cracks.
 */
export const crackOf = (seed: number): Segment[] => {
  const rnd = random(seed);
  const segs: Segment[] = [];
  const walk = (from: P2, heading: number, steps: number, width: number, branch: boolean) => {
    let p = from;
    let h = heading;
    for (let k = 0; k < steps; k++) {
      h += (rnd() - 0.5) * 0.9;
      const len = 0.7 + rnd() * 0.7;
      const q: P2 = [p[0] + Math.cos(h) * len, p[1] + Math.sin(h) * len];
      if (q[0] < 0.25 || q[0] > S - 0.25 || q[1] < 0.25 || q[1] > S - 0.25) break;
      const w = width * (1 - (k / steps) * 0.6);
      segs.push({ a: p, b: q, w });
      if (branch && k >= 1 && k <= steps - 3 && rnd() < 0.35) {
        walk(
          q,
          h + (rnd() < 0.5 ? -1 : 1) * (0.7 + rnd() * 0.5),
          2 + Math.floor(rnd() * 2),
          w * 0.7,
          false,
        );
      }
      p = q;
    }
  };
  const along = rnd() * (S - 3) + 1.5;
  walk([0.3, along], (rnd() - 0.5) * 0.6, 8, 0.05, true);
  return segs;
};

/** The squares that carry a crack, and each one's seed. */
const CRACKED: readonly [square: string, seed: number][] = [
  ['h6', 7],
  ['c8', 23],
  ['f1', 41],
];

/**
 * The maker's mark in the corner of a8 (the board's own coordinates): a
 * small square stamp with a knight's move inside, and a dot where it starts.
 */
const MARK: readonly Segment[] = (() => {
  const o = 0.7;
  const s = 1.1;
  const box: P2[] = [
    [o, o],
    [o + s, o],
    [o + s, o + s],
    [o, o + s],
  ];
  const sides = box.map((a, i): Segment => ({ a, b: box[(i + 1) % 4], w: 0.022 }));
  const l: P2[] = [
    [o + 0.33, o + 0.28],
    [o + 0.33, o + 0.82],
    [o + 0.66, o + 0.82],
  ];
  return [...sides, { a: l[0], b: l[1], w: 0.02 }, { a: l[1], b: l[2], w: 0.02 }];
})();
const MARK_DOT: P2 = [0.7 + 0.33, 0.7 + 0.28];

/**
 * The GLSL the ground's shader takes: declarations (after its uniforms and
 * helpers), lines (given `line`, `lines`, `edge`, `uv`, `bp`, `sq`,
 * `lightSq`, `onBoard`, `clear`; raises `line` and adds to `glow`) and,
 * after the light is summed, its share of the polish (given `view`,
 * `fresnel`, adds to `col`); and for the vertex shader, declarations and
 * lines (given `vP`, the plain's point, and the uniforms `uTurn` and
 * `uWhole`; sets `vPool`). `anchors` are the sculptures' feet (x, z) on the
 * board, for their pools.
 *
 * The ground covers most of the screen, so each part that lies in only a
 * few places (the frame's band, the inlaid, cracked and marked squares) is
 * worked out in a loop whose count is 0 wherever the part is not, which a
 * GPU skips for a block of pixels that all count 0 (a software renderer,
 * CI's, works it all out: there the ground's parts, stage.tsx, keep each
 * detail to where it lies, and the pools are worked out per vertex). Each
 * part's run of segments is written out, never an array indexed in a loop
 * (which some compilers copy whole for every pixel). Inside those loops
 * nothing takes a derivative (it would be undefined where a block's pixels
 * part ways): a line's width across a pixel is worked out from the board's
 * own footprint (`dbx`, `dby`, taken before) and the line's direction.
 */
export const boardGroundGlsl = (o: BoardGroundOptions, anchors: readonly P2[]) => {
  const on = o.frame || o.squares !== 'off' || o.pools;
  if (!on) return null;
  const decl: string[] = [
    /* glsl */ `
    // A hairline at d = 0, w wide each side, d changing by fw across a
    // pixel: coverage-correct, thinning into a dimmer line rather than
    // aliasing far off (as gridLines)
    float hairFw(float d, float w, float fw) {
      fw = max(fw, 1e-5);
      float draw = max(w, fw);
      return (1.0 - smoothstep(draw - fw, draw + fw, abs(d))) * min(w / draw, 1.0);
    }
    // A bead of light r wide, fading rather than shrinking under a pixel
    float beadFw(float d, float r, float fw) {
      fw = max(fw, 1e-5);
      float rr = max(r, fw);
      float k = r / rr;
      return (1.0 - smoothstep(rr - fw, rr + fw, d)) * k * k;
    }
    // The distance from p to a segment, and the way it grows (n)
    float segDist(vec2 p, vec4 s, out vec2 n) {
      vec2 a = s.xy;
      vec2 e = s.zw - a;
      float t = clamp(dot(p - a, e) / max(dot(e, e), 1e-6), 0.0, 1.0);
      vec2 w = p - a - e * t;
      float l = length(w);
      n = w / max(l, 1e-6);
      return l;
    }
    // Square sq in a set given as its row's bits
    bool inRow(int row, vec2 sq) {
      return sq.x >= 0.0 && sq.y >= 0.0 && sq.x <= 7.0 && sq.y <= 7.0
        && ((row >> int(clamp(sq.x, 0.0, 7.0))) & 1) == 1;
    }
    // How much a distance growing along g (board units) changes across a pixel
    #define FW(g) (abs(dot(g, dbx)) + abs(dot(g, dby)))`,
  ];
  const lines: string[] = [
    /* glsl */ `
    // The board's footprint across a pixel, taken here, where every pixel
    // of a block takes it
    vec2 dbx = dFdx(bp);
    vec2 dby = dFdy(bp);`,
  ];
  const polish: string[] = [];

  if (o.frame) {
    lines.push(/* glsl */ `
    {
      // The frame: outside the board's edge, a hairline rule, a lozenge
      // inlay every half square, and a stronger outer rule; square corner
      // blocks with their diagonals and a ring (rosettes); and where each
      // of the board's lines meets its edge, a bead of light, like the
      // electrodes of a neon sign. Only in its band round the board.
      vec2 q = abs(bp) - ${f1(4 * S)};
      float outside = max(q.x, q.y);
      bool sideX = q.x > q.y;
      vec2 sgn = sign(bp);
      vec2 gOut = sideX ? vec2(sgn.x, 0.0) : vec2(0.0, sgn.y);
      float fwMax = max(FW(vec2(1.0, 0.0)), FW(vec2(0.0, 1.0)));
      int framed = outside > -1.3 - 3.0 * fwMax && outside < 3.5 + 3.0 * fwMax ? 1 : 0;
      for (int i = 0; i < framed; i++) {
        float fwOut = FW(gOut);
        float frame = max(hairFw(outside - 0.55, 0.026, fwOut) * 0.8, hairFw(outside - 2.2, 0.032, fwOut) * 1.3);
        float corner = step(0.55, min(q.x, q.y)) * step(outside, 2.2);
        float band = step(0.55, outside) * step(outside, 2.2) * (1.0 - corner);
        // Along the side, a lozenge every half square
        float alongSide = sideX ? bp.y : bp.x;
        vec2 gAlong = sideX ? vec2(0.0, 1.0) : vec2(1.0, 0.0);
        float u = (fract(alongSide / ${f1(S / 2)} + 0.5) - 0.5) * ${f1(S / 2)};
        float oz = outside - 1.375;
        vec2 gLoz = 0.8 * sign(u) * gAlong + sign(oz) * gOut;
        frame = max(frame, hairFw(abs(u) * 0.8 + abs(oz) - 0.42, 0.022, FW(gLoz)) * 0.6 * band);
        // The corner blocks: their inner sides, diagonals and ring
        vec2 c = q - 1.375;
        float rosette = max(
          hairFw(q.x - 0.55, 0.026, FW(vec2(sgn.x, 0.0))),
          hairFw(q.y - 0.55, 0.026, FW(vec2(0.0, sgn.y)))) * 0.8;
        rosette = max(rosette, max(
          hairFw(c.x - c.y, 0.02, FW(vec2(sgn.x, -sgn.y))),
          hairFw(c.x + c.y, 0.02, FW(sgn))) * 0.55);
        float lc = length(c);
        rosette = max(rosette, hairFw(lc - 0.42, 0.022, FW(sgn * c / max(lc, 1e-6))) * 0.75);
        frame = max(frame, rosette * corner);
        line = max(line, frame);
        // The electrodes: on the edge where each line ends, and at the
        // frame's outer corners
        float tick = (fract(alongSide / ${f1(S)} + 0.5) - 0.5) * ${f1(S)};
        float onEdge = step(abs(alongSide), ${f1(4 * S + 0.3)});
        float d0 = length(vec2(outside, tick));
        float d = d0 + (1.0 - onEdge) * 1e3;
        vec2 gD = (outside * gOut + tick * gAlong) / max(d0, 1e-6);
        vec2 qc = q - 2.2;
        float dc = length(qc);
        vec2 gC = sgn * qc / max(dc, 1e-6);
        float e = max(beadFw(d, 0.13, FW(gD)), beadFw(dc, 0.11, FW(gC)) * 0.8);
        line = max(line, e * 2.2);
        glow += (exp(-d * d * 6.0) + exp(-dc * dc * 7.0) * 0.6) * 0.0035;
      }
    }`);
  }

  if (o.squares !== 'off') {
    lines.push(/* glsl */ `
    {
      // Inlaid squares: an engraved border just inside the edge, a second
      // inside it on a few (INLAID, DOUBLE)
      int row = int(clamp(sq.y, 0.0, 7.0));
      int inlaid = inRow(${pick(rows(INLAID), 'row')}, sq) ? 1 : 0;
      for (int i = 0; i < inlaid; i++) {
        vec2 f = fract(uv) * ${f1(S)};
        vec2 m = min(f, ${f1(S)} - f);
        float e = min(m.x, m.y);
        float fwE = m.x < m.y ? FW(vec2(1.0, 0.0)) : FW(vec2(0.0, 1.0));
        float inlay = hairFw(e - 0.7, 0.022, fwE) * 0.55;
        if (inRow(${pick(rows(DOUBLE), 'row')}, sq)) inlay = max(inlay, hairFw(e - 1.05, 0.02, fwE) * 0.4);
        line = max(line, inlay * onBoard);
      }
    }`);
    polish.push(/* glsl */ `
    // The dark squares more deeply polished than the light: toward the
    // horizon they give back a little more of the mist, a checker of sheen
    // only a low eye sees
    {
      float sheen = pow(1.0 - abs(view.y), 3.0) * (1.0 - lightSq) * onBoard * clear * far;
      col += uHorizon * sheen * 0.55;
    }`);
  }

  if (o.squares === 'rich') {
    const vec = (g: Segment) => `vec4(${f1(g.a[0])}, ${f1(g.a[1])}, ${f1(g.b[0])}, ${f1(g.b[1])})`;
    // Each cracked square's segments written out (an array indexed in a
    // loop is copied whole for every pixel by some compilers), in a loop
    // run once on that square and never elsewhere
    const cracks = CRACKED.map(([square, seed]) => {
      const [c, r] = cell(square);
      const segs = crackOf(seed)
        .map(
          (g) => `dd = segDist(f, ${vec(g)}, n);
          crack = max(crack, hairFw(dd, ${f1(g.w)}, FW(n)));
          near = min(near, dd);`,
        )
        .join('\n          ');
      return `for (int i = 0; i < (sq == vec2(${f1(c)}, ${f1(r)}) ? 1 : 0); i++) {
          ${segs}
        }`;
    }).join('\n        ');
    const mark = MARK.map(
      (g) => `dd = segDist(f, ${vec(g)}, n);
          m = max(m, hairFw(dd, 0.018, FW(n)));`,
    ).join('\n          ');
    lines.push(/* glsl */ `
    {
      vec2 f = fract(uv) * ${f1(S)};
      float dd;
      vec2 n;
      // Kintsugi: cracks across a few squares, mended in light
      float crack = 0.0;
      float near = 1e3;
      ${cracks}
      line = max(line, crack * 1.2 * onBoard);
      glow += exp(-near * near * 12.0) * 0.002 * onBoard * clear;
      // The maker's mark in a corner of a8
      float m = 0.0;
      for (int i = 0; i < (sq == vec2(0.0, 0.0) ? 1 : 0); i++) {
          ${mark}
          vec2 w = f - vec2(${f1(MARK_DOT[0])}, ${f1(MARK_DOT[1])});
          float l = length(w);
          m = max(m, beadFw(l, 0.06, FW(w / max(l, 1e-6))) * 1.2);
      }
      line = max(line, m * 0.8);
    }`);
  }

  // The pools are smooth (a few units across), so each vertex of the
  // plain's fine mesh works them out and a pixel only reads them
  const vertex: string[] = [];
  if (o.pools) {
    const ring = anchors.reduce((s, [x, z]) => s + Math.hypot(x, z), 0) / anchors.length;
    const each = anchors
      .map(
        ([x, z], k) => `d = bp - vec2(${f1(x)}, ${f1(z)});
      pool += exp(-dot(d, d) / 18.0) * uWhole[${k}];`,
      )
      .join('\n      ');
    vertex.push(/* glsl */ `
    {
      // Each sculpture's light pooling on the board round its foot (POOLS)
      vec2 bp = vP * uTurn;
      vec2 d;
      float pool = 0.0;
      ${each}
      vPool = pool;
    }`);
    decl.push('varying float vPool;');
    lines.push(/* glsl */ `
    {
      // Each sculpture's light pooling on the board round its foot, lifting
      // the lines near it: dimmed with the sculptures (the lobby), brighter
      // with them at mate, and gone with one the tower's shade takes whole.
      // Only in the ring the sculptures stand on (they all stand about as
      // far out): elsewhere every pool is nothing
      float pool = abs(length(bp) - ${f1(ring)}) < 13.0 ? vPool : 0.0;
      pool *= uDim * (1.0 + uBoost);
      line *= 1.0 + pool * 1.4;
      glow += pool * 0.0045;
    }`);
  }

  return {
    decl: decl.join('\n'),
    lines: lines.join('\n'),
    polish: polish.join('\n'),
    vertexDecl: o.pools ? 'varying float vPool;' : '',
    vertex: vertex.join('\n'),
  };
};
