import { FRAME, MARGIN, PIECE_SCALE } from './palette';

// The tower mask: whatever of the garden lies behind the tower, seen through
// its levels from wherever the camera is, is held down to nothing, so no line
// of the colossal board, star or constellation ever shows through a level or
// reads as part of it. It is fitted to what is there, not a padded box: the
// five platforms (one slab from under the bottom level's edge light to the
// top level's glass) and, above the top level, the pieces standing on it up
// to the tallest one held up (a narrower box: they stand on the squares, not
// the rim). Each is tried exactly against the ray from the camera to the
// point, as a continuous measure of how far inside it runs, so the edge of
// the mask is soft but tight.

const f = (n: number) => n.toFixed(4);

/** The platforms, their edge light included. */
export const SLAB = {
  half: FRAME.half + MARGIN + 0.025,
  y: [FRAME.levelY[0] - 0.035, FRAME.levelY[4] + 0.005] as const,
};
/** The pieces on the top level: the outer squares' pieces, the tallest held up. */
export const TOPS = {
  half: FRAME.half - 0.25,
  y: [FRAME.levelY[4], FRAME.levelY[4] + 0.87 * PIECE_SCALE + 0.16] as const,
};

/**
 * GLSL: `float towerCover(vec3 world)`, 0 clear of the tower and 1 behind
 * it, easing across a narrow soft edge round its real outline.
 */
export const TOWER_MASK = /* glsl */ `
  const vec3 SLAB_MIN = vec3(${f(-SLAB.half)}, ${f(SLAB.y[0])}, ${f(-SLAB.half)});
  const vec3 SLAB_MAX = vec3(${f(SLAB.half)}, ${f(SLAB.y[1])}, ${f(SLAB.half)});
  const vec3 TOPS_MIN = vec3(${f(-TOPS.half)}, ${f(TOPS.y[0])}, ${f(-TOPS.half)});
  const vec3 TOPS_MAX = vec3(${f(TOPS.half)}, ${f(TOPS.y[1])}, ${f(TOPS.half)});
  // How far the ray runs inside the box before reaching the point (and,
  // below zero, by how much it misses), eased into a continuous 0–1
  float towerHit(vec3 ro, vec3 inv, float len, vec3 bmin, vec3 bmax) {
    vec3 a = (bmin - ro) * inv;
    vec3 b = (bmax - ro) * inv;
    vec3 lo = min(a, b);
    vec3 hi = max(a, b);
    float tn = max(max(lo.x, lo.y), lo.z);
    float tf = min(min(hi.x, hi.y), hi.z);
    return smoothstep(-0.3, 0.05, min(tf, len) - max(tn, 0.0));
  }
  float towerCover(vec3 world) {
    vec3 d = world - cameraPosition;
    float len = length(d);
    vec3 rd = d / max(len, 1e-5);
    vec3 s = step(0.0, rd) * 2.0 - 1.0;
    vec3 inv = 1.0 / (s * max(abs(rd), vec3(1e-5)));
    return max(
      towerHit(cameraPosition, inv, len, SLAB_MIN, SLAB_MAX),
      towerHit(cameraPosition, inv, len, TOPS_MIN, TOPS_MAX)
    );
  }`;
