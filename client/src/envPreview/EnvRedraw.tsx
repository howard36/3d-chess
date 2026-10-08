// ENV PREVIEW (temporary): redraws the canvas when a setting changes.
// Mounted inside Stage, so every canvas with the garden has one.

import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { useEnvVersion } from './index';

/**
 * The canvas renders on demand: a setting that only a frame reads (a
 * uniform set in useFrame, a visibility) would wait for the next frame
 * something else asks for. This asks for one after every change, once
 * React has committed what the change mounted or unmounted. The garden's
 * copy (backdropCache.tsx) needs nothing more: a change shows in what its
 * signature reads (an object added or gone, a visibility, a uniform), so
 * that frame draws the garden afresh.
 */
export const EnvRedraw = () => {
  const get = useThree((s) => s.get);
  const version = useEnvVersion();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    get().invalidate();
  }, [version, get]);
  return null;
};
