// The colossal board's added detail, as GLSL for the ground's shader
// (stage.tsx): its frame and the life of its squares. Everything here is
// drawn in the board's own coordinates (turned half about for Black, as the
// sculptures are) and in world units, at or under the board lines'
// brightness, and the ground's shader puts it all into the tower's shade and
// the far fade with the lines.

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

/** The helpers the lines use. */
const DECL = /* glsl */ `
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
    // Square sq in a set given as its row's bits
    bool inRow(int row, vec2 sq) {
      return sq.x >= 0.0 && sq.y >= 0.0 && sq.x <= 7.0 && sq.y <= 7.0
        && ((row >> int(clamp(sq.x, 0.0, 7.0))) & 1) == 1;
    }
    // How much a distance growing along g (board units) changes across a pixel
    #define FW(g) (abs(dot(g, dbx)) + abs(dot(g, dby)))`;

/**
 * The dark squares more deeply polished than the light: toward the horizon
 * they give back a little more of the mist, a checker of sheen only a low
 * eye sees.
 */
const POLISH = /* glsl */ `
    {
      float sheen = pow(1.0 - abs(view.y), 3.0) * (1.0 - lightSq) * onBoard * clear * far;
      col += uHorizon * sheen * 0.55;
    }`;

/**
 * The GLSL the ground's shader takes: declarations (after its uniforms and
 * helpers), lines (given `line`, `uv`, `bp`, `sq`, `onBoard`; raises `line`
 * and adds to `glow`) and, after the light is summed, its share of the
 * polish (given `view`, `lightSq`, `onBoard`, `clear`, `far`, adds to
 * `col`). `frame` adds the board's frame, for a part of the plain its band
 * lies in.
 *
 * The ground covers most of the screen, so each part that lies in only a
 * few places (the frame's band, the inlaid squares) is worked out in a loop
 * whose count is 0 wherever the part is not, which a GPU skips for a block
 * of pixels that all count 0 (a software renderer, CI's, works it all out:
 * there the ground's parts, stage.tsx, keep each detail to where it lies).
 * Inside those loops nothing takes a derivative (it would be undefined where
 * a block's pixels part ways): a line's width across a pixel is worked out
 * from the board's own footprint (`dbx`, `dby`, taken before) and the line's
 * direction.
 */
export const boardGroundGlsl = (frame: boolean) => {
  const lines: string[] = [
    /* glsl */ `
    // The board's footprint across a pixel, taken here, where every pixel
    // of a block takes it
    vec2 dbx = dFdx(bp);
    vec2 dby = dFdy(bp);`,
  ];

  if (frame) {
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

  return { decl: DECL, lines: lines.join('\n'), polish: POLISH };
};
