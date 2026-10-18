import { render } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { LandingPicture } from './LandingPicture';
import { picturePlacement } from '../three/landingLens';
import {
  EARLY_PICTURE_ID,
  earlyPicture,
  placeEarlyPicture,
  preloadLandingPicture,
} from './earlyPicture';

afterEach(() => {
  document.body.innerHTML = '';
  document.head.querySelectorAll('link[rel="preload"]').forEach((l) => l.remove());
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
  [360, 640],
  [430, 932],
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

test.each([
  [820, 1180],
  [1440, 900],
  [844, 390],
])('a %ix%i window, not the phone layout, places none', (width, height) => {
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('innerHeight', height);
  document.body.innerHTML = '<div id="root"></div>';
  placeEarlyPicture();
  expect(document.getElementById(EARLY_PICTURE_ID)).toBeNull();
});

test('the body places the picture the head preloaded, while it still covers the window', () => {
  // A phone's bars coming or going between the two scripts: the head chose
  // the phone's cut, and the body's window, taller, would choose the tall one
  const width = 390;
  const heights = Array.from({ length: 700 }, (_, i) => 400 + i);
  const head = heights.find((h) => picturePlacement(width, h).picture === 'phone');
  const body = heights.find(
    (h) =>
      picturePlacement(width, h).picture === 'phone-tall' &&
      picturePlacement(width, h, 'phone').picture === 'phone',
  );
  expect(head && body).toBeTruthy();
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('innerHeight', head);
  preloadLandingPicture();
  vi.stubGlobal('innerHeight', body);
  document.body.innerHTML = '<div id="root"></div>';
  placeEarlyPicture();
  const link = document.head.querySelector('link[rel="preload"]')!;
  expect(earlyPicture()!.querySelector('source')!.getAttribute('srcset')).toBe(
    link.getAttribute('imagesrcset'),
  );
});

test('any other page places none', () => {
  document.body.innerHTML = '<div id="root"></div>';
  window.history.replaceState(null, '', '/new');
  placeEarlyPicture();
  expect(document.getElementById(EARLY_PICTURE_ID)).toBeNull();
});

/** The preload the built page's head makes in a window this size. */
const preload = (width: number, height: number) => {
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('innerHeight', height);
  preloadLandingPicture();
  return [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"]')];
};

test('the start page preloads, in any window, the very picture its page shows', () => {
  for (let w = 300; w <= 2000; w += 37) {
    for (const h of [
      w - 1,
      w,
      w + 1,
      Math.round(w * 0.6),
      Math.round(w * 1.8),
      Math.round(w * 2.1),
    ]) {
      const links = preload(w, h);
      expect(links).toHaveLength(1);
      expect(links[0].getAttribute('as')).toBe('image');
      expect(links[0].getAttribute('type')).toBe('image/avif');
      const { container, unmount } = render(<LandingPicture />);
      expect(links[0].getAttribute('imagesrcset')).toBe(
        container.querySelector('source')!.getAttribute('srcset'),
      );
      expect(links[0].getAttribute('href')).toContain(`/${picturePlacement(w, h).picture}.avif`);
      links[0].remove();
      unmount();
    }
  }
});

test('no other page preloads it', () => {
  window.history.replaceState(null, '', '/new');
  expect(preload(390, 844)).toHaveLength(0);
});
