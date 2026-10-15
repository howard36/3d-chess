import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { glassRim, turningRim } from './turningRim';

// A control of a size (jsdom lays nothing out) and a clock of frames stepped by hand
let frames: FrameRequestCallback[] = [];
let now = 0;
const tick = (ms: number) => {
  now += ms;
  const due = frames;
  frames = [];
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

beforeEach(() => {
  frames = [];
  now = 0;
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => frames.push(f));
  vi.stubGlobal('cancelAnimationFrame', () => (frames = []));
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('a turning rim', () => {
  it('rests until the pointer comes, turns while it stays, and rests again', () => {
    const el = control(165, 116, '14px');
    const done = glassRim((_, pointed) => pointed)(el)!;
    const rest = rim(el);
    expect(rest).toMatch(/^conic-gradient\(/);
    tick(16);
    expect(rim(el)).toBe(rest);

    el.dispatchEvent(new Event('pointerenter'));
    tick(16);
    tick(1000);
    expect(rim(el)).not.toBe(rest);

    el.dispatchEvent(new Event('pointerleave'));
    expect(rim(el)).toBe(rest);
    expect(frames).toHaveLength(0);
    done();
    expect(rim(el)).toBe('');
  });

  it('follows a state the page marks on the control', async () => {
    const el = control(146, 46, '14px');
    glassRim((c) => c.hasAttribute('data-hover'))(el);
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
    expect(rim(el)).toMatch(/^conic-gradient\(/);
    expect(frames).toHaveLength(0);
  });

  it('paints nothing for a control not yet laid out', () => {
    const el = document.createElement('button');
    turningRim({ turning: () => false, lapMs: () => 1000, sky: 270, inset: 1 })(el);
    expect(rim(el)).toBe('');
    expect(turningRim({ turning: () => true, lapMs: () => 1, sky: 0, inset: 0 })(null)).toBe(
      undefined,
    );
  });
});
