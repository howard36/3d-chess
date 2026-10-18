import { LANDING_BANDS, landingLayoutOf } from '../screens/landingLayout';
import type { LandingLayout } from '../screens/landingLayout';

// The start page's preview, framed by its lens rather than its distance.
//
// The game's fit (cameraFit.ts) sizes the tower by moving the camera nearer
// or farther, which changes the perspective with the window. The start page
// instead holds the camera at one distance for each of its layouts and
// zooms the lens: a zoom scales the picture evenly and changes nothing else,
// so every window of a layout sees a scaled crop of one picture of the scene.
// That is what lets the page show a picture of the preview (LANDING_PICTURES,
// rendered by scripts/landing-pictures.mjs) the moment it loads and hand over
// to the live scene without a pixel moving.
//
// Plain arithmetic, nothing from three.js: the start page is the entry, and it
// places the picture with this before three.js has arrived. The numbers are
// the game's fit's own, baked (landingLens.test.ts recomputes them, and fails
// when the tower's rings, the opening view or the bands change: then bake
// them again and re-render the pictures).

/** A layout's camera: its distance from the tower's centre, and where the tower's rings fall in its view from there (tangents of the angle off its axis). */
interface LayoutCamera {
  distance: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Each layout's distance is the game's fit at a window of that layout
 * (390x700, a phone's browser with its bars showing; 820x1180; 1440x900),
 * so those windows see exactly what the fit would show; the rings' bounds are cameraFit's ringBounds from there.
 */
export const LANDING_CAMERAS: Record<LandingLayout, LayoutCamera> = {
  phone: {
    distance: 29.21241184167602,
    right: 0.1297137639794556,
    top: 0.13378515371536917,
    bottom: -0.15642339347235645,
  },
  tablet: {
    distance: 18.182472472919873,
    right: 0.21503966982323094,
    top: 0.2067641616915484,
    bottom: -0.2645780974664346,
  },
  wide: {
    distance: 14.76658119652773,
    right: 0.2709322757837362,
    top: 0.24921850758410743,
    bottom: -0.336668436734276,
  },
};

/** The room the fit leaves round the tower (cameraFit.ts's FRAME_MARGIN). */
const FRAME_MARGIN = 1.05;
/** The most of the window's height the bands may take together (cameraFit.ts's MOST_BANDS). */
const MOST_BANDS = 0.75;

/** The preview's camera for a window: its distance, vertical field of view (degrees) and lens shift (tangents, x right, y up). */
interface LandingLens {
  layout: LandingLayout;
  distance: number;
  fov: number;
  shift: [number, number];
}

/**
 * The lens that frames the tower in a `width` x `height` window (CSS px) as
 * cameraFit's fitView would with centre 'rings' (the rings centred in the room
 * the bands leave, with FRAME_MARGIN on the tighter axis), from the layout's
 * distance: the field of view the fit's distance would have needed, solved for
 * directly.
 */
export function landingLens(width: number, height: number): LandingLens {
  const layout = landingLayoutOf(width, height);
  const { distance, right, top, bottom } = LANDING_CAMERAS[layout];
  const band = Math.min(LANDING_BANDS.top(height, width) / height, 0.5);
  const below = Math.min(
    LANDING_BANDS.bottom(height, width) / height,
    Math.max(0, MOST_BANDS - band),
  );
  const left = Math.min(LANDING_BANDS.left(width, height) / width, 0.5);
  const tanV = Math.max(
    (right * FRAME_MARGIN) / ((width / height) * (1 - left)),
    ((top - bottom) * FRAME_MARGIN) / (2 * (1 - band - below)),
  );
  const tanH = (tanV * width) / height;
  return {
    layout,
    distance,
    fov: (2 * Math.atan(tanV) * 180) / Math.PI,
    // The rings centred across in the room right of the left band, and
    // between the top and bottom bands
    shift: [-tanH * left, (top + bottom) / 2 + tanV * (band - below)],
  };
}

/** The screens a picture is drawn for: 1x, and 2x for any finer (the canvas draws at most twice as fine: three/pixelBudget.ts). */
export type PictureDensity = '1x' | '2x';
const PICTURE_DENSITIES: readonly PictureDensity[] = ['1x', '2x'];

/**
 * A picture of the preview's first frame: the scene as its layout's camera
 * sees it, `centre` and `span` (the tangents of the picture's middle and of
 * its full height) and `aspect` (its width over its height) taking in the
 * windows it is for, and a little more, which fades into the night at its
 * edges (PICTURE_FADE, drawn into the picture). Each in two sizes in pixels:
 * as fine as the preview's canvas draws on a screen of that density in the
 * layout's common windows (2x: the pixel budget's), and the browser picks one
 * by the screen's.
 */
export interface LandingPicture {
  layout: LandingLayout;
  centre: [number, number];
  span: number;
  aspect: number;
  pixels: Record<PictureDensity, [number, number]>;
}

/**
 * The pictures, a layout's smallest first: a window takes the first of its
 * layout's that it lies inside with the faded edges outside it
 * (picturePlacement), so a phone decodes only about the part it shows. The
 * last of each layout takes in every common window of the layout, phones'
 * with their browser's bars too (landingLens.test.ts lists them); a phone's
 * cut, as fine, takes in the taller ones (all but the smallest phones).
 */
export const LANDING_PICTURES = {
  'phone-tall': {
    layout: 'phone',
    centre: [0, -0.0341],
    span: 0.66234,
    aspect: 0.503095,
    pixels: { '1x': [534, 1060], '2x': [1052, 2092] },
  },
  phone: {
    layout: 'phone',
    centre: [0, -0.0586],
    span: 1.0041,
    aspect: 0.678161,
    pixels: { '1x': [1090, 1606], '2x': [2152, 3172] },
  },
  tablet: {
    layout: 'tablet',
    centre: [0, -0.1145],
    span: 0.825,
    aspect: 0.959307,
    pixels: { '1x': [1662, 1732], '2x': [2976, 3102] },
  },
  wide: {
    layout: 'wide',
    centre: [-0.2364, -0.0437],
    span: 0.7834,
    aspect: 2.402402,
    pixels: { '1x': [3200, 1332], '2x': [4892, 2036] },
  },
} satisfies Record<string, LandingPicture>;
export type PictureName = keyof typeof LANDING_PICTURES;
const PICTURE_NAMES = Object.keys(LANDING_PICTURES) as PictureName[];

declare const __LANDING_VERSION__: string | undefined;
/** The built page asks for the pictures by their version, which the host keeps a year (vite.config.ts, versionLandingPictures). */
const VERSION = typeof __LANDING_VERSION__ === 'string' ? `?v=${__LANDING_VERSION__}` : '';

/**
 * The address of a picture (public/landing/, written by
 * scripts/landing-pictures.mjs): AVIF, and WebP for a browser without it,
 * each at both densities.
 */
export const pictureSource = (
  picture: PictureName,
  type: 'avif' | 'webp',
  density: PictureDensity = '1x',
) => `/landing/${picture}${density === '1x' ? '' : '@2x'}.${type}${VERSION}`;

/** A `srcset` of a picture at every density. */
export const pictureSourceSet = (picture: PictureName, type: 'avif' | 'webp') =>
  PICTURE_DENSITIES.map((d) => `${pictureSource(picture, type, d)} ${d}`).join(', ');

/**
 * The share of a picture's width and height, at each edge, that fades into
 * the night (drawn into the picture), so a window wider or taller than the
 * common ones sees the picture end softly; every common window lies inside
 * the fade.
 */
export const PICTURE_FADE = 0.03;

/** Which picture a window shows, and where it lies in it, in CSS px from its top left corner. */
export interface PicturePlacement {
  layout: LandingLayout;
  picture: PictureName;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Which picture a `width` x `height` window shows (the first of its layout's
 * that covers it, faded edges and all, or else the layout's last), and where
 * it goes so that it shows exactly what the preview's first frame will:
 * scaled by the window's lens (CSS px per tangent) and moved by its shift.
 * The picture already `shown` stays while it still covers the window, so a
 * phone's bars coming and going never fetch the other picture.
 */
export function picturePlacement(
  width: number,
  height: number,
  shown?: PictureName,
): PicturePlacement {
  const lens = landingLens(width, height);
  const perTangent = height / (2 * Math.tan((lens.fov * Math.PI) / 360));
  const place = (name: PictureName): PicturePlacement => {
    const picture = LANDING_PICTURES[name];
    const spanAcross = picture.span * picture.aspect;
    return {
      layout: lens.layout,
      picture: name,
      left: width / 2 + (picture.centre[0] - spanAcross / 2 - lens.shift[0]) * perTangent,
      top: height / 2 - (picture.centre[1] + picture.span / 2 - lens.shift[1]) * perTangent,
      width: spanAcross * perTangent,
      height: picture.span * perTangent,
    };
  };
  const names = PICTURE_NAMES.filter((name) => LANDING_PICTURES[name].layout === lens.layout);
  if (shown && names.includes(shown)) {
    const kept = place(shown);
    if (covers(kept, width, height)) return kept;
  }
  const placed = names.map(place);
  return placed.find((p) => covers(p, width, height)) ?? placed[placed.length - 1];
}

/** Whether a placed picture covers the whole window with its faded edges outside it. */
export const covers = (p: PicturePlacement, width: number, height: number): boolean => {
  const [fx, fy] = [p.width * PICTURE_FADE, p.height * PICTURE_FADE];
  return (
    p.left + fx <= 0 &&
    p.top + fy <= 0 &&
    p.left + p.width - fx >= width &&
    p.top + p.height - fy >= height
  );
};
