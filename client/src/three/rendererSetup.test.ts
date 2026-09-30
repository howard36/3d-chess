import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebGLRenderer } from 'three';
import { setUpRenderer } from './rendererSetup';

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
