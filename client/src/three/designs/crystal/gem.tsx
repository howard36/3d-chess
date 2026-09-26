import { Color, ShaderMaterial } from 'three';

// A cut-gem shader. Every facet is flat (normals from screen-space
// derivatives), and shows a little painted room: a pastel dusk broken by
// dark bands and bright softboxes. The facet reflects the room by Fresnel
// and refracts it with a split per colour channel, so edges of the bands
// throw rainbow fire. The room turns slowly, so facets flash as the light
// passes, and a hashed per-facet glint twinkles on top. No environment map,
// no transmission pass: it costs one shader, whatever the scene holds.

/** Shared clock for every gem material; the Stage advances it. */
export const gemTime = { value: 0 };

export interface GemOptions {
  /** Colour the light passing through the stone is tinted by. */
  tint: string;
  /** How much of the refracted room shows through the body (1 = water clear). */
  clarity?: number;
  /** Reflectance at normal incidence (diamond ~0.17, glass ~0.04). */
  f0?: number;
  /** Spread of the refractive index across R, G and B. */
  dispersion?: number;
  /** Strength of the twinkling facet glints. */
  sparkle?: number;
  /** A colour the whole stone glows with (selection, check). */
  glow?: string;
  glowAmount?: number;
  /** Pulse the glow (a king in check). */
  pulse?: boolean;
  /** Bright fresnel edge that separates the stone from the background. */
  rim?: string;
  rimAmount?: number;
  /** Dark edge along the silhouette, as total internal reflection gives a real stone. */
  edge?: string;
  edgeAmount?: number;
  /** How deep the room's dark bands are (0–1). */
  bands?: number;
  /** Transparency, for shards that fade. */
  opacity?: number;
}

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vTint;
  varying vec3 vOrigin;
  void main() {
    vec4 p = vec4(position, 1.0);
    vec4 o = vec4(0.0, 0.0, 0.0, 1.0);
    #ifdef USE_INSTANCING
      p = instanceMatrix * p;
      o = instanceMatrix * o;
    #endif
    vec4 w = modelMatrix * p;
    vWorld = w.xyz;
    vOrigin = (modelMatrix * o).xyz;
    vTint = vec3(1.0);
    #ifdef USE_INSTANCING_COLOR
      vTint = instanceColor;
    #endif
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uTint;
  uniform float uClarity;
  uniform float uF0;
  uniform float uDisp;
  uniform float uSparkle;
  uniform vec3 uGlow;
  uniform float uGlowAmt;
  uniform float uPulse;
  uniform vec3 uRim;
  uniform float uRimAmt;
  uniform float uOpacity;
  uniform vec3 uEdge;
  uniform float uEdgeAmt;
  uniform float uBands;
  varying vec3 vWorld;
  varying vec3 vTint;
  varying vec3 vOrigin;

  // The painted room every facet sees.
  vec3 room(vec3 d) {
    float a = uTime * 0.16;
    float c = cos(a);
    float s = sin(a);
    d = vec3(c * d.x - s * d.z, d.y, s * d.x + c * d.z);
    float y = d.y;
    vec3 col = mix(vec3(1.0, 0.8, 0.84), vec3(0.8, 0.74, 1.0), smoothstep(0.0, 0.7, y));
    col = mix(col, vec3(0.55, 0.46, 0.82), smoothstep(0.0, -0.7, y));
    float az = atan(d.z, d.x);
    // Dark bands give neighbouring facets their contrast
    float band = smoothstep(0.45, 0.85, sin(az * 3.0 + y * 2.5));
    col = mix(col, vec3(0.1, 0.06, 0.24), band * uBands);
    float band2 = smoothstep(0.7, 0.95, sin(az * 5.0 - y * 4.0 + 1.3));
    col = mix(col, vec3(0.2, 0.12, 0.38), band2 * uBands * 0.65);
    // Softbox overhead and two coloured strips
    col += vec3(1.7) * smoothstep(0.84, 0.95, y);
    float fall = 1.0 - smoothstep(0.2, 0.9, abs(y));
    col += vec3(1.5, 0.75, 1.1) * smoothstep(0.96, 0.995, cos(az - 0.6)) * fall;
    col += vec3(0.75, 1.25, 1.5) * smoothstep(0.96, 0.995, cos(az + 2.3)) * fall;
    col += vec3(1.4, 1.2, 0.7) * smoothstep(0.97, 0.998, cos(az + 0.9)) * fall;
    return col;
  }

  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  }

  void main() {
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    vec3 v = normalize(vWorld - cameraPosition);
    if (dot(n, v) > 0.0) n = -n;
    float cosT = clamp(-dot(v, n), 0.0, 1.0);
    float fres = uF0 + (1.0 - uF0) * pow(1.0 - cosT, 5.0);
    vec3 refl = room(reflect(v, n));
    vec3 tr = refract(v, n, 1.0 / (2.42 - uDisp));
    vec3 tg = refract(v, n, 1.0 / 2.42);
    vec3 tb = refract(v, n, 1.0 / (2.42 + uDisp));
    vec3 body = vec3(room(tr).r, room(tg).g, room(tb).b) * uTint * vTint * uClarity;
    vec3 col = mix(body, refl, fres);
    // A dark edge, then a rim of light, around the silhouette
    col = mix(col, uEdge, uEdgeAmt * pow(1.0 - cosT, 2.2));
    col += uRim * uRimAmt * pow(1.0 - cosT, 3.0);
    // Glints: now and then a facet catches the light and flares
    float h = hash(floor(n * 12.0 + 0.5) + floor(vOrigin * 4.0));
    float glint = pow(max(0.0, sin(uTime * 1.3 + h * 60.0)), 90.0);
    col += vec3(1.6, 1.5, 1.7) * glint * uSparkle;
    float pulse = mix(1.0, 0.6 + 0.4 * sin(uTime * 6.0), uPulse);
    col += uGlow * uGlowAmt * pulse;
    gl_FragColor = vec4(col, uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export const gemMaterial = (o: GemOptions): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: {
      uTime: gemTime,
      uTint: { value: new Color(o.tint) },
      uClarity: { value: o.clarity ?? 1 },
      uF0: { value: o.f0 ?? 0.17 },
      uDisp: { value: o.dispersion ?? 0.07 },
      uSparkle: { value: o.sparkle ?? 1 },
      uGlow: { value: new Color(o.glow ?? '#000000') },
      uGlowAmt: { value: o.glowAmount ?? 0 },
      uPulse: { value: o.pulse ? 1 : 0 },
      uRim: { value: new Color(o.rim ?? '#ffffff') },
      uRimAmt: { value: o.rimAmount ?? 0 },
      uOpacity: { value: o.opacity ?? 1 },
      uEdge: { value: new Color(o.edge ?? '#1c1240') },
      uEdgeAmt: { value: o.edgeAmount ?? 0 },
      uBands: { value: o.bands ?? 0.92 },
    },
    vertexShader,
    fragmentShader,
    transparent: (o.opacity ?? 1) < 1,
  });
