import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { glassRim, turningRim } from './turningRim';

// A control of a size (jsdom lays nothing out) and a clock of frames stepped by hand
// (by id, so cancelling a frame other than the one asked for leaves it due)
let frames = new Map<number, FrameRequestCallback>();
let ids = 0;
let now = 0;
const tick = (ms: number) => {
  now += ms;
  const due = [...frames.values()];
  frames = new Map();
  due.forEach((f) => f(now));
};
const control = (width: number, height: number, radius: string) => {
  const el = document.createElement('button');
  Object.defineProperty(el, 'offsetWidth', { value: width });
  Object.defineProperty(el, 'offsetHeight', { value: height });
  el.style.borderRadius = radius;
  document.body.append(el);
  return el;
};
const rim = (el: HTMLElement) => el.style.getPropertyValue('--landing-rim');
// The observers' first reports, which a browser gives after its layout and
// before its paint
let observed: (() => void)[] = [];
const layout = () => {
  const due = observed;
  observed = [];
  due.forEach((f) => f());
};
class Observer {
  constructor(private report: () => void) {}
  observe() {
    observed.push(this.report);
  }
  disconnect() {}
}

beforeEach(() => {
  frames = new Map();
  now = 0;
  observed = [];
  vi.stubGlobal('ResizeObserver', Observer);
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => {
    frames.set(++ids, f);
    return ids;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('a turning rim', () => {
  it('rests until the pointer comes, turns while it stays, and rests again', () => {
    const el = control(165, 116, '14px');
    const done = glassRim((_, pointed) => pointed)(el)!;
    layout();
    const rest = rim(el);
    expect(rest).toMatch(/^conic-gradient\(/);
    expect(frames.size).toBe(0);
    tick(16);
    expect(rim(el)).toBe(rest);

    el.dispatchEvent(new Event('pointerenter'));
    tick(16);
    tick(1000);
    expect(rim(el)).not.toBe(rest);

    el.dispatchEvent(new Event('pointerleave'));
    expect(rim(el)).toBe(rest);
    expect(frames.size).toBe(0);
    done();
    expect(rim(el)).toBe('');
  });

  it('stops turning when it detaches mid-turn', () => {
    const el = control(240, 52, '999px');
    const done = turningRim({ turning: () => true, lapMs: () => 1000, sky: 270, inset: 1 })(el)!;
    layout();
    tick(16);
    tick(16);
    expect(frames.size).toBe(1);
    done();
    expect(frames.size).toBe(0);
  });

  it('follows a state the page marks on the control', async () => {
    const el = control(146, 46, '14px');
    glassRim((c) => c.hasAttribute('data-hover'))(el);
    layout();
    const rest = rim(el);
    el.setAttribute('data-hover', '');
    await Promise.resolve();
    tick(16);
    tick(500);
    expect(rim(el)).not.toBe(rest);
    el.removeAttribute('data-hover');
    await Promise.resolve();
    expect(rim(el)).toBe(rest);
  });

  it('keeps one pace: a lap in its time, a stalled frame not jumping it', () => {
    const pill = () => {
      const el = control(240, 52, '999px');
      turningRim({ turning: () => true, lapMs: () => 1024, sky: 270, inset: 1 })(el);
      layout();
      tick(16);
      return el;
    };
    const run = (ms: number) => {
      for (let t = 0; t < ms; t += 16) tick(16);
    };
    const el = pill();
    const rest = rim(el);
    run(512);
    expect(rim(el)).not.toBe(rest);
    run(512);
    expect(rim(el)).toBe(rest);
    // A background tab's minute-long gap moves it on only half a second;
    // a slow frame, a third of one, all of it
    tick(60_000);
    const stalled = rim(el);
    el.remove();
    const other = pill();
    tick(500);
    expect(rim(other)).toBe(stalled);
    tick(332);
    const slow = rim(other);
    other.remove();
    const third = pill();
    run(832);
    expect(rim(third)).toBe(slow);
  });

  it('stands still for a player who asked for less motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const el = control(240, 52, '999px');
    turningRim({ turning: () => true, lapMs: () => 1000, sky: 270, inset: 1 })(el);
    layout();
    expect(rim(el)).toMatch(/^conic-gradient\(/);
    expect(frames.size).toBe(0);
  });

  it("reads no layout as it attaches (in React's commit), only once the page is laid out", () => {
    let reads = 0;
    const el = document.createElement('button');
    Object.defineProperty(el, 'offsetWidth', { get: () => (reads++, 165) });
    Object.defineProperty(el, 'offsetHeight', { get: () => (reads++, 116) });
    el.style.borderRadius = '14px';
    document.body.append(el);
    // Its style too, which a layout brings up to date as much as a size does
    const style = vi.spyOn(window, 'getComputedStyle');
    glassRim(() => false)(el);
    expect(reads).toBe(0);
    expect(style).not.toHaveBeenCalled();
    expect(rim(el)).toBe('');
    layout();
    expect(reads).toBe(2);
    expect(style).toHaveBeenCalledTimes(1);
    style.mockRestore();
    expect(rim(el)).toMatch(/^conic-gradient\(/);
    // Without an observer it measures at once
    vi.stubGlobal('ResizeObserver', undefined);
    const bare = control(165, 116, '14px');
    glassRim(() => false)(bare);
    expect(rim(bare)).toBe(rim(el));
  });

  it('paints nothing for a control not yet laid out', () => {
    const el = document.createElement('button');
    turningRim({ turning: () => false, lapMs: () => 1000, sky: 270, inset: 1 })(el);
    layout();
    expect(rim(el)).toBe('');
    expect(turningRim({ turning: () => true, lapMs: () => 1, sky: 0, inset: 0 })(null)).toBe(
      undefined,
    );
  });
});
