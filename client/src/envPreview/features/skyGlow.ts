// ENV PREVIEW (temporary): the sky's air: a faint airglow low down and
// banks of mist along the horizon that can actually be seen (today's are
// imperceptible).
import { defineEnvFeature } from '../registry';

export const skyGlow = defineEnvFeature({
  id: 'skyGlow',
  label: 'Airglow and mist banks',
  group: 'Sky',
  order: 3,
  options: [
    { id: 'off', label: 'Today' },
    { id: 'on', label: 'On' },
  ],
  default: 'on',
});
