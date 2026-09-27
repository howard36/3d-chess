import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import {
  AdditiveBlending,
  BackSide,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  FrontSide,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { BufferGeometry, DirectionalLight, Side, Texture } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { noRaycast } from '../kit/noRaycast';
import { CANDLE, WINDOW } from './palette';
import { floorTexture, NAVE, wallTexture } from './textures';

// The world: the tower hangs in the crossing of a dark Gothic rotunda, level
// with its clerestory. All round, piers of clustered shafts rise into a
// vault lost in shadow; between them tall lancets and two great roses, one
// facing each seat, glow in old glass (wine, amber, cobalt, grisaille: never
// the level colours, which belong to the tower); far below, the stone floor
// holds a labyrinth and the pools of coloured light the windows throw, and
// faint shafts of that light slant down through the air. Everything is dim
// and soft (a haze thickens with distance), so it reads as a place without
// ever taking the eye from the board, and nothing in it moves.

const hazeVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

/** The tower's bounding radius, and how dim the nave is behind it. */
const TOWER_R = 4.3;
const MASK_DIM = 0.35;

/** Dims whatever lies behind the tower from the camera (the tower's centre is the origin). */
const towerMask = /* glsl */ `
  float towerMask(vec3 world) {
    vec3 toFrag = normalize(world - cameraPosition);
    vec3 toCentre = normalize(-cameraPosition);
    float ang = acos(clamp(dot(toFrag, toCentre), -1.0, 1.0));
    float cone = asin(clamp(${TOWER_R.toFixed(2)} / max(length(cameraPosition), ${(TOWER_R * 1.01).toFixed(3)}), 0.0, 1.0));
    return mix(${MASK_DIM.toFixed(2)}, 1.0, smoothstep(cone, cone * 1.6, ang));
  }`;

const hazeFragment = /* glsl */ `
  ${towerMask}
  uniform sampler2D uMap;
  uniform float uIntensity;
  uniform vec3 uHaze;
  uniform float uDensity;
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vec3 c = texture2D(uMap, vUv).rgb * uIntensity;
    // Whatever lies behind the tower from here (the rose, a lancet, the
    // labyrinth from above) is dimmed, so nothing bright shows through the
    // platforms: a cone round the tower's centre as wide as the tower looks,
    // fading out beyond it. The piers and shafts are masked the same way.
    c *= towerMask(vWorld);
    float d = distance(cameraPosition, vWorld);
    float haze = 1.0 - exp(-d * uDensity);
    c = mix(c, uHaze, haze * 0.75);
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }`;

const hazeMaterial = (map: Texture, intensity: number, side: Side) =>
  new ShaderMaterial({
    side,
    depthWrite: false,
    fog: false,
    uniforms: {
      uMap: { value: map },
      uIntensity: { value: intensity },
      uHaze: { value: new Color('#0e0c14') },
      uDensity: { value: 0.018 },
    },
    vertexShader: hazeVertex,
    fragmentShader: hazeFragment,
  });

// --- Piers ------------------------------------------------------------------------

const PIER_RADIUS = 38;

const pierVertex = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormalW;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const pierFragment = /* glsl */ `
  ${towerMask}
  uniform vec3 uGlass[5];
  uniform vec3 uStone;
  uniform vec3 uHaze;
  uniform float uFloor;
  uniform float uTurn;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  vec3 glassAt(float a) {
    // The window nearest this side of the pier, by its bay
    float bay = floor(mod((a - uTurn) / 6.2831853 * 12.0 + 12.0, 12.0));
    int k = int(mod(bay * 2.0, 5.0));
    vec3 c = uGlass[0];
    if (k == 1) c = uGlass[1];
    if (k == 2) c = uGlass[2];
    if (k == 3) c = uGlass[3];
    if (k == 4) c = uGlass[4];
    return c;
  }
  void main() {
    vec3 n = normalize(vNormalW);
    vec3 radial = normalize(vec3(vWorld.x, 0.0, vWorld.z));
    vec3 tangent = vec3(radial.z, 0.0, -radial.x);
    float a = atan(vWorld.x, vWorld.z);
    // Window light from either side, in the colour of that window
    float side = dot(n, tangent);
    vec3 lit = uStone;
    lit += glassAt(a - 0.26) * max(side, 0.0) * 0.07;
    lit += glassAt(a + 0.26) * max(-side, 0.0) * 0.07;
    // A faint rim so the pier holds its shape against the glow behind it
    vec3 view = normalize(cameraPosition - vWorld);
    float rim = pow(1.0 - abs(dot(n, view)), 3.0);
    lit += glassAt(a) * rim * 0.035;
    // Lost in the vault above, and in the haze near the floor
    float h = vWorld.y;
    lit *= 1.0 - smoothstep(8.0, 26.0, h);
    lit *= 0.55 + 0.45 * smoothstep(uFloor, uFloor + 12.0, h);
    lit *= towerMask(vWorld);
    float d = distance(cameraPosition, vWorld);
    lit = mix(lit, uHaze, (1.0 - exp(-d * 0.022)) * 0.7);
    gl_FragColor = vec4(lit, 1.0);
    #include <colorspace_fragment>
  }`;

/** One clustered pier: a core and four attached shafts, floor to vault. */
const pierGeometry = (): BufferGeometry => {
  const h = NAVE.wallTop - NAVE.floorY;
  const parts = [new CylinderGeometry(0.95, 1.05, h, 18, 1, true)];
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    parts.push(
      new CylinderGeometry(0.42, 0.46, h, 12, 1, true).translate(
        Math.cos(a) * 0.95,
        0,
        Math.sin(a) * 0.95,
      ),
    );
  }
  // A base: a wide plinth
  parts.push(new CylinderGeometry(1.7, 1.8, 1.4, 18, 1, false).translate(0, -h / 2 + 0.7, 0));
  const merged = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  merged.translate(0, (NAVE.wallTop + NAVE.floorY) / 2, 0);
  return merged;
};

const Piers = () => {
  const { geometry, material } = useMemo(
    () => ({
      geometry: pierGeometry(),
      material: new ShaderMaterial({
        side: FrontSide,
        uniforms: {
          uGlass: { value: WINDOW.map((c) => new Color(c)) },
          uStone: { value: new Color('#0f0d13') },
          uHaze: { value: new Color('#0d0b13') },
          uFloor: { value: NAVE.floorY },
          uTurn: { value: NAVE.turn },
        },
        vertexShader: pierVertex,
        fragmentShader: pierFragment,
      }),
    }),
    [],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return (
    <>
      {Array.from({ length: NAVE.bays }, (_, b) => {
        const a = ((b + 0.5) / NAVE.bays) * Math.PI * 2 + NAVE.turn;
        return (
          <mesh
            key={b}
            geometry={geometry}
            material={material}
            position={[Math.sin(a) * PIER_RADIUS, 0, Math.cos(a) * PIER_RADIUS]}
            raycast={noRaycast}
          />
        );
      })}
    </>
  );
};

// --- Shafts of window light ---------------------------------------------------------

const beamVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const beamFragment = /* glsl */ `
  ${towerMask}
  uniform vec3 uColor;
  uniform float uStrength;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  void main() {
    vec3 view = normalize(cameraPosition - vWorld);
    // Densest through the beam's middle, as lit dust in the air would be
    float through = pow(abs(dot(normalize(vNormalW), view)), 2.2);
    // Born at the window, spent before it reaches the floor
    float along = smoothstep(1.0, 0.8, vUv.y) * smoothstep(0.0, 0.45, vUv.y);
    float a = uStrength * through * along * towerMask(vWorld);
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }`;

/** Windows that throw a visible shaft: both roses and four of the lancets. */
const SHAFTS: { bay: number; width: number; strength: number }[] = [
  { bay: 0, width: 6.5, strength: 0.05 },
  { bay: 6, width: 6.5, strength: 0.05 },
  { bay: 2, width: 3, strength: 0.045 },
  { bay: 4, width: 3, strength: 0.04 },
  { bay: 8, width: 3, strength: 0.045 },
  { bay: 10, width: 3, strength: 0.04 },
];

const up = new Vector3(0, 1, 0);

/**
 * Faint shafts of coloured light slanting down from the windows toward the
 * pools they leave on the floor: volumes, so they hold their shape from any
 * side, and far out in the nave, well clear of the tower. Still.
 */
const Shafts = () => {
  const items = useMemo(
    () =>
      SHAFTS.map(({ bay, width, strength }) => {
        const isRose = (NAVE.roses as readonly number[]).includes(bay);
        const a = (bay / NAVE.bays) * Math.PI * 2 + NAVE.turn;
        const dir = new Vector3(Math.sin(a), 0, Math.cos(a));
        const top = dir
          .clone()
          .multiplyScalar(NAVE.wallRadius - 0.5)
          .setY(isRose ? -1.5 : -1);
        const bottom = dir
          .clone()
          .multiplyScalar(isRose ? 20 : 29)
          .setY(NAVE.floorY);
        const axis = top.clone().sub(bottom);
        const length = axis.length();
        const geometry = new CylinderGeometry(width * 0.5, width * 0.62, length, 20, 1, true);
        const quaternion = new Quaternion().setFromUnitVectors(up, axis.clone().normalize());
        const centre = top.clone().add(bottom).multiplyScalar(0.5);
        const main = isRose ? 2 : [2, 0, 3, 1, 4, 2][bay % 6];
        const material = new ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          side: DoubleSide,
          uniforms: {
            uColor: { value: new Color(WINDOW[main]) },
            uStrength: { value: strength },
          },
          vertexShader: beamVertex,
          fragmentShader: beamFragment,
        });
        return { geometry, material, quaternion, centre };
      }),
    [],
  );
  useEffect(
    () => () =>
      items.forEach(({ geometry, material }) => {
        geometry.dispose();
        material.dispose();
      }),
    [items],
  );
  return (
    <>
      {items.map(({ geometry, material, quaternion, centre }, i) => (
        <mesh
          key={i}
          geometry={geometry}
          material={material}
          position={centre}
          quaternion={quaternion}
          renderOrder={-990}
          raycast={noRaycast}
        />
      ))}
    </>
  );
};

/** The wall, the floor, the piers and the shafts of light. */
export const Nave = () => {
  const { wall, floor, wallMat, floorMat } = useMemo(() => {
    const h = NAVE.wallTop - NAVE.floorY;
    // Turned back half a bay, so bay 0 (a rose) is centred on +z
    const wall = new CylinderGeometry(
      NAVE.wallRadius,
      NAVE.wallRadius,
      h,
      96,
      1,
      true,
      -Math.PI / NAVE.bays + NAVE.turn,
    ).translate(0, (NAVE.wallTop + NAVE.floorY) / 2, 0);
    const floor = new CircleGeometry(NAVE.wallRadius, 96).rotateX(-Math.PI / 2);
    floor.translate(0, NAVE.floorY, 0);
    return {
      wall,
      floor,
      wallMat: hazeMaterial(wallTexture(), 1.1, BackSide),
      floorMat: hazeMaterial(floorTexture(), 1.0, FrontSide),
    };
  }, []);
  useEffect(
    () => () => {
      wall.dispose();
      floor.dispose();
      wallMat.dispose();
      floorMat.dispose();
    },
    [wall, floor, wallMat, floorMat],
  );
  return (
    <group name="nave">
      <mesh geometry={wall} material={wallMat} renderOrder={-1000} raycast={noRaycast} />
      <mesh geometry={floor} material={floorMat} renderOrder={-999} raycast={noRaycast} />
      <Piers />
      <Shafts />
    </group>
  );
};

// --- Light ------------------------------------------------------------------------

const DEG = Math.PI / 180;

/**
 * Lights that travel with the camera, so every piece is modelled the same
 * way from any orbit and either seat: a soft key over the viewer's left
 * shoulder, candlelight from behind on the left, and cool window light from
 * behind on the right. The two back lights draw the rims that keep the
 * ebony army carved rather than flat.
 */
const CameraLights = () => {
  const key = useRef<DirectionalLight>(null);
  const candle = useRef<DirectionalLight>(null);
  const glass = useRef<DirectionalLight>(null);
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    const az = Math.atan2(camera.position.x, camera.position.z);
    const place = (light: DirectionalLight | null, azimuth: number, elevation: number) => {
      light?.position.set(
        Math.sin(azimuth) * Math.cos(elevation) * 12,
        Math.sin(elevation) * 12,
        Math.cos(azimuth) * Math.cos(elevation) * 12,
      );
    };
    place(key.current, az - 35 * DEG, 50 * DEG);
    place(candle.current, az + 180 * DEG + 50 * DEG, 22 * DEG);
    place(glass.current, az + 180 * DEG - 55 * DEG, 35 * DEG);
  });
  return (
    <>
      <directionalLight ref={key} intensity={2.3} color="#fff0de" />
      <directionalLight ref={candle} intensity={1.5} color={CANDLE} />
      <directionalLight ref={glass} intensity={1.3} color="#9fb2ff" />
    </>
  );
};

/**
 * Reflections: a dark room with tall windows of old glass all round and a
 * warm glow overhead, so gilt and ebony show long, soft, coloured
 * highlights rather than points.
 */
const Reflections = () => (
  <Environment resolution={64} frames={1}>
    <color attach="background" args={['#0a080d']} />
    <Lightformer
      form="rect"
      intensity={1.1}
      color="#ffe2b8"
      position={[0, 9, 0]}
      rotation-x={Math.PI / 2}
      scale={[8, 8, 1]}
    />
    {Array.from({ length: 10 }, (_, i) => {
      const a = (i / 10) * Math.PI * 2;
      return (
        <Lightformer
          key={i}
          form="rect"
          intensity={1.4}
          color={WINDOW[i % 5]}
          position={[Math.sin(a) * 7, 2.5, Math.cos(a) * 7]}
          scale={[1.1, 5, 1]}
          target={[0, 2.5, 0]}
        />
      );
    })}
  </Environment>
);

export const Stage = () => (
  <>
    <color attach="background" args={['#07060a']} />
    <Nave />
    <Reflections />
    <hemisphereLight args={['#8480b8', '#1c1411', 0.55]} />
    <CameraLights />
  </>
);
