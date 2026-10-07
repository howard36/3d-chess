import { describe, expect, it } from 'vitest';
import { focusLevelOf } from './focus';

describe('focusLevelOf', () => {
  it('is the hovered level while the pointer is on the board', () => {
    expect(focusLevelOf({ selected: 1, hovered: 3 })).toBe(3);
    expect(focusLevelOf({ selected: null, hovered: 0 })).toBe(0);
  });

  it("is never the selected piece's own level: its moves elsewhere are as much in play", () => {
    expect(focusLevelOf({ selected: 1, hovered: null })).toBeNull();
    expect(focusLevelOf({ selected: 0, hovered: null })).toBeNull();
  });

  it('is none with nothing hovered or selected, or no focus at all', () => {
    expect(focusLevelOf({ selected: null, hovered: null })).toBeNull();
    expect(focusLevelOf(undefined)).toBeNull();
    expect(focusLevelOf(null)).toBeNull();
  });
});
