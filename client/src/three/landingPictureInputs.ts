import { LANDING_CAMERAS, LANDING_PICTURES, PICTURE_FADE } from './landingLens';
import { LANDING_VIEW } from './landingView';

/**
 * The numbers the start page's pictures are rendered at: each layout's
 * camera, the pictures' cuts and sizes, their fade and the preview's opening
 * view. scripts/landing-pictures.mjs writes them, as it renders every
 * picture, to landingPictures.json beside this, and landingLens.test.ts
 * fails while they differ: a lens baked anew with the pictures left as they
 * were shows as a jump where the live preview takes over. (What the scene
 * itself draws, the pieces and the garden, is still the rerun's to remember:
 * CLAUDE.md.) Dev only: nothing the app loads imports it.
 */
export const landingPictureInputs = () =>
  JSON.parse(
    JSON.stringify({
      cameras: LANDING_CAMERAS,
      pictures: LANDING_PICTURES,
      fade: PICTURE_FADE,
      view: LANDING_VIEW,
    }),
  );
