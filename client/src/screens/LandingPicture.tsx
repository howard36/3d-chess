import React from 'react';
import { pictureSource, pictureSourceSet, picturePlacement } from '../three/landingLens';

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
 */
export function LandingPicture() {
  const [width, height] = useWindowSize();
  const place = width > 0 && height > 0 ? picturePlacement(width, height) : null;
  return (
    <div className="landing-picture" aria-hidden="true" data-testid="landing-picture">
      {place && (
        <picture>
          <source type="image/avif" srcSet={pictureSourceSet(place.layout, 'avif')} />
          <img
            src={pictureSource(place.layout, 'webp')}
            srcSet={pictureSourceSet(place.layout, 'webp')}
            alt=""
            decoding="async"
            fetchPriority="high"
            data-layout={place.layout}
            style={{
              // Moved, not laid out, there: a box's position is snapped to the
              // pixel grid, a transform's is not, and the preview's frame is
              // not snapped either
              transform: `translate(${place.left}px, ${place.top}px)`,
              width: place.width,
              height: place.height,
            }}
          />
        </picture>
      )}
    </div>
  );
}
