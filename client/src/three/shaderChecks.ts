import type { RootState } from '@react-three/fiber';

/**
 * three.js checks every shader program on its first draw: it reads the
 * program's and both shaders' logs and its link status back from the GPU,
 * four waits on the GPU per program, which make up most of a first frame's
 * time where compiling is slow (a phone, software rendering). A shipped
 * build has no shader errors to report, so the checks run in development
 * only (the dev server, and the e2e suite on it). Pass as a Canvas's
 * onCreated, or call from it.
 */
export const shaderChecksInDevOnly = ({ gl }: Pick<RootState, 'gl'>) => {
  gl.debug.checkShaderErrors = import.meta.env.DEV;
};
