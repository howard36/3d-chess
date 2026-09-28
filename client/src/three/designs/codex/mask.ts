import { FRAME, LIFT, MARGIN, PIECE_SCALE } from './palette';

// The tower mask (after Lumen's): whatever of the far notation lies behind
// the tower, seen through its panes from wherever the camera is, is held
// down to nothing, so nothing drifting in the distance ever shows through
// the platforms or reads as part of a level. The test is exact, not a cone:
// the ray from the camera to the point is tried against the tower's box
// (panes, pieces lifted on them, a little air) and a wider box round it,
// each as a continuous measure of how far inside the ray runs, for a soft
// fade at the tower's outline with no hard edge.

const HALF = FRAME.half + MARGIN + 0.1;
const BOTTOM = FRAME.levelY[0] - 0.1;
// The top level's tallest piece, lifted when picked up
const TOP = FRAME.levelY[4] + (0.87 + LIFT.selected) * PIECE_SCALE + 0.1;

const f = (n: number) => n.toFixed(4);

/**
 * GLSL: `float towerCover(vec3 world)`, 0 clear of the tower to 1 behind
 * it (from the camera), for a shader to fade by.
 */
export const TOWER_MASK = /* glsl */ `
  const vec3 TOWER_MIN = vec3(${f(-HALF)}, ${f(BOTTOM)}, ${f(-HALF)});
  const vec3 TOWER_MAX = vec3(${f(HALF)}, ${f(TOP)}, ${f(HALF)});
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
    return clamp(0.55 * towerHit(cameraPosition, inv, len, 0.0)
      + 0.45 * towerHit(cameraPosition, inv, len, 1.2), 0.0, 1.0);
  }`;
