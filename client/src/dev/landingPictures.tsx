import React from 'react';
import ReactDOM from 'react-dom/client';
import '../index.css';
import { LandingPreview } from '../screens/LandingPreview';
import type { LandingLayout } from '../screens/landingLayout';
import { LANDING_PICTURES } from '../three/landingLens';

// Entry of the dev-only page that draws the start page's pictures of its
// preview (client/landing-pictures.html, served by Vite in development, left
// out of the build): ?layout=phone|tablet|wide draws that layout's picture
// (three/landingLens.ts's LANDING_PICTURES) to fill the window, which
// scripts/landing-pictures.mjs sizes to the picture's pixels.

const layout = (new URLSearchParams(window.location.search).get('layout') ??
  'wide') as LandingLayout;

// The picture's size in pixels, for the script to size the window to
(window as unknown as { __picture: unknown }).__picture = LANDING_PICTURES[layout];

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LandingPreview picture={layout} />
  </React.StrictMode>,
);
