import { describe, expect, it } from 'vitest';
import { retarget } from './smartLabels';
import type { Slot } from './smartLabels';

const slot = (fades: [number, number], active: 0 | 1, keys: [string, string]): Slot => ({
  key: keys[active],
  active,
  keys,
  positions: [
    [0, 0, 0],
    [1, 0, 0],
  ],
  fades,
});

describe('a label changing anchor', () => {
  it('crossfades: the idle sprite takes the new anchor and fades in', () => {
    const next = retarget(slot([1, 0], 0, ['a', '']), 'b');
    expect(next).toMatchObject({ key: 'b', active: 1, keys: ['a', 'b'], fades: [1, 0] });
  });

  it('keeps the sprite that shows fading out where it stands when the anchor changes again mid-fade', () => {
    // Early in a fade the new sprite is the fainter: it moves on, from nothing
    const early = retarget(slot([0.86, 0.14], 1, ['a', 'b']), 'c');
    expect(early).toMatchObject({ key: 'c', active: 1, keys: ['a', 'c'], fades: [0.86, 0] });
    // Past its middle the old one is: it takes the new anchor instead
    const late = retarget(slot([0.3, 0.7], 1, ['a', 'b']), 'c');
    expect(late).toMatchObject({ key: 'c', active: 0, keys: ['c', 'b'], fades: [0, 0.7] });
  });

  it('fades the old sprite back in, from where it is, when the anchor comes back to it', () => {
    const back = retarget(slot([0.86, 0.14], 1, ['a', 'b']), 'a');
    expect(back).toMatchObject({ key: 'a', active: 0, keys: ['a', 'b'], fades: [0.86, 0.14] });
  });

  it('leaves a label whose anchor holds as it is', () => {
    const s = slot([1, 0], 0, ['a', '']);
    expect(retarget(s, 'a')).toBe(s);
  });
});
