import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Group, Mesh, Points } from 'three';
import type { Material, WebGLRenderer } from 'three';

// three.js deletes a shader program as soon as the last material drawn with
// it is disposed, and the next material with the same shaders compiles and
// links it again, inside the render() that first draws it (a long task on a
// phone's GPU, seconds under software WebGL). The marks of play are made
// and disposed with each move and each selection (the last move's line,
// shimmer and marks, the held piece's light, a capture's outline), so every
// move and every selection paid for their programs again. Instead, the first
// material to have drawn with each program is kept for the renderer's life
// (never disposed, never drawn again), which keeps its program alive: a
// bounded set, one per shader the scene uses. The others are disposed as
// before.

/** Per program (per renderer, as a program belongs to one), the material keeping it. */
const keepers = new WeakMap<object, Material>();

/**
 * Disposes a material the scene is done with, unless it is the first to
 * have drawn with its shader program, which it then keeps alive.
 */
export const retireMaterial = (gl: WebGLRenderer, material: Material) => {
  const state = gl.properties?.get(material) as { currentProgram?: object } | undefined;
  const program = state?.currentProgram;
  if (program && !keepers.has(program)) {
    keepers.set(program, material);
    return;
  }
  material.dispose();
};

/** Retires `material` (retireMaterial) when it changes or the component goes. */
export const useRetireOnUnmount = (material: Material) => {
  const gl = useThree((s) => s.gl);
  useEffect(() => () => retireMaterial(gl, material), [gl, material]);
};

/**
 * Keeps the programs these materials have drawn with alive (as retireMaterial
 * keeps one); returns the materials now keeping one.
 */
export const keepPrograms = (gl: WebGLRenderer, materials: Material[]) => {
  const kept = new Set<Material>();
  for (const m of materials) {
    const state = gl.properties?.get(m) as { currentProgram?: object } | undefined;
    const program = state?.currentProgram;
    if (program && !keepers.has(program)) {
      keepers.set(program, m);
      kept.add(m);
    }
  }
  return kept;
};

/** The name of warmObjects' group. */
export const WARM = 'warm-programs';

/**
 * Objects that draw these materials without touching a pixel, for warming
 * their programs up (WarmPrograms): a mesh each on a triangle of no area,
 * and a points object each (`points`) on one point far beyond any far plane.
 * Drawn once in a frame, each compiles and links its program and sets up
 * its GPU state as the real mark will, so that mark's first frame costs no
 * more than any other.
 */
export const warmObjects = (meshes: Material[], points: Material[] = []) => {
  const group = new Group();
  group.name = WARM;
  const flat = new BufferGeometry();
  flat.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  const far = new BufferGeometry();
  far.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 1e9]), 3));
  for (const m of meshes) group.add(new Mesh(flat, m));
  for (const m of points) group.add(new Points(far, m));
  group.traverse((o) => {
    o.frustumCulled = false;
    o.raycast = () => {};
  });
  const dispose = () => {
    flat.dispose();
    far.dispose();
  };
  return { group, dispose };
};
