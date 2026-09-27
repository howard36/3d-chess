import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { BackSide, CircleGeometry, Color, ShaderMaterial, Vector3 } from 'three';
import type { DirectionalLight, Object3D } from 'three';
import { towerFrame } from '../kit/layouts';
import { noRaycast } from '../kit/noRaycast';
import type { StageProps } from '../types';
import { PAL } from './palette';

// The studio: a seamless warm-grey cyclorama sweeping down into a floor far
// below the tower; softboxes that the glaze and lacquer reflect; and a key
// and rim light that travel with the camera, as a photographer's lights
// would, so no orbit finds a dark side or a hotspot. The dome's warm key
// falloff (bright at the view's upper left, deeper at its lower right)
// travels with the camera too, so the backdrop is the same from every
// azimuth and both seats. Everything here is still: nothing moves, idle.

const skyMaterial = () =>
  new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new Color(PAL.skyTop) },
      uHorizon: { value: new Color(PAL.skyHorizon) },
      uLow: { value: new Color(PAL.skyLow) },
      uBottom: { value: new Color(PAL.skyBottom) },
      uWarm: { value: new Color(PAL.keyWarm) },
      uCool: { value: new Color(PAL.keyCool) },
      uForward: { value: new Vector3(0, 0, -1) },
      uLeft: { value: new Vector3(-1, 0, 0) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uLow; uniform vec3 uBottom;
      uniform vec3 uWarm; uniform vec3 uCool; uniform vec3 uForward; uniform vec3 uLeft;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 c;
        if (h >= 0.0) {
          c = mix(uHorizon, uTop, smoothstep(0.0, 0.75, h));
        } else {
          // The paper sweeps down toward the floor
          c = mix(uHorizon, uLow, smoothstep(0.0, 0.3, -h));
          c = mix(c, uBottom, smoothstep(0.3, 0.95, -h));
        }
        // The key's falloff across the view, upper left to lower right
        float across = dot(d, uLeft) * 0.8 + h * 0.6;
        float facing = smoothstep(-0.2, 0.4, dot(d, uForward));
        vec3 key = mix(uCool, uWarm, smoothstep(-0.45, 0.55, across));
        c = mix(c, key, 0.5 * facing);
        // Dither, so the long gradients never band
        float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        float m = fract(sin(dot(gl_FragCoord.xy, vec2(39.3468, 11.135))) * 24634.6345);
        c += (n + m - 1.0) * (2.0 / 255.0);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });

// The sweep's floor, about three units below level A: a warm pool of light
// under the tower, the tower's soft shadow in it, and a fade into the dome at
// its far edge, so there is never a horizon line.
const floorGeometry = new CircleGeometry(70, 96).rotateX(-Math.PI / 2);
const floorMaterial = () =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uFloor: { value: new Color(PAL.floor) },
      uPool: { value: new Color(PAL.floorPool) },
      uShadow: { value: new Color(PAL.floorShadow) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        vP = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uFloor; uniform vec3 uPool; uniform vec3 uShadow;
      varying vec2 vP;
      void main() {
        float r = length(vP);
        vec3 c = mix(uPool, uFloor, smoothstep(2.0, 15.0, r));
        // A soft, rounded shadow of the stack, darkest under its middle
        vec2 q = abs(vP);
        float box = length(max(q - 1.7, 0.0));
        float umbra = 1.0 - smoothstep(0.0, 2.6, box);
        c = mix(c, uShadow, 0.32 * umbra * umbra);
        float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        c += (n - 0.5) * (2.0 / 255.0);
        // Into the dome, far away
        float a = 1.0 - smoothstep(22.0, 60.0, r);
        gl_FragColor = vec4(c, a);
        #include <colorspace_fragment>
      }`,
  });

const DEG = Math.PI / 180;
const target = new Vector3();

/** Places `light` at an offset from the camera's azimuth, aimed at the tower's centre. */
const orbitLight = (
  light: DirectionalLight | null,
  camera: Object3D,
  azimuthOffset: number,
  elevation: number,
  distance = 12,
) => {
  if (!light) return;
  const az = Math.atan2(camera.position.x, camera.position.z) + azimuthOffset * DEG;
  const el = elevation * DEG;
  light.position.set(
    Math.sin(az) * Math.cos(el) * distance,
    Math.sin(el) * distance,
    Math.cos(az) * Math.cos(el) * distance,
  );
  light.target.position.copy(target);
  light.target.updateMatrixWorld();
};

export const Stage = ({ layout }: StageProps) => {
  const sky = useMemo(skyMaterial, []);
  const floor = useMemo(floorMaterial, []);
  const floorY = useMemo(() => towerFrame(layout).levelY[0] - 3, [layout]);
  const key = useRef<DirectionalLight>(null);
  const rim = useRef<DirectionalLight>(null);
  useFrame(({ camera }) => {
    // Key: up and to the right of the photographer; rim: high behind the tower
    orbitLight(key.current, camera, 38, 48);
    orbitLight(rim.current, camera, 160, 34);
    // The dome's key falloff is framed by the view, level with the floor
    const u = sky.uniforms;
    camera.getWorldDirection(u.uForward.value as Vector3);
    (u.uForward.value as Vector3).setY(0).normalize();
    const f = u.uForward.value as Vector3;
    (u.uLeft.value as Vector3).set(f.z, 0, -f.x);
  });
  return (
    <>
      <mesh material={sky} raycast={noRaycast} renderOrder={-1000} frustumCulled={false}>
        <sphereGeometry args={[90, 48, 24]} />
      </mesh>
      <mesh
        geometry={floorGeometry}
        material={floor}
        position={[0, floorY, 0]}
        raycast={noRaycast}
        renderOrder={-900}
      />
      {/* Reflections: a dark studio (so glaze and lacquer keep a defined
          edge against the light backdrop) lit by broad softboxes */}
      <Environment resolution={128} frames={1}>
        <color attach="background" args={['#3a3733']} />
        <Lightformer
          form="rect"
          intensity={2.2}
          color="#fff6ea"
          position={[0, 9, 0]}
          rotation-x={Math.PI / 2}
          scale={[12, 12, 1]}
        />
        <Lightformer
          form="rect"
          intensity={1.3}
          color="#f4f1ec"
          position={[-8, 2.5, 3]}
          target={[0, 0, 0]}
          scale={[3.5, 9, 1]}
        />
        <Lightformer
          form="rect"
          intensity={1.1}
          color="#eef2fa"
          position={[8, 2.5, -3]}
          target={[0, 0, 0]}
          scale={[3.5, 9, 1]}
        />
        <Lightformer
          form="rect"
          intensity={0.8}
          color="#fff4e4"
          position={[0, 1.5, 9]}
          target={[0, 0, 0]}
          scale={[10, 3, 1]}
        />
        <Lightformer
          form="rect"
          intensity={0.8}
          color="#fff4e4"
          position={[0, 1.5, -9]}
          target={[0, 0, 0]}
          scale={[10, 3, 1]}
        />
        {/* A pale floor bounce */}
        <Lightformer
          form="rect"
          intensity={0.35}
          color="#d8d0c4"
          position={[0, -7, 0]}
          rotation-x={-Math.PI / 2}
          scale={[20, 20, 1]}
        />
      </Environment>
      <hemisphereLight args={['#fffaf1', '#8a8177', 0.72]} />
      <directionalLight ref={key} intensity={2.5} color="#fff3e2" />
      <directionalLight ref={rim} intensity={1.5} color="#e9f0ff" />
    </>
  );
};
