/**
 * GLSL: `vec2 gridLines(vec2 uv, float width)`, the hairlines at whole
 * numbers of `uv` (x lines in .x, y lines in .y, 0–1), `width` uv wide
 * (Ben Golus's pristine grid): coverage-correct at any distance, thinning
 * into dimmer lines rather than aliasing. Callers join the two by taking
 * the brighter, so a crossing is an even line, never a dot.
 */
export const GRID_LINES = /* glsl */ `
  vec2 gridLines(vec2 uv, float width) {
    vec4 dd = vec4(dFdx(uv), dFdy(uv));
    vec2 deriv = max(vec2(length(dd.xz), length(dd.yw)), vec2(1e-6));
    vec2 target = vec2(width);
    vec2 draw = clamp(target, deriv, vec2(0.5));
    vec2 aa = deriv * 1.5;
    vec2 g = 1.0 - abs(fract(uv) * 2.0 - 1.0);
    vec2 lines = smoothstep(draw + aa, draw - aa, g);
    lines *= clamp(target / draw, 0.0, 1.0);
    return mix(lines, target, clamp(deriv * 2.0 - 1.0, 0.0, 1.0));
  }`;
