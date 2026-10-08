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
  /** The squares: off, subtle (polish and inlays), rich (wear, cracks, a mark). */
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
  return `int[8](${out.join(', ')})`;
};

// Inlaid squares: an engraved border just inside the square's edge, on a
// scatter of the outer squares (never under a sculpture)
const INLAID = ['a1', 'c1', 'h2', 'a6', 'h7', 'c8', 'f8', 'b3', 'g5', 'f1'];
// ...and a few of those with a second border inside the first
const DOUBLE = ['c1', 'f8', 'g5'];

/**
 * Worn stretches of the board's lines, where the light has thinned between
 * two crossings: [along x (a line of constant uv.y) or z, the line, the
 * square it runs past].
 */
const WORN: readonly [axis: 0 | 1, line: number, seg: number][] = [
  [0, 1, 5],
  [1, 7, 3],
  [0, 7, 1],
  [1, 2, 0],
  [0, 6, 6],
  [1, 6, 7],
];

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

const segmentList = (segs: readonly Segment[]) =>
  segs.map((s) => `vec4(${f1(s.a[0])}, ${f1(s.a[1])}, ${f1(s.b[0])}, ${f1(s.b[1])})`).join(', ');
const widthList = (segs: readonly Segment[]) => segs.map((s) => f1(s.w)).join(', ');

/**
 * The GLSL the ground's shader takes: declarations (after its uniforms and
 * helpers), lines (given `line`, `uv`, `bp`, `sq`, `lightSq`, `onBoard`;
 * raises `line` and adds to `glow`) and, after the light is summed, its
 * share of the polish (given `view`, `fresnel`, adds to `col`). `anchors`
 * are the sculptures' feet (x, z) on the board, for their pools.
 */
export const boardGroundGlsl = (o: BoardGroundOptions, anchors: readonly P2[]) => {
  const on = o.frame || o.squares !== 'off' || o.pools;
  if (!on) return null;
  const decl: string[] = [
    /* glsl */ `
    // A hairline at d = 0, w wide each side: coverage-correct, thinning into
    // a dimmer line rather than aliasing far off (as gridLines)
    float hair(float d, float w) {
      float fw = max(fwidth(d), 1e-5);
      float draw = max(w, fw);
      return (1.0 - smoothstep(draw - fw, draw + fw, abs(d))) * min(w / draw, 1.0);
    }
    // A bead of light r wide, fading rather than shrinking under a pixel
    float bead(float d, float r) {
      float fw = max(fwidth(d), 1e-5);
      float rr = max(r, fw);
      float k = r / rr;
      return (1.0 - smoothstep(rr - fw, rr + fw, d)) * k * k;
    }
    float segDist(vec2 p, vec4 s) {
      vec2 a = s.xy;
      vec2 e = s.zw - a;
      float t = clamp(dot(p - a, e) / max(dot(e, e), 1e-6), 0.0, 1.0);
      return length(p - a - e * t);
    }
    bool inSet(int rowsOf[8], vec2 sq) {
      if (sq.x < 0.0 || sq.y < 0.0 || sq.x > 7.0 || sq.y > 7.0) return false;
      return ((rowsOf[int(sq.y)] >> int(sq.x)) & 1) == 1;
    }`,
  ];
  const lines: string[] = [];
  const polish: string[] = [];

  if (o.squares === 'rich') {
    lines.push(/* glsl */ `
    {
      // Worn stretches of line, thinned between two crossings
      vec2 nearest = floor(uv + 0.5);
      for (int k = 0; k < ${WORN.length}; k++) {
        vec3 w = WORN[k];
        bool alongX = w.x < 0.5;
        float l = alongX ? nearest.y : nearest.x;
        float s = alongX ? sq.x : sq.y;
        float t = fract(alongX ? uv.x : uv.y);
        if (l == w.y && s == w.z) {
          float worn = 1.0 - 0.75 * smoothstep(0.12, 0.42, t) * smoothstep(0.92, 0.6, t);
          if (alongX) lines.y *= worn; else lines.x *= worn;
        }
      }
      line = max(lines.x * mix(1.0, 1.7, edge.x), lines.y * mix(1.0, 1.7, edge.y));
    }`);
  }

  if (o.frame) {
    lines.push(/* glsl */ `
    {
      // The frame: outside the board's edge, a hairline rule, a lozenge
      // inlay every half square, and a stronger outer rule; square corner
      // blocks with their diagonals and a ring (rosettes); and where each
      // of the board's lines meets its edge, a bead of light, like the
      // electrodes of a neon sign
      vec2 q = abs(bp) - ${f1(4 * S)};
      float outside = max(q.x, q.y);
      float frame = max(hair(outside - 0.55, 0.026) * 0.8, hair(outside - 2.2, 0.032) * 1.3);
      float corner = step(0.55, min(q.x, q.y)) * step(outside, 2.2);
      float band = step(0.55, outside) * step(outside, 2.2) * (1.0 - corner);
      // Along the side, a lozenge every half square
      float alongSide = q.x > q.y ? bp.y : bp.x;
      float u = (fract(alongSide / ${f1(S / 2)} + 0.5) - 0.5) * ${f1(S / 2)};
      frame = max(frame, hair(abs(u) * 0.8 + abs(outside - 1.375) - 0.42, 0.022) * 0.6 * band);
      // The corner blocks: their inner sides, diagonals and ring
      vec2 c = q - 1.375;
      float rosette = max(hair(q.x - 0.55, 0.026), hair(q.y - 0.55, 0.026)) * 0.8;
      rosette = max(rosette, max(hair(c.x - c.y, 0.02), hair(c.x + c.y, 0.02)) * 0.55);
      rosette = max(rosette, hair(length(c) - 0.42, 0.022) * 0.75);
      frame = max(frame, rosette * corner);
      line = max(line, frame);
      // The electrodes: on the edge where each line ends, and at the
      // frame's outer corners
      float tick = (fract(alongSide / ${f1(S)} + 0.5) - 0.5) * ${f1(S)};
      float onEdge = step(abs(alongSide), ${f1(4 * S + 0.3)});
      float d = length(vec2(outside, tick)) + (1.0 - onEdge) * 1e3;
      float dc = length(q - 2.2);
      float e = max(bead(d, 0.13), bead(dc, 0.11) * 0.8);
      line = max(line, e * 2.2);
      glow += (exp(-d * d * 6.0) + exp(-dc * dc * 7.0) * 0.6) * 0.0035;
    }`);
  }

  if (o.squares !== 'off') {
    decl.push(/* glsl */ `
    const int INLAID[8] = ${rows(INLAID)};
    const int DOUBLE[8] = ${rows(DOUBLE)};`);
    lines.push(/* glsl */ `
    {
      // Inlaid squares: an engraved border just inside the edge, a second
      // inside it on a few
      vec2 f = fract(uv) * ${f1(S)};
      float e = min(min(f.x, ${f1(S)} - f.x), min(f.y, ${f1(S)} - f.y));
      float inlay = inSet(INLAID, sq) ? hair(e - 0.7, 0.022) * 0.55 : 0.0;
      if (inSet(DOUBLE, sq)) inlay = max(inlay, hair(e - 1.05, 0.02) * 0.4);
      line = max(line, inlay * onBoard);
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
    const cracks = CRACKED.map(([square, seed]) => ({ at: cell(square), segs: crackOf(seed) }));
    const all = cracks.flatMap((c) => c.segs);
    let start = 0;
    const tests = cracks
      .map((c) => {
        const from = start;
        start += c.segs.length;
        return `if (sq == vec2(${f1(c.at[0])}, ${f1(c.at[1])})) {
          for (int k = ${from}; k < ${start}; k++) {
            float dd = segDist(f, CRACKS[k]);
            crack = max(crack, hair(dd, CRACK_W[k]));
            near = min(near, dd);
          }
        }`;
      })
      .join('\n        ');
    decl.push(/* glsl */ `
    const vec4 CRACKS[${all.length}] = vec4[${all.length}](${segmentList(all)});
    const float CRACK_W[${all.length}] = float[${all.length}](${widthList(all)});
    const vec4 MARK[${MARK.length}] = vec4[${MARK.length}](${segmentList(MARK)});
    const vec3 WORN[${WORN.length}] = vec3[${WORN.length}](${WORN.map(
      ([a, l, s]) => `vec3(${f1(a)}, ${f1(l)}, ${f1(s)})`,
    ).join(', ')});`);
    lines.push(/* glsl */ `
    {
      vec2 f = fract(uv) * ${f1(S)};
      // Kintsugi: cracks across a few squares, mended in light
      float crack = 0.0;
      float near = 1e3;
      ${tests}
      line = max(line, crack * 1.2 * onBoard);
      glow += exp(-near * near * 12.0) * 0.002 * onBoard * clear;
      // The maker's mark in a corner of a8
      if (sq == vec2(0.0, 0.0)) {
        float m = 0.0;
        for (int k = 0; k < ${MARK.length}; k++) m = max(m, hair(segDist(f, MARK[k]), 0.018));
        m = max(m, bead(length(f - vec2(${f1(MARK_DOT[0])}, ${f1(MARK_DOT[1])})), 0.06) * 1.2);
        line = max(line, m * 0.8);
      }
    }`);
  }

  if (o.pools) {
    const ring = anchors.reduce((s, [x, z]) => s + Math.hypot(x, z), 0) / anchors.length;
    decl.push(/* glsl */ `
    const vec2 POOLS[${anchors.length}] = vec2[${anchors.length}](${anchors
      .map(([x, z]) => `vec2(${f1(x)}, ${f1(z)})`)
      .join(', ')});`);
    lines.push(/* glsl */ `
    {
      // Each sculpture's light pooling on the board round its foot, lifting
      // the lines near it: dimmed with the sculptures (the lobby), brighter
      // with them at mate, and gone with one the tower's shade takes whole
      float pool = 0.0;
      // Only in the ring the sculptures stand on (they all stand about as
      // far out): elsewhere every pool is nothing
      if (abs(length(bp) - ${f1(ring)}) < 13.0) {
        for (int k = 0; k < ${anchors.length}; k++) {
          vec2 d = bp - POOLS[k];
          pool += exp(-dot(d, d) / 18.0) * uWhole[k];
        }
      }
      pool *= uDim * (1.0 + uBoost);
      line *= 1.0 + pool * 1.4;
      glow += pool * 0.0045;
    }`);
  }

  return { decl: decl.join('\n'), lines: lines.join('\n'), polish: polish.join('\n') };
};
