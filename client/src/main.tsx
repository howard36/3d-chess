import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import './index.css';
import { gameScreen } from './screens/gameScreenChunk';

// A game's address renders its page in the app's first commit: the page's
// chunk (preloaded from the HTML's head alongside the entry) is waited for
// first, as a part that suspended would hold its commit for 300 ms
const start = /^\/game\//.test(location.pathname) ? gameScreen.ready() : Promise.resolve();
void start.then(() =>
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ErrorBoundary>
    </React.StrictMode>,
  ),
);
