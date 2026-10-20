import { useEffect, useRef } from 'react';
import { advance, useFrame, useThree } from '@react-three/fiber';
import type { Camera, Object3D, Scene } from 'three';
import { MAX_PASSES } from './scene/damage';

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
  const get = useThree((s) => s.get);
  const fence = useRef<{ sync: WebGLSync; skipped: number } | null>(null);
  // The timer that watches a held frame's fence (awaitedFrame)
  const poll = useRef(0);
  useEffect(() => {
    const context = gl.getContext() as WebGL2RenderingContext;
    const canvas = gl.domElement;
    // A fence from before a lost context is no fence after it: forget it
    const lost = () => (fence.current = null);
    canvas.addEventListener('webglcontextlost', lost);
    return () => {
      canvas.removeEventListener('webglcontextlost', lost);
      clearTimeout(poll.current);
      poll.current = 0;
      if (fence.current && !context.isContextLost()) context.deleteSync(fence.current.sync);
      fence.current = null;
    };
  }, [gl]);
  const draw = (scene: Scene, camera: Camera) => {
    const context = gl.getContext() as WebGL2RenderingContext;
    if (scene.userData) scene.userData.awaited = false;
    gl.render(scene, camera);
    // A frame at rest drawn in part may take a pass for each rect it redraws
    // (backdropCache.tsx), MAX_PASSES at most whatever nextPass says
    const nextPass = scene.userData?.nextPass as (() => boolean) | undefined;
    for (let pass = 1; pass < MAX_PASSES && nextPass?.(); pass++) gl.render(scene, camera);
    // (a frame drawn in part, backdropCache.tsx, leaves no scissor behind)
    if (gl.getScissorTest()) gl.setScissorTest(false);
    if (typeof context.fenceSync !== 'function' || context.isContextLost()) return;
    const sync = context.fenceSync(context.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!sync) return;
    fence.current = { sync, skipped: 0 };
    context.flush();
  };
  // A held frame the player waits on is drawn as soon as its predecessor's
  // fence passes, not at the next display frame: the GPU is not left idle
  // for up to a display frame at each step of the chain before the picture
  const watch = (scene: Scene) => {
    if (poll.current) return;
    const check = () => {
      poll.current = 0;
      const context = gl.getContext() as WebGL2RenderingContext;
      const last = fence.current;
      if (!last || context.isContextLost() || !awaited(scene)) return;
      if (context.getSyncParameter(last.sync, context.SYNC_STATUS) === context.UNSIGNALED) {
        poll.current = window.setTimeout(check, 1);
        return;
      }
      // One step of every useFrame on r3f's clock, this one's draw included
      advance(performance.now(), false, get());
    };
    poll.current = window.setTimeout(check, 1);
  };
  useFrame(({ scene, camera, invalidate }) => {
    const context = gl.getContext() as WebGL2RenderingContext;
    const last = fence.current;
    if (last) {
      const lost = context.isContextLost();
      // Only a fence the GPU says it has not reached holds the frame (one it
      // cannot read says nothing), and for PACE_MAX_SKIPS frames at most
      const busy =
        !lost &&
        !stepped() &&
        last.skipped < PACE_MAX_SKIPS &&
        context.getSyncParameter(last.sync, context.SYNC_STATUS) === context.UNSIGNALED;
      if (busy) {
        last.skipped++;
        invalidate();
        if (awaited(scene)) watch(scene);
        return;
      }
      if (!lost) context.deleteSync(last.sync);
      fence.current = null;
    }
    clearTimeout(poll.current);
    poll.current = 0;
    draw(scene, camera);
  }, 1);
  return null;
};

/** A new position or a selection the player waits on to see (Board): its first frame is awaited. */
export const markAwaited = (scene: Object3D) => {
  scene.userData.awaited = true;
};

const awaited = (scene: Object3D) => scene.userData?.awaited === true;

/** The display frames a frame waits for the GPU at most (a second at 60 Hz): a fence that never passes holds nothing. */
export const PACE_MAX_SKIPS = 60;
