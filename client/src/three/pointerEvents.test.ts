import { describe, expect, it, vi } from 'vitest';

const connect = vi.hoisted(() => vi.fn());
vi.mock('@react-three/fiber', () => ({
  events: () => ({ enabled: true, priority: 1, connect }),
}));

import { pointerEvents } from './pointerEvents';

describe('pointerEvents', () => {
  it("connects r3f's events to an element", () => {
    const div = document.createElement('div');
    const manager = pointerEvents({} as never);
    manager.connect?.(div);
    expect(connect).toHaveBeenCalledWith(div);
    expect(manager.enabled).toBe(true);
  });

  it('connects nothing once the canvas has gone (its container ref is null)', () => {
    connect.mockClear();
    const manager = pointerEvents({} as never);
    expect(() => manager.connect?.(null as unknown as HTMLElement)).not.toThrow();
    expect(connect).not.toHaveBeenCalled();
  });
});
