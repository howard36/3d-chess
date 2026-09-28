import { FRAME, LIFT, MARGIN, PIECE_SCALE } from './palette';

// The tower mask (after Lumen's): whatever of the hall lies behind the
// tower, seen through its platforms from wherever the camera is, is held
// down to nothing, so no board, clock or strip of the hall ever reads as part
// of a level, and nothing that flickers sits behind the tower. The test is
// exact, not a cone: the ray from the camera to the point is tried against
// the tower's box (platforms, pieces held up on them, a little air) and a
// wider box round it, each as a continuous measure of how far inside (or how
// near) the ray runs, for a soft fade at the tower's outline.

const HALF = FRAME.half + MARGIN + 0.04;
const BOTTOM = FRAME.levelY[0] - 0.08;
// The top level's tallest piece, held up
const TOP = FRAME.levelY[4] + (0.87 + LIFT.selected) * PIECE_SCALE + 0.05;

const f = (n: number) => n.toFixed(4);

/**
 * GLSL: `float towerCover(vec3 world)`, how much of the tower lies between
 * the camera and this point, 0 (clear) to 1 (behind it).
 */
export const TOWER_MASK = /* glsl */ `
  const vec3 TOWER_MIN = vec3(${f(-HALF)}, ${f(BOTTOM)}, ${f(-HALF)});
  const vec3 TOWER_MAX = vec3(${f(HALF)}, ${f(TOP)}, ${f(HALF)});
  // How far the ray runs inside the box before reaching the point (and,
  // below zero, by how much it misses), eased into a continuous 0–1
  float towerHit(vec3 ro, vec3 inv, float len, float e) {
    vec3 a = (TOWER_MIN - e - ro) * inv;
    vec3 b = (TOWER_MAX + e - ro) * inv;
    vec3 lo = min(a, b);
    vec3 hi = max(a, b);
    float tn = max(max(lo.x, lo.y), lo.z);
    float tf = min(min(hi.x, hi.y), hi.z);
    return smoothstep(-0.6, 0.1, min(tf, len) - max(tn, 0.0));
  }
  float towerCover(vec3 world) {
    vec3 d = world - cameraPosition;
    float len = length(d);
    vec3 rd = d / max(len, 1e-5);
    vec3 s = step(0.0, rd) * 2.0 - 1.0;
    vec3 inv = 1.0 / (s * max(abs(rd), vec3(1e-5)));
    return max(towerHit(cameraPosition, inv, len, 0.0), 0.85 * towerHit(cameraPosition, inv, len, 1.2));
  }`;
