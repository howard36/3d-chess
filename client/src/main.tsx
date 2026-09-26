import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';
import { DesignChoiceProvider } from './three/designs/context.tsx';

// Apply base styles to body using TailwindCSS
document.body.className =
  'min-h-screen bg-gray-900 text-white font-sans antialiased overflow-hidden';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <DesignChoiceProvider>
          <App />
        </DesignChoiceProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
