import React from 'react';
import ReactDOM from 'react-dom/client';
import { loadPieceData } from '../three/pieces/pieceData';
import { PieceGallery } from './PieceGallery';

// Entry of the dev-only piece gallery (client/pieces.html, served by Vite in
// development, left out of the build). See PieceGallery.tsx for its options.

void loadPieceData().then(() =>
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <PieceGallery params={new URLSearchParams(window.location.search)} />
    </React.StrictMode>,
  ),
);
