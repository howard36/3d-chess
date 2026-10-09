import { describe, expect, it } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { Color, PerspectiveCamera, ShaderMaterial, Vector2 } from 'three';
import type { Material, Mesh, Object3D, Scene, WebGLRenderer } from 'three';
import { BACKDROP_END, BackdropCache, backdropSignature } from './backdropCache';
import { Stage } from './stage';
import { LAYER } from './layers';

// The garden drawn from a copy of itself while nothing it depends on
// changes: the copy is taken on the first frame at rest and drawn in place
// of the garden on the frames after it, until the camera, the drawing
// buffer or the garden changes.

/** A stand-in for the renderer, as the cache sees it. */
const fakeRenderer = (size = [640, 480]) => ({
  target: null as object | null,
  copies: 0,
  getDrawingBufferSize: (v: Vector2) => v.set(size[0], size[1]),
  getRenderTarget() {
    return this.target;
  },
  copyFramebufferToTexture() {
    this.copies++;
  },
});

const camera = () => {
  const c = new PerspectiveCamera(36, 4 / 3, 0.1, 1000);
  c.position.set(3, 4, 12);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  return c;
};

const skyMaterial = () =>
  new ShaderMaterial({
    uniforms: { uTop: { value: new Color('#123456') }, uMix: { value: 0.5 } },
  });

/** The cache round one garden mesh, and a frame drawer that runs its hooks as three.js would. */
const mount = async () => {
  const material = skyMaterial();
  const r = await ReactThreeTestRenderer.create(
    <BackdropCache>
      <mesh name="sky" material={material} renderOrder={-1000} />
    </BackdropCache>,
  );
  const scene = r.scene.instance as unknown as Scene;
  const garden = scene.getObjectByName('backdrop')!;
  const copy = scene.getObjectByName('backdrop-copy')!;
  const take = scene.getObjectByName('backdrop-take')! as Mesh;
  const gl = fakeRenderer();
  const cam = camera();
  /** One frame: the scene's hook, then the copy taken if the frame takes it. */
  const frame = () => {
    scene.onBeforeRender(
      gl as unknown as WebGLRenderer,
      scene,
      cam,
      null as never,
      null as never,
      null as never,
    );
    const mode = copy.visible ? 'cached' : take.visible ? 'capture' : 'plain';
    if (take.visible)
      take.onAfterRender(
        gl as unknown as WebGLRenderer,
        scene,
        cam,
        take.geometry,
        take.material as Material,
        null as never,
      );
    return { mode, garden: garden.visible };
  };
  return { r, scene, garden, copy, take, gl, cam, material, frame };
};

describe('BackdropCache', () => {
  it('draws the garden, then takes its copy on the first frame at rest, then draws the copy', async () => {
    const { frame, gl } = await mount();
    expect(frame()).toEqual({ mode: 'plain', garden: true });
    expect(frame()).toEqual({ mode: 'capture', garden: true });
    expect(gl.copies).toBe(1);
    for (let i = 0; i < 5; i++) expect(frame()).toEqual({ mode: 'cached', garden: false });
    // Taken once, drawn from then on
    expect(gl.copies).toBe(1);
  });

  it('draws the garden again whenever the camera, the buffer or the garden changes', async () => {
    const { frame, cam, material, gl, scene } = await mount();
    frame();
    frame();
    expect(frame().mode).toBe('cached');
    // The camera turns
    cam.position.x += 0.01;
    cam.updateMatrixWorld();
    expect(frame().mode).toBe('plain');
    expect(frame().mode).toBe('capture');
    expect(frame().mode).toBe('cached');
    // A garden uniform changes (a colour, a number)
    (material.uniforms.uTop.value as Color).set('#654321');
    expect(frame().mode).toBe('plain');
    frame();
    material.uniforms.uMix.value = 0.6;
    expect(frame().mode).toBe('plain');
    frame();
    // A part of the garden shows or hides (the shooting star)
    scene.getObjectByName('sky')!.visible = false;
    expect(frame().mode).toBe('plain');
    frame();
    expect(frame().mode).toBe('cached');
    // The window is resized
    gl.getDrawingBufferSize = (v: Vector2) => v.set(800, 600);
    expect(frame().mode).toBe('plain');
  });

  it('draws the garden as always into anything but the canvas', async () => {
    const { frame, gl } = await mount();
    frame();
    frame();
    expect(frame().mode).toBe('cached');
    gl.target = {};
    expect(frame()).toEqual({ mode: 'plain', garden: true });
  });

  it('forgets its copy with a lost context', async () => {
    const { r, frame } = await mount();
    frame();
    frame();
    expect(frame().mode).toBe('cached');
    const dom = (
      r.scene.instance as unknown as { __r3f?: { root?: { getState(): { gl: WebGLRenderer } } } }
    ).__r3f?.root?.getState().gl.domElement;
    expect(dom).toBeTruthy();
    dom!.dispatchEvent(new Event('webglcontextlost'));
    expect(frame().mode).toBe('plain');
  });

  it('takes its copy after the garden and before anything of the tower', async () => {
    const { take, copy } = await mount();
    // Everything of the tower draws at a LAYER, the garden below BACKDROP_END
    expect(take.renderOrder).toBe(BACKDROP_END);
    expect(BACKDROP_END).toBeLessThan(Math.min(0, ...Object.values(LAYER)));
    expect(copy.renderOrder).toBeLessThan(-1000);
  });

  it('leaves the scene as it found it when it goes', async () => {
    const { r, scene } = await mount();
    const hook = scene.onBeforeRender;
    expect(scene.getObjectByName('backdrop-copy')).toBeTruthy();
    await r.unmount();
    expect(scene.getObjectByName('backdrop-copy')).toBeUndefined();
    expect(scene.getObjectByName('backdrop-take')).toBeUndefined();
    expect(scene.onBeforeRender).not.toBe(hook);
  });
});

describe('backdropSignature', () => {
  it('is the same for the same frame and differs when the view does', () => {
    const cam = camera();
    const gl = fakeRenderer();
    const garden = { traverse: (f: (o: Object3D) => void) => f(garden as unknown as Object3D) };
    const a = [...backdropSignature(gl, cam, garden as unknown as Object3D, [])];
    const b = [...backdropSignature(gl, cam, garden as unknown as Object3D, [])];
    expect(b).toEqual(a);
    cam.fov = 40;
    cam.updateProjectionMatrix();
    expect(backdropSignature(gl, cam, garden as unknown as Object3D, [])).not.toEqual(a);
  });
});

describe('the garden', () => {
  it('draws entirely before the tower, from three.js opaque list, in its old order', async () => {
    const r = await ReactThreeTestRenderer.create(
      <BackdropCache>
        <Stage orientation="white" />
      </BackdropCache>,
    );
    const scene = r.scene.instance as unknown as Scene;
    const drawn: { name: string; order: number; material: Material }[] = [];
    scene.getObjectByName('backdrop')!.traverse((o) => {
      const m = (o as Mesh).material as Material | undefined;
      if (m) drawn.push({ name: o.name || o.type, order: o.renderOrder, material: m });
    });
    expect(drawn.length).toBeGreaterThanOrEqual(8);
    for (const d of drawn) {
      // Opaque-listed (drawn before the tower's opaque pieces), and under
      // the copy's taking
      expect(d.material.transparent, d.name).toBe(false);
      expect(d.order, d.name).toBeLessThan(BACKDROP_END);
      // Writes no depth: the tower is drawn over the copy as over the garden
      expect(d.material.depthWrite, d.name).toBe(false);
    }
    // The sky, then the ground, then everything added onto them (the stars,
    // the shooting star, the sculptures and their mist): as when those were
    // three.js's transparent list, drawn after the opaque ground
    // (the ground in parts, each with only its own detail: its clear middle
    // drawn just before the rest, which overlap its rim)
    const orders = drawn.map((d) => d.order);
    const sky = Math.min(...orders);
    expect(sky).toBe(-1000);
    const parts = drawn.filter((d) => d.name.startsWith('ground-'));
    expect(parts.map((d) => d.name).sort()).toEqual([
      'ground-board',
      'ground-court',
      'ground-far',
      'ground-middle',
    ]);
    const ground = Math.max(...parts.map((d) => d.order));
    expect(ground).toBe(-900);
    for (const d of drawn) {
      if (d.name.startsWith('ground-')) expect(d.order, d.name).toBeGreaterThan(-901);
      else if (d.order > sky) expect(d.order, d.name).toBeGreaterThan(ground);
      if (d.order > ground) expect(d.material.blending, d.name).not.toBe(1);
    }
  });
});

describe('the garden at rest', () => {
  it('draws the same frame after frame, so the copy is used (no uniform moves by itself)', async () => {
    const r = await ReactThreeTestRenderer.create(
      <BackdropCache>
        <Stage orientation="white" />
      </BackdropCache>,
    );
    const scene = r.scene.instance as unknown as Scene;
    const garden = scene.getObjectByName('backdrop')!;
    const gl = fakeRenderer();
    const cam = camera();
    // Its own motion done (the shooting star waits for a look up: none here)
    await r.advanceFrames(240, 1 / 30);
    scene.updateMatrixWorld(true);
    const a = backdropSignature(gl, cam, garden, []);
    await r.advanceFrames(90, 1 / 30);
    scene.updateMatrixWorld(true);
    expect(backdropSignature(gl, cam, garden, [])).toEqual(a);
  });

  it('keeps every value it draws with where the signature sees it', async () => {
    // A colour or a texture on a built-in material changes no uniform the
    // signature reads: a frame at rest would show the copy stale
    const r = await ReactThreeTestRenderer.create(
      <BackdropCache>
        <Stage orientation="white" />
      </BackdropCache>,
    );
    const scene = r.scene.instance as unknown as Scene;
    let materials = 0;
    scene.getObjectByName('backdrop')!.traverse((o) => {
      const m = (o as Mesh).material as Material | undefined;
      if (!m) return;
      materials++;
      expect((m as ShaderMaterial).isShaderMaterial, o.name || o.type).toBe(true);
      for (const [name, u] of Object.entries((m as ShaderMaterial).uniforms))
        expect(
          (u.value as { isTexture?: boolean } | null)?.isTexture,
          `${o.name}.${name}`,
        ).not.toBe(true);
    });
    expect(materials).toBeGreaterThanOrEqual(8);
  });
});
