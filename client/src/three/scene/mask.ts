import { MathUtils, Vector2, Vector3 } from 'three';
import type { Camera } from 'three';
import { FRAME, MARGIN } from './palette';

// The tower's shade: everything of the garden behind and near the tower on
// screen (the colossal board, the sculptures and their glow, the stars) is
// darkened by a smooth screen-space gradient, darkest over the tower itself
// and easing steadily out to nothing a set distance away from it, with no
// step, line or corner anywhere. Its shape is the tower's real outline: the
// stack of five glass platforms as it projects on screen (the outline round
// the bottom and top platforms, which holds the three between them and the
// pieces standing among them), not a box padded round it or raised to the
// pieces' height: from high above only what lies behind the glass is dark,
// and the pieces standing on the top level (opaque, and close above their
// platform) sit in the gradient's darkest part. The gradient is a smooth
// function of the screen distance to that outline (a signed distance field,
// evaluated per pixel).

/** Half the side of a platform, its edge light included. */
const PLATFORM_HALF = FRAME.half + MARGIN + 0.02;
/** The gradient's width (NDC, screen height = 2). */
const SHADE_WIDTH = 0.45;
/**
 * How much shorter the gradient reaches below the tower than round its top
 * and sides, from a low camera (the far ground and the horizon lie just
 * under the tower there, and a full width fades them too far down); from
 * higher up it eases back to the same width all round.
 */
const SHADE_BELOW = 2.6;
/** The camera's look down (sine) from which the gradient below is full width again. */
const SHADE_BELOW_HIGH = Math.sin(MathUtils.degToRad(35));
/** ... and to which it is shortest. */
const SHADE_BELOW_LOW = Math.sin(MathUtils.degToRad(5));
/** The most corners the tower's outline on screen can have (a box's is six). */
const HULL_MAX = 8;

type P2 = [number, number];

/**
 * The tower's outline on screen (NDC, x scaled by the aspect),
 * counterclockwise, the first corner repeated after the last.
 */
const towerHull = { value: Array.from({ length: HULL_MAX + 1 }, () => new Vector2()) };
const towerHullCount = { value: 0 };
/** The drawing buffer's size in pixels and its aspect, to find NDC per fragment. */
export const shadeViewport = { value: new Vector3(1, 1, 1) };
/** How much the gradient below the tower is shortened, for this camera (1: not at all). */
const shadeBelow = { value: 1 };

/** Uniforms for a material that uses TOWER_SHADE. */
export const shadeUniforms = () => ({
  uHull: towerHull,
  uHullCount: towerHullCount,
  uShadeViewport: shadeViewport,
  uShadeBelow: shadeBelow,
});

const CORNERS: P2[] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];
type Stack = readonly (readonly [number, number, number])[];
/**
 * The corners of the platforms from level `lo` to `hi`, the outline of the
 * stack between them: the lowest and highest platforms' corners.
 */
export const platformStack = (lo: number, hi: number): Stack =>
  [FRAME.levelY[lo], FRAME.levelY[hi]].flatMap((y) =>
    CORNERS.map(([sx, sz]): [number, number, number] => [
      sx * PLATFORM_HALF,
      y,
      sz * PLATFORM_HALF,
    ]),
  );
/** The bottom and top platforms' corners: the stack's outline is theirs. */
const STACK = platformStack(0, FRAME.levelY.length - 1);
const v = new Vector3();
const cross = (o: P2, a: P2, b: P2) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/**
 * The tower's outline on screen for a camera: the convex hull of its
 * platforms (NDC, x scaled by the aspect), counterclockwise; null when it is
 * not wholly in front of the camera.
 */
export const towerOutlineOnScreen = (
  camera: Camera,
  aspect: number,
  stack: Stack = STACK,
): P2[] | null => {
  camera.updateMatrixWorld();
  const pts: P2[] = [];
  for (const [x, y, z] of stack) {
    v.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
    if (v.z > -0.05) return null;
    v.applyMatrix4(camera.projectionMatrix);
    pts.push([v.x * aspect, v.y]);
  }
  // Andrew's monotone chain
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (list: P2[]) => {
    const out: P2[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) {
        out.pop();
      }
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())];
};

/**
 * Writes the tower's outline on screen into the shared uniforms (or the
 * outline of `stack`, fewer platforms than the whole tower).
 */
/** The gradient's shortening below the tower for a camera looking down by `lookDown` (sine). */
export const shadeBelowFor = (lookDown: number) =>
  MathUtils.lerp(SHADE_BELOW, 1, MathUtils.smoothstep(lookDown, SHADE_BELOW_LOW, SHADE_BELOW_HIGH));

const look = new Vector3();
export const updateTowerOutline = (camera: Camera, aspect: number, stack: Stack = STACK) => {
  const hull = towerOutlineOnScreen(camera, aspect, stack) ?? [];
  shadeBelow.value = shadeBelowFor(-camera.getWorldDirection(look).y);
  const n = Math.min(hull.length, HULL_MAX);
  for (let i = 0; i < n; i++) towerHull.value[i].set(hull[i][0], hull[i][1]);
  if (n) towerHull.value[n].set(hull[0][0], hull[0][1]);
  towerHullCount.value = n;
};

/**
 * Signed distance from a point to a counterclockwise convex outline
 * (negative inside), any part of it downward from the outline stretched by
 * `below`, so the gradient reaches that much less far under the tower.
 */
const outlineDistance = (hull: P2[], [px, py]: P2, below = 1) => {
  let d = Infinity;
  let inside = true;
  hull.forEach(([ax, ay], i) => {
    const [bx, by] = hull[(i + 1) % hull.length];
    const ex = bx - ax;
    const ey = by - ay;
    const wx = px - ax;
    const wy = py - ay;
    if (ex * wy - ey * wx < 0) inside = false;
    const t = Math.min(Math.max((wx * ex + wy * ey) / Math.max(ex * ex + ey * ey, 1e-12), 0), 1);
    const dy = wy - ey * t;
    d = Math.min(d, Math.hypot(wx - ex * t, dy < 0 ? dy * below : dy));
  });
  return inside ? -d : d;
};

/** The shade at a point on screen, 0–1 (the CPU twin of TOWER_SHADE, for tests). */
export const shadeAt = (hull: P2[] | null, p: P2, below = shadeBelow.value) =>
  hull && hull.length >= 3
    ? 1 - MathUtils.smoothstep(outlineDistance(hull, p, below), -0.25 * SHADE_WIDTH, SHADE_WIDTH)
    : 0;

/**
 * GLSL: `float towerShade()`, the tower's shade at this fragment: 1 over the
 * tower and easing smoothly (no step anywhere) to 0 at the gradient's width
 * outside its outline. Needs shadeUniforms().
 */
export const TOWER_SHADE = /* glsl */ `
  uniform vec2 uHull[${HULL_MAX + 1}];
  uniform float uHullCount;
  uniform vec3 uShadeViewport;
  uniform float uShadeBelow;
  float towerShade() {
    if (uHullCount < 3.0) return 0.0;
    vec2 p = gl_FragCoord.xy / uShadeViewport.xy * 2.0 - 1.0;
    p.x *= uShadeViewport.z;
    // Signed distance to the convex outline: inside is left of every edge
    float d = 1e3;
    bool inside = true;
    for (int i = 0; i < ${HULL_MAX}; i++) {
      if (float(i) >= uHullCount) break;
      vec2 a = uHull[i];
      vec2 e = uHull[i + 1] - a;
      vec2 w = p - a;
      if (e.x * w.y - e.y * w.x < 0.0) inside = false;
      float t = clamp(dot(w, e) / max(dot(e, e), 1e-12), 0.0, 1.0);
      // Downward from the outline the gradient is shorter (uShadeBelow)
      vec2 q = w - e * t;
      q.y *= q.y < 0.0 ? uShadeBelow : 1.0;
      d = min(d, length(q));
    }
    return 1.0 - smoothstep(-0.25 * ${SHADE_WIDTH.toFixed(2)}, ${SHADE_WIDTH.toFixed(2)}, inside ? -d : d);
  }`;

/**
 * GLSL for a vertex shader: `float shadeOfClip(vec4
 * clip)`, the tower's shade (TOWER_SHADE, the same function) at a vertex,
 * from its clip position, 0 behind the camera. For the garden's faint
 * things whose meshes are fine enough (or whose points are small enough)
 * that the shade between vertices is as good as the shade per pixel: a
 * vertex is far cheaper (software rendering pays for every pixel whenever
 * the camera moves, and the shade is a loop over the outline's edges).
 * Needs shadeUniforms().
 */
export const SHADE_AT_VERTEX = `${TOWER_SHADE.replace(
  'float towerShade() {',
  'float towerShadeAt(vec2 p) {',
).replace(/\n\s*vec2 p = gl_FragCoord[^\n]*\n\s*p\.x \*= uShadeViewport\.z;/, '')}
  float shadeOfClip(vec4 clip) {
    if (clip.w <= 0.0) return 0.0;
    vec2 p = clip.xy / clip.w;
    p.x *= uShadeViewport.z;
    return towerShadeAt(p);
  }`;
