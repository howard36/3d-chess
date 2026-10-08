import { TOWER_SHADE } from './mask';

// The night sky's colour in a direction from the sky sphere's centre, as
// GLSL `vec3 skyColor(vec3 d)`: one chunk shared by the Sky (stage.tsx),
// which draws it, and the ground's veil (stage.tsx), which thickens the far
// plain into exactly what the sky shows behind it, so the plain meets the
// sky with no step. Two skies (envPreview `skyGlow`): today's, and one with
// more air in it. Each needs the uniforms uTop, uHorizon, uBottom and uMist;
// the airy one also uAir and shadeUniforms() (skyAirUniforms). A shader that
// has the tower's shade at hand already (the ground's) takes the chunk
// without it (`skyColorBody`) and calls `skyColorShaded(d, shade)`.

/** The sky's gradient and the breath of mist along its horizon (both skies). */
const SKY_BASE = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uBottom;
  uniform vec3 uMist;
  vec3 skyBase(vec3 d) {
    float h = d.y;
    vec3 c = h > 0.0
      ? mix(uHorizon, uTop, pow(h, 0.45))
      : mix(uHorizon, uBottom, pow(-h, 0.5));
    // A breath of mist lying along the horizon, in a soft wider glow
    c += uMist * exp(-pow(h / 0.05, 2.0)) * 0.045;
    c += uMist * exp(-pow(h / 0.16, 2.0)) * 0.008;
    return c;
  }`;

/** Today's sky: its two banks of mist (envPreview `skyGlow: off`). */
export const SKY_TODAY_COLOR = /* glsl */ `
  ${SKY_BASE}
  vec3 skyColor(vec3 d) {
    float h = d.y;
    vec3 c = skyBase(d);
    // Far off, two banks of mist, their tops rolling slowly round
    // the horizon (whole waves round it, so they close up behind)
    float az = atan(d.x, d.z);
    float low = 0.012 + 0.006 * sin(az * 3.0 + 0.7) + 0.004 * sin(az * 7.0 + 2.1);
    float high = 0.034 + 0.009 * sin(az * 2.0 + 4.0) + 0.005 * sin(az * 5.0 + 0.3);
    float bank = smoothstep(low + 0.014, low - 0.004, h) * smoothstep(-0.05, -0.005, h);
    float stratum = exp(-pow((h - high) / 0.007, 2.0));
    return c + uMist * (bank * 0.014 + stratum * 0.008);
  }
  vec3 skyColorShaded(vec3 d, float shade) {
    return skyColor(d);
  }`;

/**
 * The sky with more air in it (envPreview `skyGlow: on`): a faint teal-grey
 * airglow a few degrees up, in slow broad waves, and far off two banks of
 * mist that can be seen: a low one whose rolling top stands a degree or two
 * over the horizon, and above it a thin, broken stratum. All of it added
 * light, so all of it sinks into the tower's shade.
 */
const SKY_AIR_BODY = /* glsl */ `
  ${SKY_BASE}
  uniform vec3 uAir;
  vec3 skyColorShaded(vec3 d, float shade) {
    float h = d.y;
    vec3 c = skyBase(d);
    // Whole waves round the horizon, so everything closes up behind
    float az = atan(d.x, d.z);
    float waves = 1.0 + 0.3 * sin(az * 3.0 + h * 26.0 + 0.4) + 0.2 * sin(az * 5.0 - h * 40.0 + 2.2);
    vec3 add = uAir * exp(-pow((h - 0.11) / 0.075, 2.0)) * 0.0065 * waves;
    float low = 0.02 + 0.009 * sin(az * 3.0 + 0.7) + 0.005 * sin(az * 7.0 + 2.1)
      + 0.0025 * sin(az * 13.0 + 1.1);
    float bank = smoothstep(low + 0.016, low - 0.005, h) * smoothstep(-0.07, -0.004, h);
    float high = 0.05 + 0.011 * sin(az * 2.0 + 4.0) + 0.005 * sin(az * 5.0 + 0.3);
    float broken = smoothstep(-0.3, 0.7, sin(az * 4.0 + 1.3) + 0.5 * sin(az * 9.0 + 0.2));
    float stratum = exp(-pow((h - high) / 0.009, 2.0)) * broken;
    add += uMist * (bank * 0.028 + stratum * 0.013);
    if (add.b > 2e-5) add *= 1.0 - shade;
    return c + add;
  }`;

export const SKY_AIR_COLOR = /* glsl */ `
  ${SKY_AIR_BODY}
  ${TOWER_SHADE}
  vec3 skyColor(vec3 d) {
    return skyColorShaded(d, towerShade());
  }`;

/** The sky's colour chunk for a sky with (envPreview `skyGlow: on`) or without its air. */
export const skyColorChunk = (air: boolean) => (air ? SKY_AIR_COLOR : SKY_TODAY_COLOR);

/**
 * The chunk without the tower's shade, for a shader that includes
 * TOWER_SHADE itself: only `skyColorShaded(d, shade)` (either sky).
 */
export const skyColorBody = (air: boolean) => (air ? SKY_AIR_BODY : SKY_TODAY_COLOR);
