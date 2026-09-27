import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { BackSide, Color, PlaneGeometry, ShaderMaterial, Vector3 } from 'three';
import type { DirectionalLight, Object3D } from 'three';
import { towerFrame } from '../kit/layouts';
import { noRaycast } from '../kit/noRaycast';
import type { StageProps } from '../types';
import { PAL } from './palette';

// The studio: a seamless warm-grey cyclorama that depends only on height, so
// it looks the same from every azimuth and both seats; softboxes that the
// glaze and lacquer reflect; and a key and rim light that travel with the
// camera, as a photographer's lights would, so no orbit finds a dark side or
// a hotspot.

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
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uLow; uniform vec3 uBottom;
      varying vec3 vDir;
      void main() {
        float h = normalize(vDir).y;
        vec3 c;
        if (h >= 0.0) {
          c = mix(uHorizon, uTop, smoothstep(0.0, 0.75, h));
        } else {
          // The paper sweeps down into a deeper floor
          c = mix(uHorizon, uLow, smoothstep(0.0, 0.35, -h));
          c = mix(c, uBottom, smoothstep(0.3, 0.95, -h));
        }
        // A whisper of grain so the long gradient never bands
        float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        c += (n - 0.5) / 255.0;
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });

// The sweep's floor, far below the tower: invisible but for the tower's soft
// shadow, so it grounds the stack like a product shot without any edge.
const floorGeometry = new PlaneGeometry(18, 18).rotateX(-Math.PI / 2);
const floorMaterial = () =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uColor: { value: new Color(PAL.floorShadow) } },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        vP = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying vec2 vP;
      void main() {
        // A rounded-square umbra under the tower inside a wide, soft penumbra
        vec2 q = abs(vP);
        float box = length(max(q - 1.6, 0.0));
        float umbra = 1.0 - smoothstep(0.0, 2.2, box);
        float penumbra = 1.0 - smoothstep(0.0, 8.0, length(vP));
        float a = 0.2 * umbra * umbra + 0.1 * penumbra * penumbra;
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor, a);
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
  const floorY = useMemo(() => towerFrame(layout).levelY[0] - 1.9, [layout]);
  const key = useRef<DirectionalLight>(null);
  const rim = useRef<DirectionalLight>(null);
  useFrame(({ camera }) => {
    // Key: up and to the right of the photographer; rim: high behind the tower
    orbitLight(key.current, camera, 38, 48);
    orbitLight(rim.current, camera, 160, 34);
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
