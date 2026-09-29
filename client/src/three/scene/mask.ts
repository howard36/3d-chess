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

/** Uniforms for a material that uses TOWER_SHADE. */
export const shadeUniforms = () => ({
  uHull: towerHull,
  uHullCount: towerHullCount,
  uShadeViewport: shadeViewport,
});

const CORNERS: P2[] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];
/** The bottom and top platforms' corners: the stack's outline is theirs. */
const STACK = [FRAME.levelY[0], FRAME.levelY[FRAME.levelY.length - 1]].flatMap((y) =>
  CORNERS.map(([sx, sz]): [number, number, number] => [sx * PLATFORM_HALF, y, sz * PLATFORM_HALF]),
);
const v = new Vector3();
const cross = (o: P2, a: P2, b: P2) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/**
 * The tower's outline on screen for a camera: the convex hull of its
 * platforms (NDC, x scaled by the aspect), counterclockwise; null when it is
 * not wholly in front of the camera.
 */
export const towerOutlineOnScreen = (camera: Camera, aspect: number): P2[] | null => {
  camera.updateMatrixWorld();
  const pts: P2[] = [];
  for (const [x, y, z] of STACK) {
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

/** Writes the tower's outline on screen into the shared uniforms. */
export const updateTowerOutline = (camera: Camera, aspect: number) => {
  const hull = towerOutlineOnScreen(camera, aspect) ?? [];
  const n = Math.min(hull.length, HULL_MAX);
  for (let i = 0; i < n; i++) towerHull.value[i].set(hull[i][0], hull[i][1]);
  if (n) towerHull.value[n].set(hull[0][0], hull[0][1]);
  towerHullCount.value = n;
};

/** Signed distance from a point to a counterclockwise convex outline (negative inside). */
const outlineDistance = (hull: P2[], [px, py]: P2) => {
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
    d = Math.min(d, Math.hypot(wx - ex * t, wy - ey * t));
  });
  return inside ? -d : d;
};

/** The shade at a point on screen, 0–1 (the CPU twin of TOWER_SHADE, for tests). */
export const shadeAt = (hull: P2[] | null, p: P2) =>
  hull && hull.length >= 3
    ? 1 - MathUtils.smoothstep(outlineDistance(hull, p), -0.25 * SHADE_WIDTH, SHADE_WIDTH)
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
      d = min(d, length(w - e * t));
    }
    return 1.0 - smoothstep(-0.25 * ${SHADE_WIDTH.toFixed(2)}, ${SHADE_WIDTH.toFixed(2)}, inside ? -d : d);
  }`;
