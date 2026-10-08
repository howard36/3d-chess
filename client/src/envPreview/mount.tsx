// ENV PREVIEW (temporary): puts the settings menu on the page, in a root of
// its own after the app's (so it is never the first Tab stop), loaded only
// when the gate says so (main.tsx).

import { createRoot } from 'react-dom/client';
import { EnvPanel } from './EnvPanel';

export function mountEnvPanel() {
  if (document.getElementById('env-preview')) return;
  const host = document.createElement('div');
  host.id = 'env-preview';
  document.body.appendChild(host);
  createRoot(host).render(<EnvPanel />);
}
