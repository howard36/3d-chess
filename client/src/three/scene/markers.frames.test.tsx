import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { useThree } from '@react-three/fiber';
import { Quiet } from './markers';

// A mark asks for a frame when what it draws changes, and only then: the
// board renders for things no mark shows (a move on its way to the server,
// the pointer crossing plain cells), and each frame is a whole scene drawn.

describe('a mark', () => {
  it('asks for a frame when it changes, not when its parent renders again', async () => {
    const invalidate = vi.fn();
    const Probe = () => {
      const get = useThree((s) => s.get);
      React.useLayoutEffect(() => {
        get().set({ invalidate });
      }, [get]);
      return null;
    };
    const at = (hovered: boolean) => (
      <>
        <Probe />
        {/* A fresh floor array each render, as Board hands it */}
        <Quiet floor={[1, 0.5, -1]} hovered={hovered} />
      </>
    );
    const r = await ReactThreeTestRenderer.create(at(false));
    invalidate.mockClear();
    await r.update(at(false));
    expect(invalidate).not.toHaveBeenCalled();
    await r.update(at(true));
    expect(invalidate).toHaveBeenCalled();
  });
});
