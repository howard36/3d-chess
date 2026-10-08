// ENV PREVIEW (temporary): the chess constellations. `crafted` draws today's
// eight as a star chart does (lines whole from star to star, one
// brighter star each, quieter toward the base).
import { defineEnvFeature } from '../registry';

export const constellations = defineEnvFeature({
  id: 'constellations',
  label: 'Constellations',
  group: 'Constellations',
  order: 1,
  options: [
    { id: 'off', label: "Today's eight" },
    { id: 'crafted', label: 'Crafted' },
  ],
  default: 'crafted',
});
