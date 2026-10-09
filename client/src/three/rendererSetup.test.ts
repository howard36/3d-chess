import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Scene } from 'three';
import type { WebGLRenderer } from 'three';
import type { RootState } from '@react-three/fiber';
import { linkBeforeFirstFrame, setUpRenderer } from './rendererSetup';

const renderer = () =>
  ({
    debug: { checkShaderErrors: true },
    capabilities: { getMaxAnisotropy: vi.fn(() => 16) },
  }) as unknown as WebGLRenderer;

describe('setUpRenderer', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('keeps three.js’s shader checks in development', () => {
    vi.stubEnv('DEV', true);
    const gl = renderer();
    setUpRenderer({ gl });
    expect(gl.debug.checkShaderErrors).toBe(true);
  });

  it('turns them off in a build', () => {
    vi.stubEnv('DEV', false);
    const gl = renderer();
    setUpRenderer({ gl });
    expect(gl.debug.checkShaderErrors).toBe(false);
  });

  it('asks for the largest anisotropy up front, not at the first texture upload', () => {
    const gl = renderer();
    setUpRenderer({ gl });
    expect(gl.capabilities.getMaxAnisotropy).toHaveBeenCalledOnce();
  });
});

describe('linkBeforeFirstFrame', () => {
  /** A renderer with fences (`signal()` passes those placed so far), a scene and r3f's state. */
  const setUp = () => {
    const fences: { passed: boolean }[] = [];
    const context = {
      SYNC_GPU_COMMANDS_COMPLETE: 1,
      SYNC_STATUS: 2,
      SIGNALED: 3,
      fenceSync: () => {
        const f = { passed: false };
        fences.push(f);
        return f;
      },
      flush: () => {},
      deleteSync: () => {},
      isContextLost: () => false,
      getSyncParameter: (f: { passed: boolean }) => (f.passed ? 3 : 4),
    };
    const gl = {
      getContext: () => context,
      compile: vi.fn(() => new Set()),
      properties: { get: () => undefined },
      info: { render: { frame: 0 } },
      domElement: { isConnected: true },
    } as unknown as WebGLRenderer;
    const scene = new Scene();
    const state = { internal: { active: true }, invalidate: vi.fn() };
    const get = (() => state) as unknown as RootState['get'];
    const signal = () => fences.forEach((f) => (f.passed = true));
    return { gl, scene, state, get, signal, fences };
  };

  it('links the scene’s programs before its first frame, the frame held until they are', async () => {
    vi.useFakeTimers();
    try {
      const { gl, scene, state, get, signal } = setUp();
      const camera = new PerspectiveCamera();
      linkBeforeFirstFrame({ gl, scene, camera, get });
      expect(gl.compile).toHaveBeenCalledWith(scene, camera, null);
      expect(state.internal.active).toBe(false);
      await vi.advanceTimersByTimeAsync(50);
      expect(state.internal.active).toBe(false);
      signal();
      await vi.advanceTimersByTimeAsync(10);
      expect(state.internal.active).toBe(true);
      expect(state.invalidate).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('holds the second frame until the GPU has drawn the first, and no later ones', async () => {
    vi.useFakeTimers();
    try {
      const { gl, scene, state, get, signal } = setUp();
      const own = vi.fn();
      scene.onAfterRender = own;
      linkBeforeFirstFrame({ gl, scene, camera: new PerspectiveCamera(), get });
      signal();
      await vi.advanceTimersByTimeAsync(10);
      // The first frame drawn
      scene.onAfterRender(
        gl,
        scene,
        new PerspectiveCamera(),
        null as never,
        null as never,
        null as never,
      );
      expect(own).toHaveBeenCalledOnce();
      expect(state.internal.active).toBe(false);
      signal();
      await vi.advanceTimersByTimeAsync(10);
      expect(state.internal.active).toBe(true);
      expect(state.invalidate).toHaveBeenCalledTimes(2);
      // The scene's own hook is back
      expect(scene.onAfterRender).toBe(own);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets a canvas taken down meanwhile go', async () => {
    vi.useFakeTimers();
    try {
      const { gl, scene, state, get, signal } = setUp();
      linkBeforeFirstFrame({ gl, scene, camera: new PerspectiveCamera(), get });
      (gl.domElement as { isConnected: boolean }).isConnected = false;
      signal();
      await vi.advanceTimersByTimeAsync(10);
      expect(state.internal.active).toBe(false);
      expect(state.invalidate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
