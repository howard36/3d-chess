import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  ShaderMaterial,
} from 'three';
import { noRaycast } from './noRaycast';
import { dotTexture, rng } from './textures';

/**
 * A backdrop sphere shaded top to bottom through three colours, seen from
 * inside. `exponent` shapes how quickly the horizon colour gives way. Drawn
 * behind everything and ignored by fog.
 */
export const GradientSky = ({
  top,
  horizon,
  bottom,
  exponent = 0.8,
  radius = 80,
}: {
  top: string;
  horizon: string;
  bottom: string;
  exponent?: number;
  radius?: number;
}) => {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTop: { value: new Color(top) },
          uHorizon: { value: new Color(horizon) },
          uBottom: { value: new Color(bottom) },
          uExp: { value: exponent },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom; uniform float uExp;
          varying vec3 vDir;
          void main() {
            float h = vDir.y;
            vec3 c = h > 0.0
              ? mix(uHorizon, uTop, pow(h, uExp))
              : mix(uHorizon, uBottom, pow(-h, uExp));
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    [top, horizon, bottom, exponent],
  );
  return (
    <mesh material={material} raycast={noRaycast} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[radius, 32, 16]} />
    </mesh>
  );
};

/**
 * A shell of twinkling stars around the scene. `colors` are picked from at
 * random per star.
 */
export const Starfield = ({
  count = 1500,
  radius = 60,
  size = 1.4,
  colors = ['#ffffff', '#cfe0ff', '#ffe6c7'],
  seed = 7,
  twinkle = 1,
}: {
  count?: number;
  radius?: number;
  size?: number;
  colors?: string[];
  seed?: number;
  twinkle?: number;
}) => {
  const { geometry, material } = useMemo(() => {
    const random = rng(seed);
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const scale = new Float32Array(count);
    const phase = new Float32Array(count);
    const c = new Color();
    for (let i = 0; i < count; i++) {
      // Uniform on a sphere, with a little depth to the shell
      const u = random() * 2 - 1;
      const t = random() * Math.PI * 2;
      const r = radius * (0.8 + random() * 0.2);
      const s = Math.sqrt(1 - u * u);
      pos.set([r * s * Math.cos(t), r * u, r * s * Math.sin(t)], i * 3);
      c.set(colors[Math.floor(random() * colors.length)]);
      col.set([c.r, c.g, c.b], i * 3);
      scale[i] = 0.3 + random() ** 4 * 2.2;
      phase[i] = random() * 100;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(pos, 3));
    geometry.setAttribute('color', new BufferAttribute(col, 3));
    geometry.setAttribute('aScale', new BufferAttribute(scale, 1));
    geometry.setAttribute('aPhase', new BufferAttribute(phase, 1));
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: size },
        uTwinkle: { value: twinkle },
        uMap: { value: dotTexture(0.7) },
        uDpr: { value: 1 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime; uniform float uSize; uniform float uTwinkle; uniform float uDpr;
        attribute float aScale; attribute float aPhase;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = 1.0 - uTwinkle * 0.5 * (0.5 + 0.5 * sin(uTime * (1.0 + fract(aPhase) * 2.0) + aPhase));
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uSize * aScale * uDpr * 2.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(vColor, t.a * vAlpha);
          #include <colorspace_fragment>
        }`,
      vertexColors: true,
    });
    return { geometry, material };
  }, [count, radius, size, colors, seed, twinkle]);

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
    material.uniforms.uDpr.value = state.viewport.dpr;
  });

  return (
    <points
      geometry={geometry}
      material={material}
      raycast={noRaycast}
      frustumCulled={false}
      renderOrder={-999}
    />
  );
};
