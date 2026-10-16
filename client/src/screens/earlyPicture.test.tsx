import { render } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { LandingPicture } from './LandingPicture';
import { EARLY_PICTURE_ID, earlyPicture, placeEarlyPicture } from './earlyPicture';

afterEach(() => {
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

/** An element's attributes, its style as the browser reads it. */
const attributes = (el: Element) =>
  Object.fromEntries(
    [...el.attributes].map((a) => [
      a.name,
      a.name === 'style' ? (el as HTMLElement).style.cssText : a.value,
    ]),
  );

test.each([
  [390, 844],
  [820, 1180],
  [1440, 900],
])(
  'at %ix%i the built page places, under the page, the very picture the page shows',
  (width, height) => {
    vi.stubGlobal('innerWidth', width);
    vi.stubGlobal('innerHeight', height);
    document.body.innerHTML = '<div id="root"></div>';
    placeEarlyPicture();
    const early = document.getElementById(EARLY_PICTURE_ID)!;
    expect(early.nextElementSibling?.id).toBe('root');
    const placed = earlyPicture()!;
    placed.remove();
    // The page's own, where nothing was placed early
    const own = render(<LandingPicture />).container.querySelector('picture')!;
    expect(placed.children.length).toBe(own.children.length);
    [...own.children].forEach((child, i) =>
      expect(attributes(placed.children[i])).toEqual(attributes(child)),
    );
  },
);

test('any other page places none', () => {
  document.body.innerHTML = '<div id="root"></div>';
  window.history.replaceState(null, '', '/new');
  placeEarlyPicture();
  expect(document.getElementById(EARLY_PICTURE_ID)).toBeNull();
});
