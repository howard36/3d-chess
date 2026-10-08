// ENV PREVIEW (temporary): the demo feature, the existing shooting star.
// `on` is main's (one a minute or so, once the camera looks up); `often`
// brings one every few seconds of looking up, to review sky changes with.
import { defineEnvFeature } from '../registry';

export const shootingStar = defineEnvFeature({
  id: 'shootingStar',
  label: 'Shooting star',
  group: 'Events',
  options: [
    { id: 'off', label: 'Off' },
    { id: 'on', label: 'On' },
    { id: 'often', label: 'Often' },
  ],
  default: 'on',
  baseline: 'on',
});
