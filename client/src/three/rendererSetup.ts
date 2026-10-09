import type { RootState } from '@react-three/fiber';
import { afterGpu, linkAhead } from './scene/programs';

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
 *
 * The game's board also links its first frame's programs ahead of it
 * (linkBeforeFirstFrame).
 */
export const setUpRenderer = ({ gl }: Pick<RootState, 'gl'>) => {
  gl.debug.checkShaderErrors = import.meta.env.DEV;
  gl.capabilities.getMaxAnisotropy();
};

/**
 * Holds the canvas's first frame until every shader program of the scene as
 * it is created is linked (linkAhead), and the second until the GPU has
 * drawn the first (afterGpu), the page free meanwhile. three.js links a
 * program in the render() that first draws it and then reads its uniforms
 * back, a wait on the GPU, which by then also has the frame's earlier draws
 * to work through: the first frame's render() was one long task, the whole
 * garden's programs one after another (about half a second in software).
 * Then, with the page free, the frames after it would come at once, each
 * one more whole picture for a GPU still drawing the first (in software a
 * frame is hundreds of milliseconds of work): the second waits for it, as a
 * page held by the first one's render() did. Nothing drawn changes, only
 * when the waiting happens: the first frame is the same picture, drawn when
 * the GPU is ready for it (the entrance starts from it, on r3f's clock). A
 * program it needs that the scene did not foresee is linked in it, as before.
 * The game's board only (GameCanvas): its page shows the HUD and the record
 * before the board by design, and its entrance fades the board up from the
 * dark from that frame on; the lobby's words, by contrast, come in with
 * their canvas's first frame, which a page left free would show first.
 */
export const linkBeforeFirstFrame = ({
  gl,
  scene,
  camera,
  get,
}: Pick<RootState, 'gl' | 'scene' | 'camera' | 'get'>) => {
  // r3f draws an inactive root's frames once it is active again
  const resume = () => {
    // Taken down meanwhile: r3f is letting it go
    if (!gl.domElement.isConnected) return;
    get().internal.active = true;
    get().invalidate();
  };
  const held = linkAhead(gl, scene, camera, () => {
    const after = scene.onAfterRender;
    scene.onAfterRender = function (...args) {
      scene.onAfterRender = after;
      after.apply(this, args);
      if (afterGpu(gl, resume)) get().internal.active = false;
    };
    resume();
  });
  if (held) get().internal.active = false;
};
