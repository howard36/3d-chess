import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Group, Mesh, Scene, Texture } from 'three';

// r3f stood in: the frame callback captured, a renderer counting its frames
const r3f = vi.hoisted(() => ({
  run: null as null | (() => void),
  gl: {
    info: { render: { frame: 0 } },
    domElement: null as unknown as HTMLCanvasElement,
  },
  scene: null as unknown as import('three').Scene,
  invalidate: () => {},
}));
vi.mock('@react-three/fiber', () => ({
  useThree: (pick: (s: object) => unknown) =>
    pick({ gl: r3f.gl, scene: r3f.scene, camera: {}, invalidate: r3f.invalidate }),
  useFrame: (run: () => void) => {
    r3f.run = run;
  },
}));
// Linked at once ('idle'); the programs kept by none of the materials
const ready = vi.hoisted(() => ({ then: null as null | ((o: string) => void) }));
vi.mock('./programs', async (actual) => ({
  ...(await actual<typeof import('./programs')>()),
  linkAhead: (_gl: unknown, _g: unknown, _c: unknown, then: (o: string) => void) => {
    ready.then = then;
    return true;
  },
  keepPrograms: () => new Set(),
}));
// jsdom draws no 2D canvas: the motes' sprite is a blank texture
vi.mock('./textures', async (actual) => ({
  ...(await actual<typeof import('./textures')>()),
  dotTexture: () => new Texture(),
}));
vi.mock('./pieces', async (actual) => ({
  ...(await actual<typeof import('./pieces')>()),
  markGlazeWarm: vi.fn(),
}));

import { WarmPrograms } from './warm';
import { WARM } from './programs';

it('draws its objects in one frame, then goes, never before a frame has drawn them', () => {
  r3f.gl.domElement = document.createElement('canvas');
  r3f.scene = new Scene();
  r3f.gl.info.render.frame = 10;
  render(<WarmPrograms />);
  const group = r3f.scene.getObjectByName(WARM) as Group;
  // Nothing drawn while the programs link
  expect(group.children).toHaveLength(0);
  r3f.run!();
  expect(group.children).toHaveLength(0);
  ready.then!('idle');
  expect(r3f.gl.domElement.dataset.warmLink).toBe('idle');
  // Before a frame: all of them join
  r3f.run!();
  expect(group.children.length).toBeGreaterThan(10);
  expect(group.children.every((o) => o instanceof Mesh || o.type === 'Points')).toBe(true);
  // That frame was not drawn (the renderer's count did not move): they stay
  r3f.run!();
  expect(r3f.scene.getObjectByName(WARM)).toBe(group);
  expect(r3f.gl.domElement.dataset.warm).toBeUndefined();
  // Drawn: before the next frame they go, and the warm-up is done
  r3f.gl.info.render.frame++;
  r3f.run!();
  expect(r3f.scene.getObjectByName(WARM)).toBeUndefined();
  expect(r3f.gl.domElement.dataset.warm).toBe('done');
});
