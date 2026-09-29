import { describe, expect, it, vi } from 'vitest';
import { cachedImport } from './cachedImport';

describe('cachedImport', () => {
  it('loads once for every caller', async () => {
    const load = vi.fn(() => Promise.resolve('chunk'));
    const get = cachedImport(load);
    expect(await Promise.all([get(), get()])).toEqual(['chunk', 'chunk']);
    await get();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('asks again after a failed load', async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('chunk');
    const get = cachedImport(load);
    await expect(get()).rejects.toThrow('offline');
    expect(await get()).toBe('chunk');
    expect(load).toHaveBeenCalledTimes(2);
  });
});
