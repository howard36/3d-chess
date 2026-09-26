import { useMemo } from 'react';
import {
  AdditiveBlending,
  BackSide,
  DoubleSide,
  Euler,
  Matrix4,
  ShaderMaterial,
  Vector3,
} from 'three';
import { noRaycast } from '../kit/noRaycast';
import { rng, sparkTexture } from '../kit/textures';
import type { Vec3 } from '../types';
import { cosmosTime, NOISE_GLSL } from './shaders';

// The deep-space backdrop: a nebula painted on the inside of a huge sphere,
// a ringed gas giant far off, and a handful of bright diffraction-spiked
// stars. All of it lives in one slowly turning group (see Stage).

const nebulaMaterial = new ShaderMaterial({
  side: BackSide,
  depthWrite: false,
  fog: false,
  uniforms: { uTime: cosmosTime },
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    varying vec3 vDir;
    ${NOISE_GLSL}
    void main() {
      vec3 d = normalize(vDir);
      vec3 p = d * 2.4 + vec3(uTime * 0.006, 0.0, uTime * 0.003);
      float warp = cFbm(p * 1.2);
      float n = cFbm(p * 1.05 + warp * 1.9);
      float fine = cFbm(p * 3.4 - warp * 1.3);
      // The cloud gathers along a tilted band, like a galactic plane
      float plane = dot(d, normalize(vec3(0.35, 0.9, -0.3)));
      float band = exp(-plane * plane * 5.0);
      float dens = smoothstep(0.38, 0.82, n) * (0.25 + 0.75 * band);
      // Dark dust lanes eat into it
      dens *= 1.0 - 0.75 * smoothstep(0.55, 0.8, fine) * band;
      vec3 violet = vec3(0.20, 0.06, 0.40);
      vec3 teal = vec3(0.02, 0.24, 0.30);
      vec3 rose = vec3(0.42, 0.06, 0.22);
      vec3 col = mix(violet, teal, smoothstep(0.35, 0.7, fine));
      col = mix(col, rose, smoothstep(0.62, 0.85, warp) * 0.6);
      // Glowing filaments along the densest ridges
      float ridge = 1.0 - abs(n - 0.62) * 7.0;
      col += vec3(0.25, 0.2, 0.45) * clamp(ridge, 0.0, 1.0) * band * 0.35;
      vec3 space = vec3(0.004, 0.005, 0.016);
      gl_FragColor = vec4(space + col * dens * 0.5, 1.0);
      #include <colorspace_fragment>
    }`,
});

export const Nebula = () => (
  <mesh material={nebulaMaterial} raycast={noRaycast} renderOrder={-1000} frustumCulled={false}>
    <sphereGeometry args={[90, 48, 24]} />
  </mesh>
);

// --- Ringed planet ----------------------------------------------------------

/** Direction the starlight comes from, shared with the scene's key light. */
export const SUN_DIRECTION = new Vector3(-0.45, 0.7, 0.55).normalize();
/** The giant is lit from behind and aside, so it shows a crescent-lit disc. */
const PLANET_SUN = new Vector3(-0.85, 0.35, -0.4).normalize();

const planetVertex = /* glsl */ `
  varying vec3 vObj;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    vObj = position;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const planetMaterial = (radius: number) =>
  new ShaderMaterial({
    fog: false,
    uniforms: {
      uTime: cosmosTime,
      uSun: { value: PLANET_SUN },
      uRadius: { value: radius },
    },
    vertexShader: planetVertex,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uSun; uniform float uRadius;
      varying vec3 vObj; varying vec3 vNormalW; varying vec3 vWorld;
      ${NOISE_GLSL}
      void main() {
        vec3 o = vObj / uRadius;
        float swirl = cFbm(vec3(o.x * 3.0 + uTime * 0.01, o.y * 5.0, o.z * 3.0));
        float lat = o.y + swirl * 0.12;
        float bands = 0.5 + 0.18 * sin(lat * 19.0) + 0.5 * (cNoise(vec3(lat * 17.0, 0.5, 0.5)) - 0.5) + 0.25 * (swirl - 0.5);
        vec3 a = vec3(0.34, 0.20, 0.30);
        vec3 b = vec3(0.72, 0.50, 0.42);
        vec3 c = vec3(0.86, 0.74, 0.62);
        vec3 base = mix(a, b, smoothstep(0.15, 0.75, bands));
        base = mix(base, c, smoothstep(0.7, 0.95, bands) * 0.5);
        vec3 n = normalize(vNormalW);
        float light = smoothstep(-0.2, 0.7, dot(n, uSun));
        vec3 view = normalize(cameraPosition - vWorld);
        float rim = pow(1.0 - max(dot(n, view), 0.0), 4.0);
        vec3 night = vec3(0.012, 0.014, 0.04);
        vec3 col = mix(night, base * 0.85, light) + vec3(0.3, 0.5, 1.0) * rim * (0.08 + 0.6 * light);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });

const ringMaterial = (radius: number, tilt: Vec3) =>
  new ShaderMaterial({
    fog: false,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: {
      uSun: { value: PLANET_SUN },
      uRadius: { value: radius },
      uTilt: { value: new Matrix4().makeRotationFromEuler(new Euler(...tilt)) },
    },
    vertexShader: /* glsl */ `
      uniform mat4 uTilt;
      varying float vR;
      varying vec3 vLocal;
      void main() {
        vR = length(position.xy);
        // Relative to the planet's centre, in its (unturned) frame
        vLocal = (uTilt * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun; uniform float uRadius;
      varying float vR; varying vec3 vLocal;
      ${NOISE_GLSL}
      void main() {
        float r = vR / uRadius;
        float k = (r - 1.45) / (2.35 - 1.45);
        float grain = cNoise(vec3(r * 60.0, 0.0, 0.0)) * 0.6 + cNoise(vec3(r * 170.0, 3.0, 0.0)) * 0.4;
        float alpha = smoothstep(0.0, 0.06, k) * smoothstep(1.0, 0.9, k) * (0.25 + 0.75 * grain);
        // The Cassini gap
        alpha *= 1.0 - 0.85 * smoothstep(0.03, 0.0, abs(k - 0.62));
        // The planet's shadow falls across the rings
        vec3 toC = -vLocal;
        float t = dot(toC, uSun);
        float miss = length(toC - uSun * t);
        float shadow = t > 0.0 && miss < uRadius ? 0.12 : 1.0;
        vec3 col = mix(vec3(0.42, 0.34, 0.42), vec3(0.78, 0.66, 0.56), grain) * shadow;
        gl_FragColor = vec4(col * 0.7, alpha * 0.42);
        #include <colorspace_fragment>
      }`,
  });

const RING_TILT: Vec3 = [-1.18, 0.1, 0.38];

export const RingedPlanet = ({
  position,
  radius,
  tilt = RING_TILT,
}: {
  position: Vec3;
  radius: number;
  tilt?: Vec3;
}) => {
  const { body, ring } = useMemo(
    () => ({ body: planetMaterial(radius), ring: ringMaterial(radius, tilt) }),
    [radius, tilt],
  );
  return (
    <group position={position}>
      <mesh material={body} raycast={noRaycast}>
        <sphereGeometry args={[radius, 64, 40]} />
      </mesh>
      <mesh material={ring} rotation={tilt} raycast={noRaycast} renderOrder={-900}>
        <ringGeometry args={[radius * 1.45, radius * 2.35, 160, 1]} />
      </mesh>
    </group>
  );
};

// --- Bright stars -----------------------------------------------------------

const spark = sparkTexture(128);

/** A few near, bright stars with diffraction spikes scattered over the sky. */
export const BrightStars = ({ count = 14, radius = 55, seed = 21 }) => {
  const stars = useMemo(() => {
    const random = rng(seed);
    const palette = ['#ffffff', '#cfe0ff', '#ffe2b8', '#bfefff', '#ffd1f0'];
    return Array.from({ length: count }, () => {
      const u = random() * 1.6 - 0.8;
      const t = random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const r = radius * (0.85 + random() * 0.15);
      return {
        position: [r * s * Math.cos(t), r * u, r * s * Math.sin(t)] as Vec3,
        scale: 1.2 + random() ** 3 * 3.2,
        color: palette[Math.floor(random() * palette.length)],
      };
    });
  }, [count, radius, seed]);
  return (
    <>
      {stars.map((s, i) => (
        <sprite key={i} position={s.position} scale={s.scale} raycast={noRaycast}>
          <spriteMaterial
            map={spark}
            color={s.color}
            transparent
            blending={AdditiveBlending}
            depthWrite={false}
            fog={false}
          />
        </sprite>
      ))}
    </>
  );
};
