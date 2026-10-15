// Focus the page moves by itself (a page's one action on arrival, a dialog's
// button, the promotion's first piece) without the ring a focused control
// wears for the keyboard, unless the player is finding their way by keyboard.
// Browsers ring any focus a script moves while no pointer has pressed
// anything (on arrival, say), and Chromium ignores `focusVisible: false`; so
// the control focused quietly carries `data-quiet-focus` while it holds the
// focus, the stylesheet keeps its ring off (`:focus-visible:not([data-quiet-focus])`),
// and the first key pressed hands the ring back. That first key, if it is a
// Tab, stays on the control instead of moving on: the page's first stop is
// the control it chose, so the first Tab shows where it is.

/** Whether the last thing the player pressed was a key rather than a pointer. */
let keyboard = false;

/** Keys pressed alone or with these say nothing of finding one's way (a shortcut, a switch of app). */
const QUIET_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);

/**
 * The quiet control shows its focus: focused again, so whatever follows its
 * focus (a lit button, a lifted king) sees it as the keyboard's.
 */
function reveal(el: HTMLElement) {
  el.removeAttribute('data-quiet-focus');
  el.blur();
  el.focus({ preventScroll: true });
}

function listen() {
  if (typeof document === 'undefined') return;
  document.addEventListener(
    'keydown',
    (e) => {
      if (QUIET_KEYS.has(e.key) || e.metaKey || e.ctrlKey || e.altKey) return;
      keyboard = true;
      const quiet = document.querySelector<HTMLElement>('[data-quiet-focus]');
      if (!quiet) return;
      if (e.key === 'Tab' && document.activeElement === quiet) e.preventDefault();
      reveal(quiet);
    },
    true,
  );
  document.addEventListener('pointerdown', () => (keyboard = false), true);
}
listen();

/**
 * Focuses `el`, with its ring only for a player using the keyboard. A quiet
 * focus is marked before it lands, so the control's own focus handlers can
 * tell it from the keyboard's.
 */
export function focusFromCode(el: HTMLElement | null | undefined, options?: FocusOptions): void {
  if (!el) return;
  const quiet = !keyboard;
  if (quiet) el.setAttribute('data-quiet-focus', '');
  el.focus(options);
  if (!quiet) return;
  if (document.activeElement !== el) {
    el.removeAttribute('data-quiet-focus');
    return;
  }
  el.addEventListener('blur', () => el.removeAttribute('data-quiet-focus'), { once: true });
}

/** A ref that focuses its element as it mounts, as `autoFocus` does, but quietly. */
export const autoFocusRef = (el: HTMLElement | null): void => focusFromCode(el);
