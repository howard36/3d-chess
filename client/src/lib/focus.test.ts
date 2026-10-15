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
});
