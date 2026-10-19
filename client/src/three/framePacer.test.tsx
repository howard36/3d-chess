import { render } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { PACE_MAX_SKIPS, PaceOnGpu } from './framePacer';

// r3f stood in: the frame callback and its priority captured, the renderer a stand-in with fences
const frame = vi.hoisted(() => ({ run: null as null | ((s: object) => void), priority: 0 }));
const gpu = vi.hoisted(() => {
  const fences: { passed: boolean }[] = [];
  const context = {
    SYNC_GPU_COMMANDS_COMPLETE: 1,
    SYNC_STATUS: 2,
    SIGNALED: 3,
    UNSIGNALED: 4,
    lost: false,
    fenceSync: () => {
      const f = { passed: false };
      fences.push(f);
      return f;
    },
    flush: () => {},
    deleteSync: () => {},
    isContextLost() {
      return this.lost;
    },
    getSyncParameter: (f: { passed: boolean }) => (f.passed ? 3 : 4),
  };
  const canvas = new EventTarget();
  return {
    fences,
    context,
    gl: {
      getContext: () => context,
      scissorTest: false,
      render() {},
      getScissorTest() {
        return this.scissorTest;
      },
      setScissorTest(on: boolean) {
        this.scissorTest = on;
      },
      domElement: canvas,
    },
  };
});
vi.mock('@react-three/fiber', () => ({
  useThree: (pick: (s: object) => unknown) => pick({ gl: gpu.gl }),
  useFrame: (run: (s: object) => void, priority: number) => {
    frame.run = run;
    frame.priority = priority;
  },
}));

const state = { scene: {}, camera: {}, invalidate: vi.fn() };

beforeEach(() => {
  gpu.fences.length = 0;
  gpu.context.lost = false;
  state.invalidate.mockClear();
});

it('takes r3f’s render over, drawing a frame only once the GPU has drawn the last', () => {
  const draw = vi.spyOn(gpu.gl, 'render');
  render(<PaceOnGpu />);
  expect(frame.priority).toBe(1);
  frame.run!(state);
  expect(draw).toHaveBeenCalledTimes(1);
  expect(gpu.fences).toHaveLength(1);
  // The GPU still on it: no picture, the frame asked for again
  frame.run!(state);
  expect(draw).toHaveBeenCalledTimes(1);
  expect(state.invalidate).toHaveBeenCalledTimes(1);
  gpu.fences[0].passed = true;
  frame.run!(state);
  expect(draw).toHaveBeenCalledTimes(2);
  expect(draw).toHaveBeenLastCalledWith(state.scene, state.camera);
});

it('leaves no scissor behind a frame drawn in part', () => {
  // (backdropCache.tsx draws a frame at rest inside a scissor)
  const draw = vi.spyOn(gpu.gl, 'render').mockImplementation(() => {
    gpu.gl.scissorTest = true;
  });
  render(<PaceOnGpu />);
  frame.run!(state);
  expect(gpu.gl.scissorTest).toBe(false);
  draw.mockRestore();
});

it('draws on where the context is lost, never waiting on it', () => {
  const draw = vi.spyOn(gpu.gl, 'render');
  draw.mockClear();
  render(<PaceOnGpu />);
  frame.run!(state);
  gpu.context.lost = true;
  frame.run!(state);
  frame.run!(state);
  expect(draw).toHaveBeenCalledTimes(3);
  expect(state.invalidate).not.toHaveBeenCalled();
});

it('draws every frame on a stepped clock (a recording), which no fence can keep up with', () => {
  const draw = vi.spyOn(gpu.gl, 'render');
  draw.mockClear();
  (window as { __vclock?: object }).__vclock = {};
  try {
    render(<PaceOnGpu />);
    frame.run!(state);
    frame.run!(state);
    expect(draw).toHaveBeenCalledTimes(2);
  } finally {
    delete (window as { __vclock?: object }).__vclock;
  }
});

it('forgets a fence from before a lost context: after the restore it draws at once', () => {
  const draw = vi.spyOn(gpu.gl, 'render');
  draw.mockClear();
  render(<PaceOnGpu />);
  frame.run!(state);
  // Lost at rest (no frame runs meanwhile), then restored: the old fence reads as unsignalled
  gpu.gl.domElement.dispatchEvent(new Event('webglcontextlost'));
  frame.run!(state);
  expect(draw).toHaveBeenCalledTimes(2);
});

it('draws anyway once a fence has held it for PACE_MAX_SKIPS frames', () => {
  const draw = vi.spyOn(gpu.gl, 'render');
  draw.mockClear();
  render(<PaceOnGpu />);
  frame.run!(state);
  for (let i = 0; i < PACE_MAX_SKIPS; i++) frame.run!(state);
  expect(draw).toHaveBeenCalledTimes(1);
  frame.run!(state);
  expect(draw).toHaveBeenCalledTimes(2);
});
