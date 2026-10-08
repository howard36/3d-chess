// ENV PREVIEW (temporary): a Milky Way rising steeply out of the horizon
// on two sides of the sky: a soft glow split by a dark lane, and a dust of
// faint stars gathered in it.
import { defineEnvFeature } from '../registry';

export const milkyWay = defineEnvFeature({
  id: 'milkyWay',
  label: 'Milky Way',
  group: 'Sky',
  order: 2,
  options: [
    { id: 'off', label: 'Off' },
    { id: 'faint', label: 'Faint' },
    { id: 'clear', label: 'Clear' },
  ],
  default: 'faint',
});
