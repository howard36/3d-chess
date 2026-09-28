import type { Material } from 'three';
import { FRAME, MARGIN, PIECE_SCALE } from './palette';

// The tower mask (after Lumen's): whatever of the night lies behind the tower,
// seen through its platforms from wherever the camera is, is held down to
// nothing, so no star, constellation line or engraving ever shows through a
// level, reads as part of it, or moves behind it. The test is exact, not a
// cone: the ray from the camera to the fragment is tried against the tower's
// box (platforms, the pieces standing and lifted on them, a little air) and a
// wider box round it, each as a continuous measure of how far inside (or how
// near) the ray runs, for a soft, full fade at the tower's outline.

const HALF = FRAME.half + MARGIN + 0.04;
const BOTTOM = FRAME.levelY[0] - 0.08;
// The top level's tallest piece, lifted when picked up
const TOP = FRAME.levelY[4] + (0.87 + 0.13) * PIECE_SCALE + 0.05;

const f = (n: number) => n.toFixed(4);

/**
 * GLSL: `float towerCover(vec3 world)`, how much of the tower lies between
 * the camera and this point (0–1), and `float towerMask(vec3 world, float
 * floorLevel)`, 1 clear of the tower and `floorLevel` behind it.
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
    return 0.55 * towerHit(cameraPosition, inv, len, 0.0)
      + 0.45 * towerHit(cameraPosition, inv, len, 1.2);
  }
  float towerMask(vec3 world, float floorLevel) {
    return mix(1.0, floorLevel, towerCover(world));
  }`;

/**
 * Gives one of three's own materials (basic, line, points) the tower mask:
 * its colour (and alpha) is scaled by it, so behind the tower it fades to
 * `floorLevel`.
 */
export const withTowerMask = <T extends Material>(material: T, floorLevel: number): T => {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMaskWorld;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvMaskWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vMaskWorld;\n${TOWER_MASK}`)
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>\ngl_FragColor *= towerMask(vMaskWorld, ${floorLevel.toFixed(3)});`,
      );
  };
  material.customProgramCacheKey = () => `meridian-mask-${floorLevel}`;
  return material;
};
