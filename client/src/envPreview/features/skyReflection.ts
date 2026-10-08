// ENV PREVIEW (temporary): the constellations and the brighter stars given
// back, upside down and softened, by the polished stone: the one way the sky
// reaches the opening view.
import { defineEnvFeature } from '../registry';

export const skyReflection = defineEnvFeature({
  id: 'skyReflection',
  label: 'Stars in the stone',
  group: 'Sky',
  order: 4,
  options: [
    { id: 'off', label: 'Off' },
    { id: 'on', label: 'On' },
  ],
  default: 'off',
});
