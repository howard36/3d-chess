import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { BackSide, Color, LinearMipmapLinearFilter, ShaderMaterial, Vector3 } from 'three';
import type { DirectionalLight } from 'three';
import { noRaycast } from '../kit/noRaycast';
import { fbm, paintedTexture } from '../kit/textures';
import { SKY } from './palette';

// A sunny day above the clouds. The default camera looks slightly down, so
// most of what sits behind the tower is a sea of cloud far below, kept in
// soft periwinkle mid-tones: well clear of the cream army (the lightest thing
// on screen) and the navy army (the darkest). It drifts very slowly, the only
// thing that moves while nobody plays. The sky above is a clear azure with a
// warm sun glow. There are deliberately no cloud shapes on the horizon: from
// some angle any silhouette out there sits right behind the tower and shows
// through the glass like an object inside it.

const SUN = new Vector3(0.55, 0.42, -0.72).normalize();

/** A tiling billow texture: the density of the cloud sea (red) and its sunlit side (green). */
const seaTexture = (() => {
  const noise = fbm(11, 3, 3);
  const t = paintedTexture(
    (u, v) => {
      const d = noise(u, v);
      const lit = noise(u - 0.01, v + 0.014);
      const density = Math.min(Math.max((d - 0.36) / 0.3, 0), 1);
      const light = Math.min(Math.max(0.45 + (d - lit) * 14, 0), 1);
      return [density * 255, light * 255, 0];
    },
    { size: 256, color: false },
  );
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
})();

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const skyFragment = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uHaze;
  uniform vec3 uSun;
  uniform vec3 uSunHaze;
  uniform vec3 uSunDir;
  uniform vec3 uSeaLight;
  uniform vec3 uSeaMid;
  uniform vec3 uSeaShadow;
  uniform vec3 uSeaDeep;
  uniform sampler2D uSea;
  uniform float uTime;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col;
    if (h > 0.0) {
      col = mix(uHorizon, uZenith, pow(h, 0.55));
      float s = max(dot(d, uSunDir), 0.0);
      col += uSun * (pow(s, 90.0) * 0.9 + pow(s, 8.0) * 0.16);
    } else {
      // The cloud sea: a plane far below, seen in perspective
      vec2 p = d.xz / max(-h, 0.03);
      vec2 uv = p * 0.3 + vec2(uTime * 0.004, uTime * 0.0015);
      vec4 sea = texture2D(uSea, uv);
      vec4 swell = texture2D(uSea, uv * 0.31 + vec2(0.31, 0.17));
      float density = clamp(sea.r * 0.7 + swell.r * 0.5 - 0.1, 0.0, 1.0);
      vec3 cloud = mix(uSeaShadow, uSeaMid, smoothstep(0.1, 0.7, density));
      // Sunlit tops of the puffs
      cloud = mix(cloud, uSeaLight, smoothstep(0.35, 1.0, density) * sea.g);
      // Gaps between the clouds show a deeper blue
      cloud = mix(uSeaDeep, cloud, smoothstep(0.0, 0.22, density));
      // Distance: the far sea melts into the haze
      col = mix(uHaze, cloud, smoothstep(0.01, 0.24, -h));
    }
    // A thin haze band where sky meets cloud
    col = mix(col, uHaze, exp(-abs(h) * 30.0) * 0.6);
    // Toward the sun the haze and the far cloud tops warm up: a sunny side
    // that turns with the orbit, always far off on the horizon
    float toSun = max(dot(normalize(d.xz + 1e-5), normalize(uSunDir.xz)), 0.0);
    col = mix(col, uSunHaze, pow(toSun, 3.0) * exp(-abs(h) * 7.0) * 0.5);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const Sky = () => {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uZenith: { value: new Color(SKY.zenith) },
          uHorizon: { value: new Color(SKY.horizon) },
          uHaze: { value: new Color(SKY.haze) },
          uSun: { value: new Color(SKY.sun) },
          uSunHaze: { value: new Color(SKY.sunHaze) },
          uSunDir: { value: SUN },
          uSeaLight: { value: new Color(SKY.seaLight) },
          uSeaMid: { value: new Color(SKY.seaMid) },
          uSeaShadow: { value: new Color(SKY.seaShadow) },
          uSeaDeep: { value: new Color(SKY.seaDeep) },
          uSea: { value: seaTexture },
          uTime: { value: 0 },
        },
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
      }),
    [],
  );
  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
  });
  return (
    <mesh material={material} raycast={noRaycast} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[90, 48, 24]} />
    </mesh>
  );
};

// --- Light ---------------------------------------------------------------------------

const KEY = new Vector3(5, 7, 3);
const RIM = new Vector3(-6, 5, -26);
const at = new Vector3();

/**
 * Lights that ride with the camera: a warm key from above the player's
 * right shoulder and a cool rim from behind the tower, so every toy is lit
 * the same way from any angle and either seat (no dark backlit side, no
 * specular glare swinging into view as the camera orbits).
 */
const CameraLights = () => {
  const key = useRef<DirectionalLight>(null);
  const rim = useRef<DirectionalLight>(null);
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    key.current?.position.copy(camera.localToWorld(at.copy(KEY)));
    rim.current?.position.copy(camera.localToWorld(at.copy(RIM)));
  });
  return (
    <>
      <directionalLight ref={key} intensity={2.0} color="#fff1dc" />
      <directionalLight ref={rim} intensity={1.5} color="#d9d4ff" />
    </>
  );
};

export const Stage = () => (
  <>
    <Sky />
    <Environment resolution={64} frames={1}>
      <mesh scale={40}>
        <sphereGeometry args={[1, 16, 8]} />
        <meshBasicMaterial side={BackSide} color="#9ab8f0" />
      </mesh>
      <Lightformer
        form="rect"
        intensity={2.4}
        color="#fff4e4"
        position={[2, 8, 3]}
        rotation-x={Math.PI / 2}
        scale={[10, 6, 1]}
      />
      <Lightformer
        form="rect"
        intensity={1.2}
        color="#ffffff"
        position={[0, 2, 9]}
        scale={[10, 3, 1]}
      />
      <Lightformer
        form="rect"
        intensity={0.7}
        color="#c9c0ff"
        position={[0, -5, 0]}
        rotation-x={-Math.PI / 2}
        scale={[14, 14, 1]}
      />
    </Environment>
    <hemisphereLight args={['#dcecff', '#b7a9ee', 0.95]} />
    <CameraLights />
  </>
);
