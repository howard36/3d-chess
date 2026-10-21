import React from 'react';
import ReactDOM from 'react-dom/client';
import '../index.css';
import { LandingPreview } from '../screens/LandingPreview';
import { loadPieceData } from '../three/pieces/pieceData';
import { LANDING_PICTURES, PICTURE_FADE } from '../three/landingLens';
import type { PictureDensity, PictureName } from '../three/landingLens';
import { PALETTE } from '../three/scene/palette';

// Entry of the dev-only page that draws the start page's pictures of its
// preview (client/landing-pictures.html, served by Vite in development, left
// out of the build): ?picture=phone-tall|phone|tablet|wide&density=1x|2x draws
// that picture (three/landingLens.ts's LANDING_PICTURES) to fill the
// window, which scripts/landing-pictures.mjs sizes to the picture's pixels,
// its edges faded into the page's night (PICTURE_FADE) as the page shows it.

const params = new URLSearchParams(window.location.search);
const picture = (params.get('picture') ?? 'wide') as PictureName;
const density = (params.get('density') ?? '1x') as PictureDensity;

// The picture's size in pixels, for the script to size the window to
const [width, height] = LANDING_PICTURES[picture].pixels[density];
(window as unknown as { __picture: unknown }).__picture = { width, height };

const NIGHT = PALETTE.skyTop;
document.body.style.background = NIGHT;
const edge = `${PICTURE_FADE * 100}%`;
const fade = (to: string) =>
  `linear-gradient(to ${to}, ${NIGHT}, transparent ${edge}, transparent calc(100% - ${edge}), ${NIGHT})`;

// (the preview draws the whole set, so the set's data loads first, as the
// start page's own preview loader does)
void loadPieceData().then(() =>
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <LandingPreview picture={picture} />
      <div style={{ position: 'absolute', inset: 0, background: fade('right') }} />
      <div style={{ position: 'absolute', inset: 0, background: fade('bottom') }} />
    </React.StrictMode>,
  ),
);
