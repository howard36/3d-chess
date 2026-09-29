import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Mesh, Points, Scene } from 'three';
import type { Camera, Material, WebGLRenderer } from 'three';

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
 * Compiles these materials' programs now, between frames, drawing nothing,
 * and keeps each program alive as retireMaterial does (the materials are
 * never disposed). A program three.js has linked this way is ready by the
 * time a frame first draws with it, so the mark that needs it (the first
 * move's line, the first piece picked up) draws in a frame of the usual
 * cost. `points` materials are compiled for points, the rest for meshes;
 * `target` supplies the lights, as three.js's compile() takes them.
 */
export const warmPrograms = (
  gl: WebGLRenderer,
  camera: Camera,
  target: Scene,
  meshes: Material[],
  points: Material[] = [],
) => {
  const scene = new Scene();
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  for (const m of meshes) scene.add(new Mesh(geometry, m));
  for (const m of points) scene.add(new Points(geometry, m));
  gl.compile(scene, camera, target);
  for (const m of [...meshes, ...points]) {
    const state = gl.properties.get(m) as { currentProgram?: object } | undefined;
    const program = state?.currentProgram;
    if (program && !keepers.has(program)) keepers.set(program, m);
  }
  geometry.dispose();
};
