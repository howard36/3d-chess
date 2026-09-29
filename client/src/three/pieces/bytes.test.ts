import { describe, expect, it } from 'vitest';
import { fromStoredText, toStoredText } from './bytes';

describe('stored bytes', () => {
  it('come back exactly, whatever their length', () => {
    for (const length of [0, 1, 3, 4, 5, 8, 1001]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 97 + 13) & 255);
      expect(fromStoredText(toStoredText(bytes))).toEqual(bytes);
    }
  });
});
