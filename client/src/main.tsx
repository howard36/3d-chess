import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import './index.css';
// ENV PREVIEW (temporary): the settings menu, on preview deploys and with ?env / ?envpanel
import { envPanelOn } from './envPreview/gate';

// Apply base styles to body using TailwindCSS
document.body.className =
  'min-h-screen bg-gray-900 text-white font-sans antialiased overflow-hidden';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);

// ENV PREVIEW (temporary): loaded only when the gate says so; nothing otherwise
if (envPanelOn())
  import('./envPreview/mount').then(
    (m) => m.mountEnvPanel(),
    () => {},
  );
