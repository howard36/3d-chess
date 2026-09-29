import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebGLRenderer } from 'three';
import { shaderChecksInDevOnly } from './shaderChecks';

const renderer = () => ({ debug: { checkShaderErrors: true } }) as unknown as WebGLRenderer;

describe('shaderChecksInDevOnly', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('keeps three.js’s shader checks in development', () => {
    vi.stubEnv('DEV', true);
    const gl = renderer();
    shaderChecksInDevOnly({ gl });
    expect(gl.debug.checkShaderErrors).toBe(true);
  });

  it('turns them off in a build', () => {
    vi.stubEnv('DEV', false);
    const gl = renderer();
    shaderChecksInDevOnly({ gl });
    expect(gl.debug.checkShaderErrors).toBe(false);
  });
});
