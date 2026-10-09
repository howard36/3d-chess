import { describe, expect, it, vi } from 'vitest';
import { Mesh, Points, PointsMaterial, ShaderMaterial } from 'three';
import type { WebGLRenderer } from 'three';
import {
  afterGpu,
  GPU_WAIT_MAX,
  keepPrograms,
  linkAhead,
  LINK_AHEAD_TRIES,
  retireMaterial,
  warmObjects,
} from './programs';

/** A renderer stand-in whose materials drew with the given programs. */
const rendererWith = (programs: Map<object, object>) =>
  ({
    properties: { get: (m: object) => ({ currentProgram: programs.get(m) }) },
  }) as unknown as WebGLRenderer;

const material = () => {
  const m = new ShaderMaterial();
  vi.spyOn(m, 'dispose');
  return m;
};

describe('retireMaterial', () => {
  it('keeps the first material to have drawn with a program, and disposes the rest', () => {
    const program = {};
    const [first, second, third] = [material(), material(), material()];
    const gl = rendererWith(
      new Map([
        [first, program],
        [second, program],
        [third, program],
      ]),
    );
    retireMaterial(gl, first);
    retireMaterial(gl, second);
    retireMaterial(gl, third);
    expect(first.dispose).not.toHaveBeenCalled();
    expect(second.dispose).toHaveBeenCalledOnce();
    expect(third.dispose).toHaveBeenCalledOnce();
  });

  it('keeps one material per program', () => {
    const [a, b] = [material(), material()];
    const gl = rendererWith(
      new Map([
        [a, {}],
        [b, {}],
      ]),
    );
    retireMaterial(gl, a);
    retireMaterial(gl, b);
    expect(a.dispose).not.toHaveBeenCalled();
    expect(b.dispose).not.toHaveBeenCalled();
  });

  it('disposes a material that never drew (it holds no program)', () => {
    const m = material();
    retireMaterial(rendererWith(new Map()), m);
    expect(m.dispose).toHaveBeenCalledOnce();
  });

  it('keeps nothing per renderer: another renderer’s program is its own', () => {
    const program = {};
    const [a, b] = [material(), material()];
    retireMaterial(rendererWith(new Map([[a, program]])), a);
    retireMaterial(rendererWith(new Map([[b, {}]])), b);
    expect(b.dispose).not.toHaveBeenCalled();
  });
});

describe('warmObjects and keepPrograms', () => {
  it('draws each material once on an object that covers no pixel', () => {
    const [mark, mote] = [material(), new PointsMaterial()];
    const { group } = warmObjects([mark], [mote]);
    const [mesh, points] = group.children as (Mesh | Points)[];
    expect(mesh).toBeInstanceOf(Mesh);
    expect(mesh.material).toBe(mark);
    expect(points).toBeInstanceOf(Points);
    expect(points.material).toBe(mote);
    // A triangle of no area, and a point far beyond any far plane
    expect([...mesh.geometry.getAttribute('position').array]).toEqual(new Array(9).fill(0));
    expect(points.geometry.getAttribute('position').getZ(0)).toBeGreaterThan(1e6);
    expect(group.children.every((o) => !o.frustumCulled)).toBe(true);
  });

  it("carries normals as the marks' geometry does, and none for the bare ones", () => {
    // three.js links one program for geometry with normals and another for
    // geometry without: warmed on the wrong kind, a mark links its own
    const [copy, mark, mote] = [material(), material(), new PointsMaterial()];
    const { group } = warmObjects([mark], [mote], [copy]);
    const [bare, mesh, points] = group.children as (Mesh | Points)[];
    expect(bare.material).toBe(copy);
    expect(Object.keys(bare.geometry.attributes)).toEqual(['position']);
    expect(mesh.material).toBe(mark);
    expect(Object.keys(mesh.geometry.attributes).sort()).toEqual(['normal', 'position']);
    expect([...mesh.geometry.getAttribute('position').array]).toEqual(new Array(9).fill(0));
    expect(points.material).toBe(mote);
  });

  it('keeps the programs the warmed materials drew with', () => {
    const program = {};
    const [warm, later] = [material(), material()];
    const gl = rendererWith(
      new Map([
        [warm, program],
        [later, program],
      ]),
    );
    keepPrograms(gl, [warm]);
    retireMaterial(gl, later);
    expect(later.dispose).toHaveBeenCalledOnce();
    expect(warm.dispose).not.toHaveBeenCalled();
  });
});

/** A renderer stand-in with fences: `signal()` passes every fence placed so far. */
const fencedRenderer = (programs: Map<object, object> = new Map()) => {
  const fences: { passed: boolean }[] = [];
  const context = {
    SYNC_GPU_COMMANDS_COMPLETE: 1,
    SYNC_STATUS: 2,
    SIGNALED: 3,
    UNSIGNALED: 4,
    lost: false,
    fenceSync: vi.fn(() => {
      const f = { passed: false };
      fences.push(f);
      return f;
    }),
    flush: vi.fn(),
    deleteSync: vi.fn(),
    isContextLost() {
      return this.lost;
    },
    getSyncParameter: (f: { passed: boolean }) => (f.passed ? 3 : 4),
  };
  const gl = {
    getContext: () => context,
    compile: vi.fn(() => new Set(programs.keys())),
    properties: { get: (m: object) => ({ currentProgram: programs.get(m) }) },
    info: { render: { frame: 0 } },
  };
  const signal = () => fences.forEach((f) => (f.passed = true));
  return { gl: gl as unknown as WebGLRenderer & typeof gl, context, signal };
};

/** A linked program stand-in, counting its read-backs. */
const program = () => ({ getUniforms: vi.fn(), getAttributes: vi.fn() });

describe('afterGpu', () => {
  it('goes on once a fence placed now has passed, polling between tasks', async () => {
    vi.useFakeTimers();
    try {
      const { gl, context, signal } = fencedRenderer();
      const then = vi.fn();
      expect(afterGpu(gl, then)).toBe(true);
      expect(context.flush).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(100);
      expect(then).not.toHaveBeenCalled();
      signal();
      await vi.advanceTimersByTimeAsync(10);
      expect(then).toHaveBeenCalledExactlyOnceWith(true);
      expect(context.deleteSync).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('goes on at once without fences, and without waiting further on a lost context or a GPU that never answers', async () => {
    vi.useFakeTimers();
    try {
      const none = vi.fn();
      const bare = { getContext: () => ({}) } as unknown as WebGLRenderer;
      expect(afterGpu(bare, none)).toBe(false);
      expect(none).toHaveBeenCalledExactlyOnceWith(false);

      const lost = fencedRenderer();
      const onLost = vi.fn();
      afterGpu(lost.gl, onLost);
      lost.context.lost = true;
      await vi.advanceTimersByTimeAsync(10);
      expect(onLost).toHaveBeenCalledExactlyOnceWith(false);

      const silent = fencedRenderer();
      const onSilent = vi.fn();
      afterGpu(silent.gl, onSilent);
      await vi.advanceTimersByTimeAsync(GPU_WAIT_MAX + 10);
      expect(onSilent).toHaveBeenCalledExactlyOnceWith(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('linkAhead', () => {
  it('hands every program over at once, then reads each back once the GPU is idle', async () => {
    vi.useFakeTimers();
    try {
      const [a, b] = [program(), program()];
      const { gl, signal } = fencedRenderer(
        new Map([
          [material(), a],
          [material(), b],
        ]),
      );
      const then = vi.fn();
      const root = new Mesh();
      linkAhead(gl, root, {} as never, then);
      expect(gl.compile).toHaveBeenCalledExactlyOnceWith(root, {}, null);
      // Nothing read back (a wait on the GPU) before the fence has passed
      expect(a.getUniforms).not.toHaveBeenCalled();
      signal();
      await vi.advanceTimersByTimeAsync(10);
      for (const p of [a, b]) {
        expect(p.getUniforms).toHaveBeenCalledOnce();
        expect(p.getAttributes).toHaveBeenCalledOnce();
      }
      expect(then).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits again when a frame was drawn since the fence (reading back would wait on it)', async () => {
    vi.useFakeTimers();
    try {
      const p = program();
      const { gl, context, signal } = fencedRenderer(new Map([[material(), p]]));
      const then = vi.fn();
      linkAhead(gl, new Mesh(), {} as never, then);
      gl.info.render.frame++;
      signal();
      await vi.advanceTimersByTimeAsync(10);
      expect(p.getUniforms).not.toHaveBeenCalled();
      expect(context.fenceSync).toHaveBeenCalledTimes(2);
      signal();
      await vi.advanceTimersByTimeAsync(10);
      expect(p.getUniforms).toHaveBeenCalledOnce();
      expect(then).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('goes on without reading back on a canvas that never stops drawing', async () => {
    vi.useFakeTimers();
    try {
      const p = program();
      const { gl, context, signal } = fencedRenderer(new Map([[material(), p]]));
      const then = vi.fn();
      linkAhead(gl, new Mesh(), {} as never, then);
      for (let i = 0; i < LINK_AHEAD_TRIES; i++) {
        gl.info.render.frame++;
        signal();
        await vi.advanceTimersByTimeAsync(10);
      }
      expect(context.fenceSync).toHaveBeenCalledTimes(LINK_AHEAD_TRIES);
      expect(p.getUniforms).not.toHaveBeenCalled();
      expect(then).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads nothing back when the GPU cannot be waited on (the frame will, as before)', () => {
    const p = program();
    const programs = new Map([[material(), p]]);
    const gl = {
      getContext: () => ({}),
      compile: vi.fn(() => new Set(programs.keys())),
      properties: { get: (m: ShaderMaterial) => ({ currentProgram: programs.get(m) }) },
      info: { render: { frame: 0 } },
    } as unknown as WebGLRenderer;
    const then = vi.fn();
    expect(linkAhead(gl, new Mesh(), {} as never, then)).toBe(false);
    expect(then).toHaveBeenCalledOnce();
    expect(p.getUniforms).not.toHaveBeenCalled();
  });
});
