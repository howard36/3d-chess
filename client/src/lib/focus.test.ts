import { afterEach, describe, expect, it } from 'vitest';
import { autoFocusRef, focusFromCode } from './focus';

const button = (name: string) => {
  const el = document.createElement('button');
  el.textContent = name;
  document.body.append(el);
  return el;
};
const press = (key: string, init: KeyboardEventInit = {}) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key, ...init }));
const point = () => document.dispatchEvent(new Event('pointerdown'));

afterEach(() => {
  document.body.replaceChildren();
  point();
});

describe('focus the page moves by itself', () => {
  it('is quiet until the player presses a key', () => {
    const go = button('Join game');
    focusFromCode(go);
    expect(document.activeElement).toBe(go);
    expect(go).toHaveAttribute('data-quiet-focus');
    press('Tab');
    expect(go).not.toHaveAttribute('data-quiet-focus');
  });

  it('wears its ring for a player already using the keyboard', () => {
    press('Enter');
    const go = button('Play again');
    autoFocusRef(go);
    expect(document.activeElement).toBe(go);
    expect(go).not.toHaveAttribute('data-quiet-focus');
  });

  it('is quiet again once a pointer has pressed', () => {
    press('Tab');
    point();
    const go = button('Home');
    focusFromCode(go);
    expect(go).toHaveAttribute('data-quiet-focus');
  });

  it('takes no shortcut or modifier for finding the way by keyboard', () => {
    const go = button('Copy link');
    focusFromCode(go);
    press('Shift');
    press('Tab', { metaKey: true });
    press('r', { ctrlKey: true });
    expect(go).toHaveAttribute('data-quiet-focus');
  });

  it('drops the mark when the focus moves on', () => {
    const go = button('Play here');
    const other = button('Other');
    focusFromCode(go);
    other.focus();
    expect(go).not.toHaveAttribute('data-quiet-focus');
  });

  it('leaves alone what it could not focus', () => {
    const go = button('Gone');
    go.disabled = true;
    focusFromCode(go);
    focusFromCode(null);
    expect(go).not.toHaveAttribute('data-quiet-focus');
  });

  it('keeps the focus where it is on the first Tab, showing it there', () => {
    const go = button('Join game');
    focusFromCode(go);
    const tab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true, bubbles: true });
    go.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(go);
    expect(go).not.toHaveAttribute('data-quiet-focus');
    // The next Tab is the browser's
    const next = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true, bubbles: true });
    go.dispatchEvent(next);
    expect(next.defaultPrevented).toBe(false);
  });

  it("lets the control's focus handler tell a quiet focus from the keyboard's", () => {
    const go = button('White');
    const seen: boolean[] = [];
    go.addEventListener('focus', () => seen.push(go.hasAttribute('data-quiet-focus')));
    focusFromCode(go);
    press('Enter');
    expect(seen).toEqual([true, false]);
  });
});
