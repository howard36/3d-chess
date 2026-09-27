import type { Material } from 'three';
import { FRAME, MARGIN, PIECE_SCALE } from './palette';

// The tower mask: whatever of the room lies behind the tower, seen through
// its panes from wherever the camera is, is held down (to nothing for props,
// to a murmur for the wall), so nothing in the studio ever reads as part of
// a level or as a piece that isn't there. The test is exact, not a cone: the
// ray from the camera to the fragment is tried against the tower's box
// (panes, pieces lifted on them, a little air) and a wider box round it,
// each as a continuous measure of how far inside (or how near) the ray runs,
// for a soft, full fade at the tower's outline with no hard edges.

const HALF = FRAME.half + MARGIN + 0.04;
const BOTTOM = FRAME.levelY[0] - 0.08;
// The top level's tallest piece, lifted when picked up
const TOP = FRAME.levelY[4] + (0.87 + 0.2) * PIECE_SCALE + 0.05;

const f = (n: number) => n.toFixed(4);

/**
 * GLSL: `float towerMask(vec3 world, float floorLevel)`, 1 clear of the
 * tower and `floorLevel` behind it; and `towerCover(world)`, the 0–1 cover
 * itself, for a shader that needs the mask at several floors.
 */
export const TOWER_MASK = /* glsl */ `
  const vec3 TOWER_MIN = vec3(${f(-HALF)}, ${f(BOTTOM)}, ${f(-HALF)});
  const vec3 TOWER_MAX = vec3(${f(HALF)}, ${f(TOP)}, ${f(HALF)});
  // How far the ray runs inside the box before reaching the fragment (and,
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
  // How much of the tower lies between the camera and this point, 0–1
  float towerCover(vec3 world) {
    vec3 d = world - cameraPosition;
    float len = length(d);
    vec3 rd = d / max(len, 1e-5);
    vec3 s = step(0.0, rd) * 2.0 - 1.0;
    vec3 inv = 1.0 / (s * max(abs(rd), vec3(1e-5)));
    return 0.6 * towerHit(cameraPosition, inv, len, 0.0)
      + 0.4 * towerHit(cameraPosition, inv, len, 1.0);
  }
  float towerMask(vec3 world, float floorLevel) {
    return mix(1.0, floorLevel, towerCover(world));
  }`;

/**
 * Gives one of three's own materials (basic, lambert, line) the tower mask:
 * its colour is scaled by it, so behind the tower it fades to `floorLevel`.
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
        `#include <opaque_fragment>\ngl_FragColor.rgb *= towerMask(vMaskWorld, ${floorLevel.toFixed(3)});`,
      );
  };
  material.customProgramCacheKey = () => `lumen-mask-${floorLevel}`;
  return material;
};
