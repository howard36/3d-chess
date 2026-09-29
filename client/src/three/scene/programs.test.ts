import { describe, expect, it, vi } from 'vitest';
import { ShaderMaterial } from 'three';
import type { WebGLRenderer } from 'three';
import { retireMaterial } from './programs';

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
