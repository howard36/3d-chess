import { describe, expect, it } from 'vitest';
import { act } from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { Celebration, onMatePlayedOut } from './fx';

describe('Celebration', () => {
  it('says the mate has played out once its pulse has crossed the board, on the scene’s clock', async () => {
    let told = 0;
    const stop = onMatePlayedOut(() => told++);
    const r = await ReactThreeTestRenderer.create(<Celebration floor={[0, 0, 0]} />);
    // Frames of 100 ms: the pulse's 2.4 s (the default) is not over after 2 s...
    await act(async () => r.advanceFrames(20, 0.1));
    expect(told).toBe(0);
    // ...and is after 2.6 s, however few frames it took
    await act(async () => r.advanceFrames(6, 0.1));
    expect(told).toBe(1);
    stop();
  });
});
