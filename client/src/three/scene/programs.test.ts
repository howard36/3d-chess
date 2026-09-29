import { describe, expect, it, vi } from 'vitest';
import { Mesh, Points, PointsMaterial, ShaderMaterial } from 'three';
import type { WebGLRenderer } from 'three';
import { keepPrograms, retireMaterial, warmObjects } from './programs';

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
