import { useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BackSide, Color, PerspectiveCamera, PlaneGeometry, ShaderMaterial, Vector2 } from 'three';
import { noRaycast } from '../kit/noRaycast';
import { frame } from './layout';
import { SHADOW, SKY } from './palette';
import { pixelScale } from './toon';

// The stage is a sheet of warm paper all the way round: a gradient by
// direction only (so every azimuth is the same), a fine print grain and a
// soft vignette fixed to the screen, and under the tower, on the table far
// below level A, the tower's own soft shadow. Nothing moves and nothing is
// lit: the pieces carry their own poster shading.

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const skyFragment = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uBottom;
  uniform vec2 uResolution;
  uniform float uDisc;
  uniform float uDiscTone;
  varying vec3 vDir;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  void main() {
    float h = normalize(vDir).y;
    vec3 c = h > 0.0
      ? mix(uHorizon, uTop, pow(h, 0.6))
      : mix(uHorizon, uBottom, pow(-h, 0.75));
    // Paper: a soft mottle and a fine tooth, fixed to the page
    vec2 px = gl_FragCoord.xy;
    float mottle = noise(px / 90.0) * 0.6 + noise(px / 31.0) * 0.4;
    float tooth = hash(floor(px));
    c *= 1.0 + (mottle - 0.5) * 0.028 + (tooth - 0.5) * 0.022;
    // A gentle vignette toward the corners of the screen
    vec2 uv = gl_FragCoord.xy / uResolution - 0.5;
    c *= 1.0 - 0.1 * smoothstep(0.25, 0.75, length(uv * vec2(1.1, 1.0)));
    // The poster's one printed form: a large disc of deeper paper behind the
    // tower, fixed to the page (it never turns, so no angle is its best)
    vec2 q = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
    float r = length(q - vec2(0.0, 0.015));
    float fw = fwidth(r) * 1.2;
    float disc = 1.0 - smoothstep(uDisc - fw, uDisc + fw, r);
    c *= mix(1.0, uDiscTone, disc);
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }`;

const PaperSky = () => {
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTop: { value: new Color(SKY.top) },
          uHorizon: { value: new Color(SKY.horizon) },
          uBottom: { value: new Color(SKY.bottom) },
          uResolution: { value: new Vector2(1, 1) },
          uDisc: { value: 0.44 },
          uDiscTone: { value: 0.955 },
        },
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
      }),
    [],
  );
  (material.uniforms.uResolution.value as Vector2).set(size.width * dpr, size.height * dpr);
  return (
    <mesh material={material} raycast={noRaycast} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[80, 32, 16]} />
    </mesh>
  );
};

// The tower's shadow on the table far below level A: a rounded square a
// little wider than the tower, fading out over a long, smooth penumbra
const TABLE_DROP = 1.2;
const tableShadow = new ShaderMaterial({
  transparent: true,
  depthWrite: false,
  fog: false,
  uniforms: {
    uColor: { value: new Color(SHADOW) },
    uOpacity: { value: 0.13 },
    uHalf: { value: frame.half * 1.05 },
    uSoft: { value: 2.4 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vP;
    void main() {
      // In world units (the plane is scaled to size)
      vP = (modelMatrix * vec4(position, 1.0)).xz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform float uHalf;
    uniform float uSoft;
    varying vec2 vP;
    void main() {
      vec2 q = abs(vP) - vec2(uHalf - 0.8);
      float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.8;
      float k = clamp(0.5 - d / (2.0 * uSoft), 0.0, 1.0);
      float a = uOpacity * k * k * (3.0 - 2.0 * k);
      if (a < 0.002) discard;
      gl_FragColor = vec4(uColor, a);
      #include <colorspace_fragment>
    }`,
});
const tablePlane = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

const TableShadow = () => {
  const side = (frame.half * 1.05 + 2.6) * 2;
  return (
    <mesh
      geometry={tablePlane}
      material={tableShadow}
      position={[0, frame.levelY[0] - TABLE_DROP, 0]}
      scale={[side, 1, side]}
      renderOrder={-900}
      raycast={noRaycast}
    />
  );
};

/** Keeps the contours' width in screen pixels as the canvas and lens change. */
const InkScale = () => {
  useFrame(({ camera, size }) => {
    const cam = camera as PerspectiveCamera;
    const fov = ((cam.fov ?? 30) * Math.PI) / 180;
    pixelScale.value = (2 * Math.tan(fov / 2)) / Math.max(size.height, 1);
  });
  return null;
};

export const Stage = () => (
  <>
    <PaperSky />
    <TableShadow />
    <InkScale />
  </>
);
