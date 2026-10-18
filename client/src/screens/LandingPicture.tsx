import React from 'react';
import {
  pictureSource,
  pictureSourceSet,
  picturePlacement,
  type PicturePlacement,
  type PictureName,
} from '../three/landingLens';
import { EARLY_PICTURE_ID, earlyPicture } from './earlyPicture';

/**
 * The window's size, which the page's box fills (index.css: .landing, 100vw
 * by 100dvh): read while rendering, so the picture is placed in the page's
 * first commit without measuring (a layout forced in the first render held
 * the page's buttons back), and kept as the window changes.
 */
function useWindowSize(): [number, number] {
  const [size, setSize] = React.useState<[number, number]>(() => [
    window.innerWidth,
    window.innerHeight,
  ]);
  React.useEffect(() => {
    const update = () =>
      setSize((was) =>
        was[0] === window.innerWidth && was[1] === window.innerHeight
          ? was
          : [window.innerWidth, window.innerHeight],
      );
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return size;
}

/**
 * The start page's picture of its preview: the opening position from the
 * preview's first angle, exactly as the preview's first frame will draw it
 * (three/landingLens.ts), shown from the page's first render, before
 * three.js has arrived. The preview fades in over it; under reduced motion it
 * is all the page shows. The browser picks the picture as fine as the screen
 * (1x or 2x), and its edges fade into the page's night in the picture itself.
 * Where the built page placed the same picture before the entry ran
 * (earlyPicture.ts), that element becomes this one's, for as long as its
 * file is the one the window asks for.
 */
export function LandingPicture() {
  const [width, height] = useWindowSize();
  const [early] = React.useState(earlyPicture);
  const earlyImg = early?.querySelector('img');
  // The picture on screen, kept while it covers the window (picturePlacement)
  const shown = React.useRef(earlyImg?.dataset.picture as PictureName | undefined);
  const place = width > 0 && height > 0 ? picturePlacement(width, height, shown.current) : null;
  const box = React.useRef<HTMLDivElement>(null);
  const adopt = place !== null && earlyImg?.dataset.picture === place.picture;
  React.useLayoutEffect(() => {
    if (place) shown.current = place.picture;
    if (!early) return;
    if (adopt && early.parentNode !== box.current) box.current!.append(early);
    document.getElementById(EARLY_PICTURE_ID)?.remove();
    if (adopt) Object.assign(earlyImg!.style, placement(place!));
    else early.remove();
  });
  return (
    <div className="landing-picture" aria-hidden="true" data-testid="landing-picture" ref={box}>
      {place && !adopt && (
        <picture>
          <source type="image/avif" srcSet={pictureSourceSet(place.picture, 'avif')} />
          <img
            src={pictureSource(place.picture, 'webp')}
            srcSet={pictureSourceSet(place.picture, 'webp')}
            alt=""
            decoding="async"
            fetchPriority="high"
            data-picture={place.picture}
            style={placement(place)}
          />
        </picture>
      )}
    </div>
  );
}

/**
 * Moved, not laid out, there: a box's position is snapped to the pixel grid,
 * a transform's is not, and the preview's frame is not snapped either.
 */
function placement(place: PicturePlacement) {
  return {
    transform: `translate(${place.left}px, ${place.top}px)`,
    width: `${place.width}px`,
    height: `${place.height}px`,
  };
}
