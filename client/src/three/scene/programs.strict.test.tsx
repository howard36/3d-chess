import { StrictMode } from 'react';
import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ShaderMaterial } from 'three';

// A renderer stand-in whose materials have all drawn with one program
const r3f = vi.hoisted(() => ({
  program: {},
  gl: null as unknown as import('three').WebGLRenderer,
}));
r3f.gl = {
  properties: { get: () => ({ currentProgram: r3f.program }) },
} as unknown as import('three').WebGLRenderer;
vi.mock('@react-three/fiber', () => ({
  useThree: (pick: (s: object) => unknown) => pick({ gl: r3f.gl }),
}));

import { retireMaterial, useRetireOnUnmount } from './programs';

const Mark = ({ material }: { material: ShaderMaterial }) => {
  useRetireOnUnmount(material);
  return null;
};

it('keeps a program through StrictMode’s rehearsed unmount of a mark that has drawn', () => {
  // A frame can draw the mark between its commit and its effects: the
  // rehearsal then retires it with its program, so it keeps the program
  const live = new ShaderMaterial();
  vi.spyOn(live, 'dispose');
  const view = render(
    <StrictMode>
      <Mark material={live} />
    </StrictMode>,
  );
  // Its real unmount must not dispose the program's keeper
  view.unmount();
  expect(live.dispose).not.toHaveBeenCalled();
  // The next mark drawn with the program is disposed, the program kept alive
  const next = new ShaderMaterial();
  vi.spyOn(next, 'dispose');
  retireMaterial(r3f.gl, next);
  expect(next.dispose).toHaveBeenCalledOnce();
});
