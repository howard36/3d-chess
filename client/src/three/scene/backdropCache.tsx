import { useLayoutEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useThree } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  FramebufferTexture,
  Group,
  Mesh,
  ShaderMaterial,
  Vector2,
} from 'three';
import type { Camera, Material, Object3D, Scene, WebGLRenderer } from 'three';
import { noRaycast } from '../noRaycast';

// The garden (Stage: the sky, the ground, the stars, the sculptures and their
// mist) is most of a frame's fill, and it changes only with the camera, the
// drawing buffer and a few uniforms. The marks of play, a move landing and a
// piece picked up all happen with the camera at rest, so a frame then draws
// the garden exactly as the last one did. This keeps a copy instead: the
// first frame drawn with everything the garden depends on unchanged since
// the frame before copies the canvas right after the garden is drawn (the
// garden draws first: every part of it is in three.js's opaque list, below
// the tower's layers), and the frames after it, while that still holds,
// draw the copy in one full-screen pass in place of the garden. The copy is
// the canvas's own resolved pixels written back unchanged, and the garden
// writes no depth, so a frame comes out as the full frame would draw it
// (0 bytes differed at 1280x720), but for one case: where an edge of the
// garden (a tube, a star) and an edge of the tower share a pixel, the
// tower's uncovered samples get the garden's resolved colour, not their
// own, a step of 1 at most. A frame whose camera, buffer or garden differs
// draws the garden as always.

/** The garden draws below this renderOrder, the tower at or above it. */
export const BACKDROP_END = -850;

/** A full-screen triangle, drawn with its pixels read straight from the copy. */
const cacheVertex = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

const cacheFragment = /* glsl */ `
  uniform highp sampler2D uCache;
  void main() {
    gl_FragColor = texelFetch(uCache, ivec2(gl_FragCoord.xy), 0);
  }`;

/** The copy's material: no blending, no depth, no colour conversion. */
export const backdropMaterial = () =>
  new ShaderMaterial({
    uniforms: { uCache: { value: null } },
    vertexShader: cacheVertex,
    fragmentShader: cacheFragment,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });

/**
 * Everything a frame of the garden depends on, as numbers: the camera, the
 * drawing buffer, and each of the garden's objects (shown, placed) and
 * uniforms. Two frames with the same numbers draw the same garden.
 */
export const backdropSignature = (
  gl: Pick<WebGLRenderer, 'getDrawingBufferSize'>,
  camera: Camera,
  garden: Object3D,
  out: number[],
) => {
  out.length = 0;
  const size = gl.getDrawingBufferSize(drawingBuffer);
  out.push(size.x, size.y);
  pushAll(out, camera.matrixWorld.elements);
  pushAll(out, camera.projectionMatrix.elements);
  const materials = new Set<Material>();
  garden.traverse((o) => {
    if (o === garden) return;
    out.push(o.visible ? 1 : 0, (o as Mesh).geometry?.id ?? -1);
    pushAll(out, o.matrixWorld.elements);
    const m = (o as Mesh).material;
    if (m) for (const one of Array.isArray(m) ? m : [m]) materials.add(one);
  });
  for (const m of materials) {
    out.push((m as NumberedMaterial).id, m.version, m.visible ? 1 : 0);
    const uniforms = (m as ShaderMaterial).uniforms;
    if (uniforms) for (const name in uniforms) pushValue(out, uniforms[name].value);
  }
  return out;
};

const drawingBuffer = new Vector2();

/** Every material has a numeric `id` (three's Material.js); @types/three 0.186 leaves it out. */
type NumberedMaterial = Material & { readonly id: number };

const pushAll = (out: number[], values: ArrayLike<number>) => {
  for (let i = 0; i < values.length; i++) out.push(values[i]);
};

/** A uniform's value as numbers (numbers, vectors, colours, matrices, arrays of them). */
const pushValue = (out: number[], v: unknown): void => {
  if (typeof v === 'number') out.push(v);
  else if (typeof v === 'boolean') out.push(v ? 1 : 0);
  else if (v === null || v === undefined) out.push(NaN);
  else if (Array.isArray(v) || ArrayBuffer.isView(v)) {
    const list = v as ArrayLike<unknown>;
    out.push(list.length);
    for (let i = 0; i < list.length; i++) pushValue(out, list[i]);
  } else if (typeof v === 'object') {
    const o = v as { elements?: ArrayLike<number>; isColor?: boolean; id?: number } & Record<
      string,
      unknown
    >;
    if (o.elements) pushAll(out, o.elements);
    else if (o.isColor) out.push(o.r as number, o.g as number, o.b as number);
    else if ('x' in o) {
      out.push(o.x as number, o.y as number);
      if ('z' in o) out.push(o.z as number);
      if ('w' in o) out.push(o.w as number);
    } else out.push(typeof o.id === 'number' ? o.id : NaN);
  }
};

const same = (a: number[], b: number[]) => {
  if (a.length !== b.length) return false;
  // NaN stands for "no value" and matches itself
  for (let i = 0; i < a.length; i++)
    if (a[i] !== b[i] && !(a[i] !== a[i] && b[i] !== b[i])) return false;
  return true;
};

/** A triangle covering the whole view (clip space). */
const screenTriangle = () => {
  const g = new BufferGeometry();
  g.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  );
  return g;
};

/** A triangle of no area: drawn, it touches no pixel (warmObjects' trick). */
const noTriangle = () => {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  return g;
};

type Mode = 'plain' | 'capture' | 'cached';

/**
 * The garden (`children`: Stage) drawn from a copy while nothing it depends
 * on changes. See the top of this file.
 */
export const BackdropCache = ({ children }: { children: ReactNode }) => {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const garden = useRef<Group>(null);
  const parts = useMemo(() => {
    const material = backdropMaterial();
    const copy = new Mesh(screenTriangle(), material);
    copy.name = 'backdrop-copy';
    copy.renderOrder = -2000;
    copy.frustumCulled = false;
    copy.raycast = noRaycast;
    copy.visible = false;
    // Drawn right after the garden (and before the tower) on the frame that
    // takes the copy; touches no pixel itself
    const take = new Mesh(noTriangle(), material);
    take.name = 'backdrop-take';
    take.renderOrder = BACKDROP_END;
    take.frustumCulled = false;
    take.raycast = noRaycast;
    take.visible = false;
    return { material, copy, take };
  }, []);

  // In the scene as it is created (a layout effect), so the copy's program
  // is linked with the rest before the first frame (linkBeforeFirstFrame),
  // not in the first frame the camera rests, the page waiting on it
  useLayoutEffect(() => {
    const { material, copy, take } = parts;
    const state = {
      last: [] as number[],
      next: [] as number[],
      texture: null as FramebufferTexture | null,
      valid: false,
    };
    const show = (mode: Mode) => {
      if (garden.current) garden.current.visible = mode !== 'cached';
      copy.visible = mode === 'cached';
      take.visible = mode === 'capture';
    };
    take.onAfterRender = (renderer) => {
      const size = renderer.getDrawingBufferSize(drawingBuffer);
      let texture = state.texture;
      if (!texture || texture.image.width !== size.x || texture.image.height !== size.y) {
        texture?.dispose();
        texture = state.texture = new FramebufferTexture(size.x, size.y);
        material.uniforms.uCache.value = texture;
      }
      renderer.copyFramebufferToTexture(texture);
      state.valid = true;
    };
    const before = scene.onBeforeRender;
    scene.onBeforeRender = (renderer: WebGLRenderer, s: Scene, camera: Camera, ...rest) => {
      before.call(scene, renderer, s, camera, ...rest);
      const g = garden.current;
      // Rendering somewhere else than the canvas: the garden as always
      if (!g || renderer.getRenderTarget() !== null) {
        show('plain');
        return;
      }
      const next = backdropSignature(renderer, camera, g, state.next);
      if (!same(next, state.last)) {
        state.valid = false;
        state.next = state.last;
        state.last = next;
        show('plain');
      } else show(state.valid ? 'cached' : 'capture');
    };
    // A lost context loses the copy
    const canvas = gl.domElement;
    const lost = () => {
      state.valid = false;
      state.last = [];
    };
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', lost);
    scene.add(copy, take);
    return () => {
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', lost);
      scene.onBeforeRender = before;
      scene.remove(copy, take);
      show('plain');
      state.texture?.dispose();
      copy.geometry.dispose();
      take.geometry.dispose();
      material.dispose();
    };
  }, [gl, scene, parts]);

  return (
    <group ref={garden} name="backdrop">
      {children}
    </group>
  );
};
