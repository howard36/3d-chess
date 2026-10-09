import React from 'react';
import ReactDOM from 'react-dom/client';
import { SculptureViewer } from './SculptureViewer';

// Entry of the dev-only sculpture viewer (client/sculptures.html, served by
// Vite in development, left out of the build). See SculptureViewer.tsx.

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SculptureViewer params={new URLSearchParams(window.location.search)} />
  </React.StrictMode>,
);
