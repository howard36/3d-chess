import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

/**
 * A stepped clock (window.__vclock: the showcase's recordings, orbit.spec)
 * runs frames on command, several in one task, where no fence can pass:
 * every one of them is drawn, as each is captured.
 */
const stepped = () => typeof (window as { __vclock?: unknown }).__vclock === 'object';

/**
 * Draws the canvas's frames itself (a useFrame of priority 1 takes r3f's
 * render over), one at a time on the GPU: a frame whose predecessor the GPU
 * has not finished yet (a fence placed after it, not yet passed) is not
 * drawn, only asked for again. Without it a GPU slower than the display
 * (a phone's, software rendering) is handed a whole new picture every
 * display frame and falls behind by several, and anything that has to wait
 * for the GPU meanwhile (another canvas reading a program back, creating
 * its context) waits for all of them. The scene's motion still steps every
 * display frame, on r3f's clock (it runs before this): only pictures the
 * GPU could not have shown yet are dropped. A GPU that keeps up passes
 * every fence before the next display frame and draws them all as before.
 */
export const PaceOnGpu = () => {
  const gl = useThree((s) => s.gl);
  const fence = useRef<WebGLSync | null>(null);
  useEffect(() => {
    const context = gl.getContext() as WebGL2RenderingContext;
    return () => {
      if (fence.current && !context.isContextLost()) context.deleteSync(fence.current);
      fence.current = null;
    };
  }, [gl]);
  useFrame(({ scene, camera, invalidate }) => {
    const context = gl.getContext() as WebGL2RenderingContext;
    const last = fence.current;
    if (last) {
      const lost = context.isContextLost();
      const busy =
        !lost &&
        !stepped() &&
        context.getSyncParameter(last, context.SYNC_STATUS) !== context.SIGNALED;
      if (busy) {
        invalidate();
        return;
      }
      if (!lost) context.deleteSync(last);
      fence.current = null;
    }
    gl.render(scene, camera);
    if (typeof context.fenceSync !== 'function' || context.isContextLost()) return;
    fence.current = context.fenceSync(context.SYNC_GPU_COMMANDS_COMPLETE, 0);
    context.flush();
  }, 1);
  return null;
};
