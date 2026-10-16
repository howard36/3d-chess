import { picturePlacement, pictureSource, pictureSourceSet } from '../three/landingLens';

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

export function placeEarlyPicture(): void {
  const root = document.getElementById('root');
  const [width, height] = [innerWidth, innerHeight];
  if (location.pathname !== '/' || !root || !(width > 0 && height > 0)) return;
  const place = picturePlacement(width, height);
  if (place.layout !== 'phone') return;
  const picture = document.createElement('div');
  picture.id = EARLY_PICTURE_ID;
  picture.className = 'landing-picture';
  picture.setAttribute('aria-hidden', 'true');
  picture.innerHTML =
    `<picture><source type="image/avif" srcset="${pictureSourceSet(place.layout, 'avif')}">` +
    `<img src="${pictureSource(place.layout, 'webp')}" srcset="${pictureSourceSet(place.layout, 'webp')}" ` +
    `alt="" decoding="async" fetchpriority="high" data-layout="${place.layout}" ` +
    `style="transform: translate(${place.left}px, ${place.top}px); ` +
    `width: ${place.width}px; height: ${place.height}px"></picture>`;
  document.body.insertBefore(picture, root);
}

/** The early picture's <picture>, if the built page placed one. */
export function earlyPicture(): HTMLPictureElement | null {
  return document.getElementById(EARLY_PICTURE_ID)?.querySelector('picture') ?? null;
}
