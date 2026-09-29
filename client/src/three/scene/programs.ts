import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
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
