import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ShaderMaterial,
  TorusGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { noRaycast } from '../kit/noRaycast';
import { rng } from '../kit/textures';
import { WATER } from './palette';

// The observation room round the board, and the life drifting outside it.
//
// - The room's glass wall: twelve titanium mullions standing in a ring well
//   outside the tower on a floor ring, lost in the water with
//   distance so they frame the view without taking it.
// - A handful of bioluminescent motes drifting far out in the water, slowly
//   pulsing. They fade out wherever they would pass behind or in front of
//   the tower on screen, so nothing ever moves behind the platforms.

const WALL_RADIUS = 21;
const FLOOR_Y = -10;
const TOP_Y = 14;

const frameGeometry = () => {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
    const bar = new BoxGeometry(0.34, TOP_Y - FLOOR_Y, 0.5)
      .rotateY(-a)
      .translate(Math.sin(a) * WALL_RADIUS, (TOP_Y + FLOOR_Y) / 2, Math.cos(a) * WALL_RADIUS);
    parts.push(bar);
  }
  parts.push(
    new TorusGeometry(WALL_RADIUS, 0.45, 8, 96).rotateX(Math.PI / 2).translate(0, FLOOR_Y, 0),
  );
  const merged = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  parts.forEach((p) => p.dispose());
  return merged;
};

const frameVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const frameFragment = /* glsl */ `
  uniform vec3 uDark;
  uniform vec3 uEdge;
  uniform vec3 uTop;
  uniform vec3 uWaterHorizon;
  uniform vec3 uWaterBelow;
  uniform float uFog;
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    vec3 toEye = cameraPosition - vWorld;
    float dist = length(toEye);
    vec3 n = normalize(vNormal);
    float f = pow(1.0 - abs(dot(n, toEye / dist)), 2.0);
    vec3 c = uDark + uEdge * f + uTop * max(n.y, 0.0);
    // Lost in the water with distance, toward the water's colour behind it
    float down = clamp((cameraPosition.y - vWorld.y) / dist, 0.0, 1.0);
    vec3 water = mix(uWaterHorizon, uWaterBelow, smoothstep(0.0, 0.55, down));
    c = mix(c, water, 1.0 - exp(-dist * uFog));
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }`;

/** The room's glass wall: mullions on a floor ring. Static. */
export const RoomFrame = () => {
  const { geometry, material } = useMemo(
    () => ({
      geometry: frameGeometry(),
      material: new ShaderMaterial({
        uniforms: {
          uDark: { value: new Color('#02090c') },
          uEdge: { value: new Color('#5b7a82').multiplyScalar(0.22) },
          uTop: { value: new Color('#5b7a82').multiplyScalar(0.08) },
          uWaterHorizon: { value: new Color(WATER.horizon) },
          uWaterBelow: { value: new Color(WATER.below) },
          uFog: { value: 0.028 },
        },
        vertexShader: frameVertex,
        fragmentShader: frameFragment,
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
  return <mesh geometry={geometry} material={material} raycast={noRaycast} />;
};

// --- Motes -----------------------------------------------------------------------

const MOTES = 26;
/** Radius of a sphere holding the tower and its pieces, for the mask. */
const TOWER_RADIUS = 5.6;

const motesVertex = /* glsl */ `
  attribute vec4 aMote;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uScale;
  uniform float uTower;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float speed = aMote.x;
    float phase = aMote.y;
    // A slow wander on a small loop
    vec3 p = position + vec3(
      sin(uTime * speed + phase) * 0.9,
      sin(uTime * speed * 0.7 + phase * 1.7) * 0.5,
      cos(uTime * speed * 0.8 + phase) * 0.9
    );
    vec4 world = modelMatrix * vec4(p, 1.0);
    vec4 mv = viewMatrix * world;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = max(aMote.z * uScale / -mv.z, 1.0);
    // Never behind or in front of the tower: fade out near its direction
    vec3 toMote = normalize(world.xyz - cameraPosition);
    vec3 toTower = normalize(-cameraPosition);
    float angle = acos(clamp(dot(toMote, toTower), -1.0, 1.0));
    float tower = asin(clamp(uTower / length(cameraPosition), 0.0, 1.0));
    float mask = smoothstep(tower * 1.05, tower * 1.35, angle);
    float pulse = 0.5 + 0.5 * sin(uTime * (0.35 + speed) + phase * 3.1);
    vAlpha = mask * (0.25 + 0.75 * pulse * pulse) * aMote.w;
    vColor = aColor;
  }`;

const motesFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = (exp(-d * d * 5.0) - 0.007) * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor * a, a);
    #include <colorspace_fragment>
  }`;

// Deep teal and blue: clear of the marks' plankton white, violet and reds
const MOTE_COLORS = ['#4fb3c4', '#5d9fe0', '#3fb9a8'];

/** A few bioluminescent motes far out in the water, drifting and pulsing slowly. */
export const DistantMotes = () => {
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const camera = useThree((s) => s.camera);
  const { geometry, material } = useMemo(() => {
    const random = rng(71);
    const pos = new Float32Array(MOTES * 3);
    const mote = new Float32Array(MOTES * 4);
    const col = new Float32Array(MOTES * 3);
    const c = new Color();
    for (let i = 0; i < MOTES; i++) {
      const a = random() * Math.PI * 2;
      const r = 25 + random() * 14;
      pos.set([Math.sin(a) * r, -9 + random() * 15, Math.cos(a) * r], i * 3);
      mote.set(
        [0.05 + random() * 0.12, random() * 6.28, 0.18 + random() * 0.22, 0.4 + random() * 0.6],
        i * 4,
      );
      c.set(MOTE_COLORS[Math.floor(random() * MOTE_COLORS.length)]);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aMote', new BufferAttribute(mote, 4));
    g.setAttribute('aColor', new BufferAttribute(col, 3));
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uScale: { value: 1 },
        uTower: { value: TOWER_RADIUS },
      },
      vertexShader: motesVertex,
      fragmentShader: motesFragment,
    });
    return { geometry: g, material };
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
    const fov = 'fov' in camera ? (camera.fov as number) : 36;
    material.uniforms.uScale.value = (size.height * dpr * 0.5) / Math.tan((fov * Math.PI) / 360);
  });
  return (
    <points
      geometry={geometry}
      material={material}
      renderOrder={-900}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};
