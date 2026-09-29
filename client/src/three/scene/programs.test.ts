import { describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, PointsMaterial, Scene, ShaderMaterial } from 'three';
import type { Material, Object3D, WebGLRenderer } from 'three';
import { retireMaterial, warmPrograms } from './programs';

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

describe('warmPrograms', () => {
  it('compiles meshes and points without drawing, and keeps their programs', () => {
    const programs = new Map<object, object>();
    const compiled: { type: string; material: Material }[] = [];
    const gl = {
      properties: { get: (m: object) => ({ currentProgram: programs.get(m) }) },
      compile: (scene: Object3D) => {
        scene.traverse((o) => {
          const m = (o as Object3D & { material?: Material }).material;
          if (!m) return;
          compiled.push({ type: o.type, material: m });
          programs.set(m, { shader: m.type });
        });
        return new Set();
      },
    } as unknown as WebGLRenderer;
    const [mark, mote] = [material(), new PointsMaterial()];
    warmPrograms(gl, new PerspectiveCamera(), new Scene(), [mark], [mote]);
    expect(compiled.map((c) => [c.type, c.material])).toEqual([
      ['Mesh', mark],
      ['Points', mote],
    ]);
    // A mark made later with the same program is disposed: the warm one keeps it
    const later = material();
    programs.set(later, programs.get(mark)!);
    retireMaterial(gl, later);
    expect(later.dispose).toHaveBeenCalledOnce();
    expect(mark.dispose).not.toHaveBeenCalled();
  });
});
