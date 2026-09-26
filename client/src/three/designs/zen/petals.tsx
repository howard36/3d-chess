import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  MeshStandardMaterial,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  Vector3,
} from 'three';
import { noRaycast } from '../kit/noRaycast';
import { rng } from '../kit/textures';
import type { Vec3 } from '../types';

// Sakura petals: one small cupped petal mesh, drawn hundreds of times. The
// drifting field is animated entirely in its vertex shader; the same petal
// is used for the scattered and celebratory bursts (kit Shards).

/** A five-petal cherry blossom's single petal, notched at the tip and gently cupped. */
export const petalGeometry = (() => {
  const s = new Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.34, 0.12, 0.46, 0.66, 0.24, 1);
  s.lineTo(0, 0.86);
  s.lineTo(-0.24, 1);
  s.bezierCurveTo(-0.46, 0.66, -0.34, 0.12, 0, 0);
  const g = new ShapeGeometry(s, 8);
  g.translate(0, -0.5, 0);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    p.setZ(i, -0.35 * x * x + 0.08 * y * y);
  }
  g.scale(0.11, 0.11, 0.11);
  g.computeVertexNormals();
  return g;
})();

/** Petals for Shards: lit, two-sided, tinted per instance. */
export const petalMaterial = new MeshStandardMaterial({
  color: '#ffffff',
  roughness: 0.65,
  side: DoubleSide,
  emissive: new Color('#f7c9d2'),
  emissiveIntensity: 0.25,
});

export const PETAL_COLORS = ['#f9d3dc', '#f4b6c5', '#fbe4e8', '#efa3b6', '#fdf0f2'];

/**
 * Petals drifting down through a box around the tower on a slow breeze,
 * tumbling as they fall. Wrapping inside the box, the fall never ends.
 */
export const PetalField = ({
  count = 260,
  box = [16, 14, 16] as Vec3,
  centre = [0, 0, 0] as Vec3,
  wind = [0.28, -0.32, 0.12] as Vec3,
  light = [-0.5, 0.8, 0.4] as Vec3,
  seed = 12,
}) => {
  const { geometry, material } = useMemo(() => {
    const random = rng(seed);
    const g = new InstancedBufferGeometry();
    g.index = petalGeometry.index;
    g.setAttribute('position', petalGeometry.getAttribute('position'));
    g.setAttribute('normal', petalGeometry.getAttribute('normal'));
    const offset = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const c = new Color();
    for (let i = 0; i < count; i++) {
      offset.set(
        [(random() - 0.5) * box[0], (random() - 0.5) * box[1], (random() - 0.5) * box[2]],
        i * 3,
      );
      seeds[i] = random();
      c.set(PETAL_COLORS[Math.floor(random() * PETAL_COLORS.length)]);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('aOffset', new InstancedBufferAttribute(offset, 3));
    g.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 1));
    g.setAttribute('aColor', new InstancedBufferAttribute(colors, 3));
    g.instanceCount = count;
    const material = new ShaderMaterial({
      side: DoubleSide,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uBox: { value: new Vector3(...box) },
        uWind: { value: new Vector3(...wind) },
        uLight: { value: new Vector3(...light).normalize() },
      },
      vertexShader: /* glsl */ `
        uniform float uTime; uniform vec3 uBox; uniform vec3 uWind; uniform vec3 uLight;
        attribute vec3 aOffset; attribute float aSeed; attribute vec3 aColor;
        varying vec3 vColor; varying float vAlpha;
        mat3 turn(vec3 axis, float a) {
          float s = sin(a); float c = cos(a); float oc = 1.0 - c;
          return mat3(
            oc * axis.x * axis.x + c, oc * axis.x * axis.y + axis.z * s, oc * axis.z * axis.x - axis.y * s,
            oc * axis.x * axis.y - axis.z * s, oc * axis.y * axis.y + c, oc * axis.y * axis.z + axis.x * s,
            oc * axis.z * axis.x + axis.y * s, oc * axis.y * axis.z - axis.x * s, oc * axis.z * axis.z + c);
        }
        void main() {
          float speed = 0.65 + 0.7 * aSeed;
          vec3 axis = normalize(vec3(sin(aSeed * 12.1), 0.6 + cos(aSeed * 7.3), sin(aSeed * 3.7 + 1.0)));
          mat3 r = turn(axis, uTime * (1.2 + 1.8 * aSeed) + aSeed * 6.283);
          vec3 c = aOffset + uWind * uTime * speed;
          c.x += sin(uTime * 0.7 + aSeed * 31.0) * 0.45;
          c.z += cos(uTime * 0.5 + aSeed * 17.0) * 0.35;
          c = mod(c + uBox * 0.5, uBox) - uBox * 0.5;
          // Fade near the box's faces, so wrapping never pops
          vec3 edge = 1.0 - smoothstep(0.36, 0.5, abs(c) / uBox);
          vAlpha = edge.x * edge.y * edge.z;
          vec3 n = normalize(r * normal);
          float lit = 0.62 + 0.38 * abs(dot(n, uLight));
          vColor = aColor * lit;
          vec4 mv = modelViewMatrix * vec4(c + r * position, 1.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying float vAlpha;
        void main() {
          gl_FragColor = vec4(vColor, vAlpha * 0.95);
          #include <colorspace_fragment>
        }`,
    });
    return { geometry: g, material };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a petal field is configured once
  }, []);

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <mesh
      geometry={geometry}
      material={material}
      position={centre}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};
