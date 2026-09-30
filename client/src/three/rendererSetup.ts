import type { RootState } from '@react-three/fiber';

/**
 * What every canvas asks of its renderer as it is created (pass as a
 * Canvas's onCreated, or call from it), for the waits on the GPU it spares
 * the frames that follow:
 *
 * - three.js checks every shader program on its first draw: it reads the
 *   program's and both shaders' logs and its link status back from the GPU,
 *   four waits on the GPU per program, which make up most of a first
 *   frame's time where compiling is slow (a phone, software rendering). A
 *   shipped build has no shader errors to report, so the checks run in
 *   development only (the dev server, and the e2e suite on it).
 * - three.js asks the GPU for its anisotropic filtering extension, and then
 *   for its largest anisotropy, the first time it uploads a texture that
 *   filters that way (the labels', as the entrance plays): calls that each
 *   wait for the GPU to finish everything queued before them (0.6 s each in
 *   software). Asked here, before anything is queued, they cost next to
 *   nothing, and three.js remembers the answers.
 */
export const setUpRenderer = ({ gl }: Pick<RootState, 'gl'>) => {
  gl.debug.checkShaderErrors = import.meta.env.DEV;
  gl.capabilities.getMaxAnisotropy();
};
