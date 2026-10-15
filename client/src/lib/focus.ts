// Focus the page moves by itself (a page's one action on arrival, a dialog's
// button, the promotion's first piece) without the ring a focused control
// wears for the keyboard, unless the player is finding their way by keyboard.
// Browsers ring any focus a script moves while no pointer has pressed
// anything (on arrival, say), and Chromium ignores `focusVisible: false`; so
// the control focused quietly carries `data-quiet-focus` while it holds the
// focus, the stylesheet keeps its ring off (`:focus-visible:not([data-quiet-focus])`),
// and the first key pressed hands the ring back.

/** Whether the last thing the player pressed was a key rather than a pointer. */
let keyboard = false;

/** Keys pressed alone or with these say nothing of finding one's way (a shortcut, a switch of app). */
const QUIET_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);

function listen() {
  if (typeof document === 'undefined') return;
  document.addEventListener(
    'keydown',
    (e) => {
      if (QUIET_KEYS.has(e.key) || e.metaKey || e.ctrlKey || e.altKey) return;
      keyboard = true;
      document.querySelector('[data-quiet-focus]')?.removeAttribute('data-quiet-focus');
    },
    true,
  );
  document.addEventListener('pointerdown', () => (keyboard = false), true);
}
listen();

/** Focuses `el`, with its ring only for a player using the keyboard. */
export function focusFromCode(el: HTMLElement | null | undefined, options?: FocusOptions): void {
  if (!el) return;
  el.focus(options);
  if (keyboard || document.activeElement !== el) return;
  el.setAttribute('data-quiet-focus', '');
  el.addEventListener('blur', () => el.removeAttribute('data-quiet-focus'), { once: true });
}

/** A ref that focuses its element as it mounts, as `autoFocus` does, but quietly. */
export const autoFocusRef = (el: HTMLElement | null): void => focusFromCode(el);
