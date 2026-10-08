// ENV PREVIEW (temporary): rare things in the sky, only while the camera is
// already looking up: a constellation tracing its lines in light, a slow
// satellite, a pair of meteors (a few more after a mate). `often` brings one
// every few seconds of looking up, to review them with.
import { defineEnvFeature } from '../registry';

export const skyEvents = defineEnvFeature({
  id: 'skyEvents',
  label: 'Sky events',
  group: 'Events',
  order: 2,
  options: [
    { id: 'off', label: 'Off' },
    { id: 'on', label: 'On' },
    { id: 'often', label: 'Often' },
  ],
  default: 'on',
});
