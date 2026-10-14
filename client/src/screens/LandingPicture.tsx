import React from 'react';
import { PICTURE_FADE, pictureSource, picturePlacement } from '../three/landingLens';

/** Fades the picture's outermost PICTURE_FADE into the night on every side (a window past the common ones). */
const edge = `${PICTURE_FADE * 100}%`;
const FADE = [
  `linear-gradient(to right, transparent, #000 ${edge}, #000 calc(100% - ${edge}), transparent)`,
  `linear-gradient(to bottom, transparent, #000 ${edge}, #000 calc(100% - ${edge}), transparent)`,
].join(', ');

/**
 * The start page's picture of its preview: the opening position from the
 * preview's first angle, exactly as the preview's first frame will draw it
 * (three/landingLens.ts), shown from the page's first render, before
 * three.js has arrived. The preview fades in over it; under reduced motion it
 * is all the page shows. Sized to the box it fills, as the preview's canvas
 * is (the same box), measured before the first paint.
 */
export function LandingPicture() {
  const box = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState<[number, number] | null>(null);
  React.useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setSize((was) => (was && was[0] === width && was[1] === height ? was : [width, height]));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const place = size && size[0] > 0 && size[1] > 0 ? picturePlacement(size[0], size[1]) : null;
  return (
    <div ref={box} className="landing-picture" aria-hidden="true" data-testid="landing-picture">
      {place && (
        <picture>
          <source type="image/avif" srcSet={pictureSource(place.layout, 'avif')} />
          <img
            src={pictureSource(place.layout, 'webp')}
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
              maskImage: FADE,
              WebkitMaskImage: FADE,
              maskComposite: 'intersect',
              WebkitMaskComposite: 'source-in',
            }}
          />
        </picture>
      )}
    </div>
  );
}
