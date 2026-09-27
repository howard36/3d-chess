import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import type { DirectionalLight } from 'three';
import { noRaycast } from '../kit/noRaycast';
import { rng } from '../kit/textures';
import { SPACE } from './palette';
import { LIMB_DIP, MAP_REACH, PLANET_DISTANCE, planetMap } from './planet';
import { Station } from './station';

// The bay the tower floats in: deep space above, and far below, filling
// the lower sky all the way round, the night side of a planet, with city
// lights strung along its coasts, moonlit cloud, and the thin blue line of
// its atmosphere on the limb. The planet lies straight down, so the scene
// is the same from every side, and a bird's-eye view looks down onto it.
// Everything here is at infinity (drawn from the camera's direction alone)
// and static: nothing moves unless a piece does.

const DEG = Math.PI / 180;

const skyVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const skyFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uOcean;
  uniform vec3 uLand;
  uniform vec3 uCloud;
  uniform vec3 uCity;
  uniform vec3 uLimb;
  uniform vec3 uAirglow;
  uniform vec3 uHaze;
  uniform vec3 uBand;
  uniform vec3 uBandNormal;
  uniform float uSinDip;
  uniform float uDistance;
  uniform float uReach;
  uniform float uTowerRadius;
  varying vec3 vWorld;

  void main() {
    vec3 d = normalize(vWorld - cameraPosition);
    // Height above the limb, in sines (about radians near it)
    float a = d.y + uSinDip;
    float aa = max(fwidth(a), 1e-5);
    // Behind the tower (all of it, from wherever the camera is): the planet's
    // detail and the limb step back, so nothing bright seen through the
    // decks competes with the pieces or passes for a marker
    float toTower = length(cameraPosition);
    float off = acos(clamp(dot(d, -cameraPosition / max(toTower, 1e-4)), -1.0, 1.0));
    float span = asin(clamp(uTowerRadius / max(toTower, 1e-4), 0.0, 1.0));
    float behind = 1.0 - smoothstep(span * 0.8, span * 1.3, off);

    // --- Space: near black, a little bluer toward the planet, and the faint
    // dust of the galaxy's plane
    vec3 space = mix(uHorizon, uZenith, smoothstep(-0.3, 0.85, d.y));
    float bd = dot(d, uBandNormal);
    float along = atan(d.z, d.x);
    float band = exp(-bd * bd / 0.02) * (0.55 + 0.45 * sin(along * 2.0 + 1.1));
    space += uBand * band;

    // The atmosphere seen edge-on: a soft blue haze over the limb, not a
    // hairline (it passes behind the tower from every side, so it must never
    // read as another deck's edge), and a faint airglow a little higher
    float up = max(a, 0.0);
    float line = exp(-up / 0.004);
    float glow = exp(-up / 0.03) * 0.3;
    float air = exp(-pow((a - 0.016) / 0.008, 2.0)) * 0.22;
    space += (uLimb * (line * 0.2 + glow * 0.2) + uAirglow * air * 0.2) * (1.0 - 0.6 * behind);

    // --- The planet
    vec3 col = space;
    float b = uDistance * d.y;
    float disc = b * b - (uDistance * uDistance - 1.0);
    if (disc > 0.0 && d.y < 0.0) {
      float t = -b - sqrt(disc);
      vec3 p = vec3(0.0, uDistance, 0.0) + d * t;
      // How squarely the surface faces us: 1 straight down, 0 at the limb
      float mu = clamp(dot(p, -d), 0.0, 1.0);
      // The map is even in angle from straight down
      float beta = acos(clamp(-d.y, -1.0, 1.0));
      float s = max(length(d.xz), 1e-5);
      vec2 uv = 0.5 + 0.5 * d.xz * (beta / s) / uReach;
      vec4 m = texture2D(uMap, uv);
      vec3 ground = mix(uOcean, uLand, m.b);
      ground += uCloud * m.g * (0.25 + 0.55 * mu) * (1.0 - 0.75 * behind);
      // Cities glow through thin cloud, dimmed by thick
      ground += uCity * m.r * (1.0 - 0.7 * m.g) * (0.3 + 0.25 * mu) * 0.6 * (1.0 - behind);
      // The longer the path through the air, the bluer and hazier
      float haze = pow(1.0 - mu, 5.0);
      ground = mix(ground, uHaze, haze * 0.85);
      // The lit rim just inside the limb
      ground += uLimb * exp(a / 0.004) * 0.2 * (1.0 - 0.6 * behind);
      col = mix(space, ground, smoothstep(aa, -aa, a));
    }
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const skyGeometry = new SphereGeometry(400, 48, 24);

/** The sky: space, the galaxy's dust, the planet and its limb (see above). */
const Sky = () => {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
        uniforms: {
          uMap: { value: planetMap() },
          uZenith: { value: new Color(SPACE.zenith) },
          uHorizon: { value: new Color(SPACE.horizon) },
          uOcean: { value: new Color(SPACE.ocean) },
          uLand: { value: new Color(SPACE.land) },
          uCloud: { value: new Color(SPACE.cloud) },
          uCity: { value: new Color(SPACE.city) },
          uLimb: { value: new Color(SPACE.limb) },
          uAirglow: { value: new Color(SPACE.airglow) },
          uHaze: { value: new Color(SPACE.haze) },
          uBand: { value: new Color('#111a30') },
          uBandNormal: { value: new Vector3(0.42, 0.55, -0.72).normalize() },
          uSinDip: { value: Math.sin(LIMB_DIP) },
          uDistance: { value: PLANET_DISTANCE },
          uReach: { value: MAP_REACH },
          // The tower's bounding sphere, pieces and frames included (it is centred on the origin)
          uTowerRadius: { value: 5.4 },
        },
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh
      geometry={skyGeometry}
      material={material}
      renderOrder={-1000}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

const starVertex = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  uniform float uDpr;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    // At infinity: placed from the camera, so they never shift against the limb
    vec4 w = vec4(cameraPosition + position * 380.0, 1.0);
    gl_Position = projectionMatrix * viewMatrix * w;
    gl_PointSize = aSize * uDpr;
  }`;

const starFragment = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float r = dot(q, q);
    float a = exp(-r * 4.0);
    if (a < 0.02) discard;
    gl_FragColor = vec4(vColor * a, a);
    #include <colorspace_fragment>
  }`;

const STAR_COLOURS = ['#ffffff', '#dfe8ff', '#cddcff', '#fff1dc', '#ffe2c4'];

/**
 * The stars: static, small and few, thicker along the galaxy's plane, and
 * only where the planet does not hide them.
 */
const Stars = () => {
  const dpr = useThree((s) => s.viewport.dpr);
  const { geometry, material } = useMemo(() => {
    const random = rng(17);
    const normal = new Vector3(0.42, 0.55, -0.72).normalize();
    const limb = -Math.sin(LIMB_DIP) + 0.01;
    const pos: number[] = [];
    const size: number[] = [];
    const col: number[] = [];
    const c = new Color();
    const v = new Vector3();
    for (let i = 0; pos.length < 2400 * 3 && i < 30000; i++) {
      v.set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1);
      if (v.lengthSq() > 1 || v.lengthSq() < 1e-4) continue;
      v.normalize();
      if (v.y < limb) continue;
      // Half the stars crowd toward the galaxy's plane
      const off = Math.abs(v.dot(normal));
      if (random() < 0.55 && random() > Math.exp((-off * off) / 0.03)) continue;
      pos.push(v.x, v.y, v.z);
      const bright = random() ** 5;
      size.push(1.3 + bright * 3.2);
      c.set(STAR_COLOURS[Math.floor(random() * STAR_COLOURS.length)]);
      // Dim, most of them: points of light, not a sparkle
      c.multiplyScalar(0.28 + bright * 0.72);
      col.push(c.r, c.g, c.b);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geometry.setAttribute('aSize', new BufferAttribute(new Float32Array(size), 1));
    geometry.setAttribute('aColor', new BufferAttribute(new Float32Array(col), 3));
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: { uDpr: { value: 1 } },
      vertexShader: starVertex,
      fragmentShader: starFragment,
    });
    return { geometry, material };
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  material.uniforms.uDpr.value = dpr;
  return (
    <points
      geometry={geometry}
      material={material}
      renderOrder={-999}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

/**
 * Lights that travel with the camera, so every piece is modelled the same
 * way from any orbit and either seat: a neutral key over the viewer's left
 * shoulder, and a strong cool rim from behind the tower that edges the
 * graphite army in light.
 */
const CameraLights = () => {
  const key = useRef<DirectionalLight>(null);
  const rim = useRef<DirectionalLight>(null);
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    const az = Math.atan2(camera.position.x, camera.position.z);
    const place = (light: DirectionalLight | null, azimuth: number, elevation: number) =>
      light?.position.set(
        Math.sin(azimuth) * Math.cos(elevation) * 12,
        Math.sin(elevation) * 12,
        Math.cos(azimuth) * Math.cos(elevation) * 12,
      );
    place(key.current, az - 40 * DEG, 50 * DEG);
    place(rim.current, az + 180 * DEG + 30 * DEG, 24 * DEG);
  });
  return (
    <>
      <directionalLight ref={key} intensity={2.3} color="#fff5ea" />
      <directionalLight ref={rim} intensity={2.2} color="#cfe0ff" />
    </>
  );
};

export const Stage = () => (
  <>
    <Sky />
    <Stars />
    <Station />
    {/* Reflections: a dark bay with long soft strip lights overhead and round
        the walls, and the planet's faint blue from below */}
    <Environment resolution={64} frames={1}>
      <color attach="background" args={['#070a11']} />
      <Lightformer
        form="rect"
        intensity={1.4}
        color="#e8f0ff"
        position={[0, 9, 0]}
        rotation-x={Math.PI / 2}
        scale={[3, 12, 1]}
      />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Lightformer
          key={i}
          form="rect"
          intensity={0.7}
          color="#b9cbe6"
          position={[Math.sin((i * Math.PI) / 3) * 8, 3, Math.cos((i * Math.PI) / 3) * 8]}
          scale={[4, 0.6, 1]}
        />
      ))}
      <Lightformer
        form="rect"
        intensity={0.5}
        color="#2d5fb0"
        position={[0, -9, 0]}
        rotation-x={-Math.PI / 2}
        scale={[16, 16, 1]}
      />
    </Environment>
    <hemisphereLight args={['#c6d6ee', '#1f3c73', 0.55]} />
    <CameraLights />
  </>
);
