import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Group, Mesh, Points } from 'three';
import type {
  Camera,
  Material,
  Object3D,
  Scene,
  WebGLProgram as ThreeProgram,
  WebGLRenderer,
} from 'three';

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
 * more than any other. three.js gives a material one program for geometry
 * with normals and another for geometry without, so the triangle carries
 * what the real mark's geometry does: normals for `meshes` (every mark's
 * has them), only positions for `bare` (the garden's copy, a full-screen
 * triangle). The bare ones come first, then the meshes, then the points.
 */
export const warmObjects = (meshes: Material[], points: Material[] = [], bare: Material[] = []) => {
  const group = new Group();
  group.name = WARM;
  const flat = new BufferGeometry();
  flat.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  const shaded = flat.clone();
  shaded.setAttribute(
    'normal',
    new BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3),
  );
  const far = new BufferGeometry();
  far.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 1e9]), 3));
  for (const m of bare) group.add(new Mesh(flat, m));
  for (const m of meshes) group.add(new Mesh(shaded, m));
  for (const m of points) group.add(new Points(far, m));
  group.traverse((o) => {
    o.frustumCulled = false;
    o.raycast = () => {};
  });
  const dispose = () => {
    flat.dispose();
    shaded.dispose();
    far.dispose();
  };
  return { group, dispose };
};

/** The longest afterGpu waits (ms) before going on regardless. */
export const GPU_WAIT_MAX = 10_000;

/**
 * Calls `then` once the GPU has done everything asked of it so far: a fence
 * placed now, polled between tasks, the page free meanwhile (rather than a
 * query that would hold the page until then). Returns false, calling `then`
 * at once, where there are no fences; a lost context, or a GPU that never
 * answers (GPU_WAIT_MAX), calls `then` without waiting further, with false.
 */
export const afterGpu = (gl: WebGLRenderer, then: (done: boolean) => void) => {
  const context = gl.getContext() as WebGL2RenderingContext;
  const fence =
    typeof context.fenceSync === 'function'
      ? context.fenceSync(context.SYNC_GPU_COMMANDS_COMPLETE, 0)
      : null;
  if (!fence) {
    then(false);
    return false;
  }
  context.flush();
  // (Date, not performance: the showcase's virtual clock stops the latter)
  // eslint-disable-next-line no-restricted-properties -- a GPU fence's timeout, not an animation
  const started = Date.now();
  const check = () => {
    const lost = context.isContextLost();
    const passed =
      !lost && context.getSyncParameter(fence, context.SYNC_STATUS) === context.SIGNALED;
    // eslint-disable-next-line no-restricted-properties -- as above
    if (!passed && !lost && Date.now() - started < GPU_WAIT_MAX) {
      // eslint-disable-next-line no-restricted-globals -- polls the fence off the frame loop
      setTimeout(check, 4);
      return;
    }
    context.deleteSync(fence);
    then(passed);
  };
  // eslint-disable-next-line no-restricted-globals -- as above
  setTimeout(check, 4);
  return true;
};

/**
 * Links the shader programs of everything under `root`, all at once and
 * without waiting on any, and calls `then` once they are ready to draw with.
 * three.js links a program in the render() that first draws it and at once
 * reads its uniforms back from the GPU, a wait on everything queued before it
 * (the frame's earlier draws, the frames before still being drawn): a long
 * task each, in software as long as a frame. Here `compile` hands the GPU
 * every program (it waits on none), and once the GPU has linked them
 * (afterGpu) with nothing drawn since, their uniforms and attributes are
 * read back, which the idle GPU answers at once, and three.js keeps them:
 * the frame that draws with them waits on none. Returns false (calling
 * `then` at once) where the GPU cannot be waited on so; `scene` gives the
 * lights (`root` itself by default).
 */
export const linkAhead = (
  gl: WebGLRenderer,
  root: Object3D,
  camera: Camera,
  then: () => void,
  scene: Scene | null = null,
) => {
  const materials = gl.compile(root, camera, scene);
  const wait = (tries: number): boolean => {
    const frame = gl.info.render.frame;
    return afterGpu(gl, (done) => {
      const idle = done && gl.info.render.frame === frame;
      // A frame drawn since the fence would be waited on too: wait for it
      // (a canvas at rest draws none), but not for ever (one that animates
      // draws them all the time: their first draw reads them back, as
      // three.js does, though they are linked)
      if (done && !idle && tries > 1) {
        wait(tries - 1);
        return;
      }
      if (idle)
        for (const m of materials)
          readBack(gl.properties.get(m) as { currentProgram?: ThreeProgram } | undefined);
      then();
    });
  };
  return wait(LINK_AHEAD_TRIES);
};

/** How many fences linkAhead places, at most, for a moment the GPU has nothing else to do. */
export const LINK_AHEAD_TRIES = 4;

/** A linked program's uniforms and attributes, read back from the GPU (three.js keeps them). */
const readBack = (state: { currentProgram?: ThreeProgram } | undefined) => {
  const program = state?.currentProgram;
  if (!program) return;
  program.getUniforms();
  program.getAttributes();
};
