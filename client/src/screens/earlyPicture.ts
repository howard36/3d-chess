import { picturePlacement, pictureSource, pictureSourceSet } from '../three/landingLens';
import type { PictureName } from '../three/landingLens';

/**
 * The start page's picture, placed from an inline script in the built page's
 * body (vite.config.ts) before the entry has loaded and run: on a phone's
 * network the picture arrives well before the entry, and the browser paints
 * it at once instead of after React's first render. LandingPicture takes the
 * very element in as its own in its first commit, before that commit is
 * painted, so nothing is fetched, decoded or swapped twice. On the phone
 * layout alone: a phone's board shows sooner for a page usable a little later,
 * a trade taken on purpose; on a desktop it measured a slower first click.
 */
export const EARLY_PICTURE_ID = 'landing-early';

/**
 * Starts the picture the window shows (its AVIF, as fine as the screen)
 * downloading, from an inline script in the built page's head, before the
 * stylesheet and the entry have loaded (vite.config.ts, bundled with the lens
 * as the early picture is). Only on the start page, in every layout.
 */
export function preloadLandingPicture(): void {
  const [width, height] = [innerWidth, innerHeight];
  if (location.pathname !== '/' || !(width > 0 && height > 0)) return;
  const { picture } = picturePlacement(width, height);
  const link = document.createElement('link');
  link.rel = 'preload';
  link.setAttribute('as', 'image');
  link.type = 'image/avif';
  link.href = pictureSource(picture, 'avif');
  link.setAttribute('imagesrcset', pictureSourceSet(picture, 'avif'));
  link.setAttribute('fetchpriority', 'high');
  link.dataset.picture = picture;
  document.head.appendChild(link);
}

export function placeEarlyPicture(): void {
  const root = document.getElementById('root');
  const [width, height] = [innerWidth, innerHeight];
  if (location.pathname !== '/' || !root || !(width > 0 && height > 0)) return;
  // The head's choice stays while it covers the window (a phone's bars may
  // have come or gone since), so one picture is fetched, not two
  const preloaded = document.querySelector<HTMLElement>('link[data-picture]')?.dataset.picture;
  const place = picturePlacement(width, height, preloaded as PictureName | undefined);
  if (place.layout !== 'phone') return;
  const picture = document.createElement('div');
  picture.id = EARLY_PICTURE_ID;
  picture.className = 'landing-picture';
  picture.setAttribute('aria-hidden', 'true');
  picture.innerHTML =
    `<picture><source type="image/avif" srcset="${pictureSourceSet(place.picture, 'avif')}">` +
    `<img src="${pictureSource(place.picture, 'webp')}" srcset="${pictureSourceSet(place.picture, 'webp')}" ` +
    `alt="" decoding="async" fetchpriority="high" data-picture="${place.picture}" ` +
    `style="transform: translate(${place.left}px, ${place.top}px); ` +
    `width: ${place.width}px; height: ${place.height}px"></picture>`;
  document.body.insertBefore(picture, root);
}

/** The early picture's <picture>, if the built page placed one. */
export function earlyPicture(): HTMLPictureElement | null {
  return document.getElementById(EARLY_PICTURE_ID)?.querySelector('picture') ?? null;
}
