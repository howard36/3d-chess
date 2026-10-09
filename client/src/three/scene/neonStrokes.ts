import { BufferAttribute, BufferGeometry } from 'three';

// The neon tubes of the garden's sculptures and everything drawn with their
// light (stage.tsx's neonMaterial): every stroke is cut into its segments,
// and each segment is drawn as a capsule on screen, the set of pixels within
// the tube's radius of the segment, measured per pixel. A stroke is so one
// even tube, however sharply it bends: two segments meeting overlap in a
// round joint, and as tubes join by taking the brighter (never summed) the
// overlap is no brighter than either, with no spur, fin or gap at any corner,
// from any side; an open stroke ends in a round cap. A quad of four corners
// per segment, each corner carrying the whole segment (its ends and the
// points either side); the vertex shader places them as the stroke's kind
// asks and spans the quad round the segment on screen (STROKE_VERTEX), the
// fragment shader draws the tube's profile across it. (Not instanced: the
// software renderer CI draws with pays for every instance as for a draw.)
//
// A stroke is one of three kinds (`mode`):
//   0  a drawing turned about the vertical to face the camera (x across, y
//      up): a turned piece's outline, the same from every side;
//   1  fixed in 3D about its anchor (rings, footprints, and the details that
//      are not the same from every side: the bishop's cut, the unicorn's
//      spiral, the knights' eyes), so it never turns with the view;
//   2  a drawing turned about its own `axis` to face the camera (x across, y
//      along the axis): a fallen piece's outline.
// Each segment also carries the figure it belongs to (`sculpt`, whose light
// the tower's shade can take as a whole: gardenWhole) and its own share of
// the tube's light. A fixed stroke may carry a normal per point: the way the
// surface it lies on faces there. It is lit only where that faces the camera
// (its body, solid, hides the far side), fading out just as it meets the
// outline. Pure geometry here, testable without WebGL.

export type V3 = readonly [number, number, number];

/** A horizontal ring of `n` points (mode 1), radius `r` at height `y`. */
export const ringPoints = (r: number, y: number, n: number): V3[] =>
  Array.from({ length: n }, (_, k): V3 => {
    const a = (k / n) * Math.PI * 2;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  });

export interface NeonStroke {
  /** Where it hangs: a sculpture's foot on the ground. */
  at: V3;
  /** Its points about `at` (see the modes above). */
  points: readonly V3[];
  closed: boolean;
  mode?: 0 | 1 | 2;
  /** The axis a lying drawing turns about (mode 2), or the body's axis a normal is round (1). */
  axis?: V3;
  /** The surface's outward normal at each point (mode 1): lit only where it faces the camera. */
  normals?: readonly V3[];
  /** Which figure's slot of gardenWhole it takes. */
  sculpt?: number;
  /** The tube's light, 0-1: one value, or one per point. */
  light?: number | readonly number[];
}

/** Floats per corner in each attribute (every corner of a segment carries the same). */
const LAYOUT = {
  aA: 3,
  aB: 3,
  aP: 3,
  aN: 3,
  aNA: 3,
  aNB: 3,
  aAnchor: 3,
  aAxis: 3,
  aInfo: 4,
} as const;
type AttrName = keyof typeof LAYOUT;

/** How many segments the strokes make. */
export const segmentCount = (strokes: readonly NeonStroke[]) =>
  strokes.reduce(
    (n, s) => n + (s.points.length < 2 ? 0 : s.closed ? s.points.length : s.points.length - 1),
    0,
  );

const ZERO: V3 = [0, 0, 0];
const UP: V3 = [0, 1, 0];

/**
 * Writes the strokes' segments into per-instance arrays from segment
 * `first` on; returns the segment after the last written.
 */
export const writeStrokes = (
  arrays: Record<AttrName, Float32Array>,
  strokes: readonly NeonStroke[],
  first = 0,
) => {
  let i = first;
  // Element by element: TypedArray.set from a plain array costs a call
  // apiece, and this runs for every segment of the garden as it is built
  const put = (name: AttrName, v: readonly number[]) => {
    const size = LAYOUT[name];
    const a = arrays[name];
    const n = v.length;
    for (let c = 0; c < 4; c++) {
      const at = (i * 4 + c) * size;
      for (let e = 0; e < n; e++) a[at + e] = v[e];
    }
  };
  const info = [0, 0, 0, 0];
  for (const s of strokes) {
    const pts = s.points;
    const n = pts.length;
    if (n < 2) continue;
    const segments = s.closed ? n : n - 1;
    const axis = s.axis ?? UP;
    const lit = (k: number) => (typeof s.light === 'number' ? s.light : (s.light?.[k] ?? 1));
    for (let k = 0; k < segments; k++) {
      const j = (k + 1) % n;
      put('aA', pts[k]);
      put('aB', pts[j]);
      // The points before and after it (an open end its own: a cap)
      put('aP', s.closed ? pts[(k + n - 1) % n] : pts[Math.max(k - 1, 0)]);
      put('aN', s.closed ? pts[(j + 1) % n] : pts[Math.min(j + 1, n - 1)]);
      put('aNA', s.normals?.[k] ?? ZERO);
      put('aNB', s.normals?.[j] ?? ZERO);
      put('aAnchor', s.at);
      put('aAxis', axis);
      info[0] = s.mode ?? 0;
      info[1] = s.sculpt ?? 0;
      info[2] = lit(k);
      info[3] = lit(j);
      put('aInfo', info);
      i++;
    }
  }
  return i;
};

/**
 * The strokes as one geometry, one draw call. `capacity` keeps room for
 * that many segments (a stroke set rewritten as the camera moves, with
 * updateStrokes); the geometry draws only the segments written.
 */
export const neonStrokes = (
  strokes: readonly NeonStroke[],
  capacity = segmentCount(strokes),
): BufferGeometry => {
  const g = new BufferGeometry();
  const size = Math.max(capacity, 1);
  // Each segment's quad: (along 0|1, side -1|1) at its four corners
  const corners = new Float32Array(size * 12);
  const index = new Uint32Array(size * 6);
  const corner = [0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0];
  const quad = [0, 2, 1, 1, 2, 3];
  for (let i = 0; i < size; i++) {
    for (let c = 0; c < 12; c++) corners[i * 12 + c] = corner[c];
    for (let c = 0; c < 6; c++) index[i * 6 + c] = i * 4 + quad[c];
  }
  g.setAttribute('position', new BufferAttribute(corners, 3));
  g.setIndex(new BufferAttribute(index, 1));
  for (const name of Object.keys(LAYOUT) as AttrName[]) {
    g.setAttribute(
      name,
      new BufferAttribute(new Float32Array(size * 4 * LAYOUT[name]), LAYOUT[name]),
    );
  }
  updateStrokes(g, strokes);
  return g;
};

/** How many segments a stroke geometry draws. */
export const strokeSegments = (g: BufferGeometry) => g.drawRange.count / 6;

/** Rewrites a stroke geometry's segments (up to its capacity). */
export const updateStrokes = (g: BufferGeometry, strokes: readonly NeonStroke[]) => {
  const arrays = {} as Record<AttrName, Float32Array>;
  const attrs = {} as Record<AttrName, BufferAttribute>;
  for (const name of Object.keys(LAYOUT) as AttrName[]) {
    attrs[name] = g.getAttribute(name) as BufferAttribute;
    arrays[name] = attrs[name].array as Float32Array;
  }
  const capacity = attrs.aA.count / 4;
  const wanted = segmentCount(strokes);
  if (wanted > capacity) throw new Error(`neonStrokes: ${wanted} segments, room for ${capacity}`);
  const count = writeStrokes(arrays, strokes);
  for (const a of Object.values(attrs)) {
    a.clearUpdateRanges();
    a.addUpdateRange(0, count * 4 * a.itemSize);
    a.needsUpdate = true;
  }
  g.setDrawRange(0, count * 6);
  return count;
};

/** How far past the tube's radius the quad reaches, as a share of it (the halo is gone by then). */
export const STROKE_REACH = 0.62;

/**
 * How far a segment's quad runs on past an end (pixels), for the turn the
 * stroke takes there on screen (`before` the segment's end, `after` the
 * next point along it; equal to the end at an open end): at an open end
 * the whole reach, for its round cap; at a bend only as far as its half of
 * the round joint needs (the reach times the sine of half the turn), so a
 * smooth curve's many short segments do not each draw a cap over the next.
 */
export const strokeRunOn = (
  before: readonly [number, number],
  end: readonly [number, number],
  dir: readonly [number, number],
  reach: number,
) => {
  const dx = end[0] - before[0];
  const dy = end[1] - before[1];
  const l = Math.hypot(dx, dy);
  if (l < 1e-3) return reach;
  const cos = Math.max(-1, Math.min(1, (dx * dir[0] + dy * dir[1]) / l));
  return Math.min(reach, reach * Math.sqrt((1 - cos) / 2) + 1.5);
};

/**
 * The corners of a segment's quad on screen (pixels), from its ends, the
 * points before and after them, and the tube's radius at each end (the CPU
 * twin of STROKE_VERTEX's span, for tests).
 */
export const strokeQuad = (
  p: readonly [number, number],
  a: readonly [number, number],
  b: readonly [number, number],
  n: readonly [number, number],
  radius: readonly [number, number],
): [number, number][] => {
  const reach = Math.max(radius[0], radius[1]) * STROKE_REACH + 2;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const [ux, uy] = len > 1e-4 ? [dx / len, dy / len] : [1, 0];
  const [nx, ny] = [-uy, ux];
  const runA = strokeRunOn(p, a, [ux, uy], reach);
  const runB = strokeRunOn(n, b, [-ux, -uy], reach);
  return [0, 1].flatMap((along) =>
    [-1, 1].map((side): [number, number] => {
      const [px, py] = along ? b : a;
      const s = along ? runB : -runA;
      return [px + ux * s + nx * side * reach, py + uy * s + ny * side * reach];
    }),
  );
};

/**
 * The vertex shader: places a segment's two ends (as its mode asks), and
 * spans its quad round them on screen, wide enough for the tube (the radius
 * `uWidth` in world units, at least a few pixels). The fragment gets both
 * ends on screen and the pixel it draws, and measures the distance itself,
 * so the tube's width is exact along the segment and round at its ends.
 */
export const STROKE_VERTEX = (slots: number) => /* glsl */ `
  uniform float uWidth;
  uniform float uMirror;
  uniform float uGround;
  uniform float uTurn;
  uniform float uWhole[${slots}];
  uniform vec3 uShadeViewport;
  attribute vec3 aA;
  attribute vec3 aB;
  attribute vec3 aP;
  attribute vec3 aN;
  attribute vec3 aNA;
  attribute vec3 aNB;
  attribute vec3 aAnchor;
  attribute vec3 aAxis;
  attribute vec4 aInfo;
  varying vec3 vPix;
  varying vec4 vEnds;
  varying vec2 vRadius;
  varying vec4 vLit;
  varying vec2 vFacing;

  vec3 turned(vec3 v) { return vec3(v.x * uTurn, v.y, v.z * uTurn); }

  // How a fixed point's surface faces the camera (1 for one with no normal):
  // its normal against the view, seen across the body's axis
  float facingOf(vec3 p, vec3 n, vec3 axis) {
    vec3 v = normalize(cameraPosition - p);
    float along = dot(axis, v);
    float f = dot(turned(n), v) / sqrt(max(1.0 - along * along, 1e-4));
    return dot(n, n) > 0.0 ? f : 1.0;
  }

  // On screen (pixels), or far off when behind the camera
  vec2 onScreen(vec4 c, vec2 vp) {
    return c.w > 1e-3 ? (c.xy / c.w * 0.5 + 0.5) * vp : vec2(-1e6);
  }

  // How far the quad runs on past an end (neonStrokes.ts's strokeRunOn)
  float runOn(vec2 before, vec2 end, vec2 dir, float reach) {
    vec2 d = end - before;
    float l = length(d);
    if (l < 1e-3) return reach;
    float c = clamp(dot(d / l, dir), -1.0, 1.0);
    return min(reach, reach * sqrt((1.0 - c) * 0.5) + 1.5);
  }

  void main() {
    vec3 anchor = turned(aAnchor);
    vec3 axis = turned(aAxis);
    float mode = aInfo.x;
    // The stroke's frame, one for its every point (no branch: the software
    // renderer would run every side of one, for each point): a drawing faces
    // the camera, turned about the vertical (0) or its axis (2); a fixed
    // stroke keeps the world's axes, turned for Black (1)
    vec3 toCam = cameraPosition - anchor;
    vec2 h = normalize(toCam.xz + vec2(1e-5, 0.0));
    vec3 across = cross(axis, toCam);
    float al = length(across);
    across = al > 1e-5 ? across / al : vec3(0.0, 1.0, 0.0);
    float standing = 1.0 - step(0.5, mode);
    float held = step(0.5, mode) * (1.0 - step(1.5, mode));
    float lying = step(1.5, mode);
    vec3 fx = standing * vec3(h.y, 0.0, -h.x) + held * vec3(uTurn, 0.0, 0.0) + lying * across;
    vec3 fy = (standing + held) * vec3(0.0, 1.0, 0.0) + lying * axis;
    vec3 fz = held * vec3(0.0, 0.0, uTurn);
    vec3 pA = anchor + fx * aA.x + fy * aA.y + fz * aA.z;
    vec3 pB = anchor + fx * aB.x + fy * aB.y + fz * aB.z;
    vec3 pP = anchor + fx * aP.x + fy * aP.y + fz * aP.z;
    vec3 pN = anchor + fx * aN.x + fy * aN.y + fz * aN.z;
    float fA = facingOf(pA, aNA, axis);
    float fB = facingOf(pB, aNB, axis);
    float whole = uWhole[int(aInfo.y + 0.5)];
    vLit = vec4(aInfo.z * whole, aInfo.w * whole, pA.y - uGround, pB.y - uGround);
    vFacing = vec2(fA, fB);
    if (uMirror > 0.5) {
      pA.y = 2.0 * uGround - pA.y;
      pB.y = 2.0 * uGround - pB.y;
      pP.y = 2.0 * uGround - pP.y;
      pN.y = 2.0 * uGround - pN.y;
    }
    mat4 pv = projectionMatrix * viewMatrix;
    vec4 cA = pv * vec4(pA, 1.0);
    vec4 cB = pv * vec4(pB, 1.0);
    if (cA.w < 1e-3 || cB.w < 1e-3) {
      // An end behind the camera: not drawn
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vec2 vp = uShadeViewport.xy;
    vec2 sA = onScreen(cA, vp);
    vec2 sB = onScreen(cB, vp);
    vec2 sP = onScreen(pv * vec4(pP, 1.0), vp);
    vec2 sN = onScreen(pv * vec4(pN, 1.0), vp);
    // The tube's radius on screen at each end (pixels)
    float k = projectionMatrix[1][1] * vp.y * 0.5 * uWidth;
    vec2 radius = vec2(k / cA.w, k / cB.w);
    float reach = max(radius.x, radius.y) * ${STROKE_REACH.toFixed(2)} + 2.0;
    vec2 d = sB - sA;
    float len = length(d);
    vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    bool atB = position.x > 0.5;
    vec4 c = atB ? cB : cA;
    // Past each end only as far as its cap, or its half of the joint, needs
    float run = atB ? runOn(sN, sB, -dir, reach) : -runOn(sP, sA, dir, reach);
    vec2 pix = (atB ? sB : sA) + dir * run + nrm * position.y * reach;
    gl_Position = vec4((pix / vp * 2.0 - 1.0) * c.w, c.z, c.w);
    // Times w, so that dividing by the interpolated w gives the pixel itself
    vPix = vec3(pix * c.w, c.w);
    vEnds = vec4(sA, sB);
    vRadius = radius;
  }`;

/**
 * The fragment shader's tube: its light across it (a core never thinner
 * than about a pixel, dimmer instead, and a soft halo), from the pixel's distance to the segment; `ends` its share along
 * it, for what the ends carry (their light, height and facing).
 */
export const STROKE_TUBE = /* glsl */ `
  varying vec3 vPix;
  varying vec4 vEnds;
  varying vec2 vRadius;
  varying vec4 vLit;
  varying vec2 vFacing;
  // The tube's light at this pixel; t is its share along the segment
  float strokeTube(float core, float halo, out float t) {
    vec2 pix = vPix.xy / vPix.z;
    vec2 a = vEnds.xy;
    vec2 ab = vEnds.zw - a;
    t = clamp(dot(pix - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    float r = mix(vRadius.x, vRadius.y, t);
    float across = length(pix - a - ab * t) / r;
    float fw = 1.0 / r;
    float w = max(core, fw * 0.8);
    float c = (1.0 - smoothstep(w - fw, w + fw, across)) * min(core / w, 1.0);
    float h = exp(-across * across * 7.0) * max(1.0 - across, 0.0) * halo;
    h *= 1.0 - smoothstep(${(STROKE_REACH * 0.6).toFixed(3)}, ${STROKE_REACH.toFixed(2)}, across);
    // Hidden where its surface turns away
    float facing = mix(vFacing.x, vFacing.y, t);
    return (c + h) * mix(vLit.x, vLit.y, t) * smoothstep(0.0, 0.12, facing);
  }`;
