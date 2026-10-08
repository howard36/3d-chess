// ENV PREVIEW (temporary): the field of stars. `rich` spends the stars where
// a camera can see them (1°–36° up, none on the never-seen dome above), with
// a real spread of brightness, a few pale colours and a handful of doubles.
import { defineEnvFeature } from '../registry';

export const stars = defineEnvFeature({
  id: 'stars',
  label: 'Stars',
  group: 'Sky',
  order: 1,
  options: [
    { id: 'off', label: 'Today' },
    { id: 'rich', label: 'Rich' },
  ],
  default: 'rich',
});
