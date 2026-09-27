import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  ShaderMaterial,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { noRaycast } from '../kit/noRaycast';

// The bay's great window, far round the tower: the planet is seen through
// a round floor window, a cupola's frame of eight struts radiating from its
// rim to a second ring, and high above the horizon the rim where the
// ceiling begins. Dark metal caught only at its edges by the light inside
// the bay. All of it lies well below or above the tower from the low
// playing views; where a high view (40–75°) puts a strut behind the board,
// the strut steps back to a dark silhouette. It is the same from every side,
// and frames the planet in a bird's-eye view.

const DEG = Math.PI / 180;
const RADIUS = 52;
/** Elevations (from the tower) of the window's inner and outer rings, and of the ceiling's rim. */
const INNER = -64 * DEG;
const OUTER = -40 * DEG;
const CEILING = 12 * DEG;
const STRUTS = 8;
/** The tower's bounding sphere (see the sky's mask in stage.tsx). */
const TOWER_RADIUS = 5.4;

const vertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

// How far a point of the backdrop lies behind the tower as seen from the
// camera (1 behind it, 0 clear of it): the same mask as the sky's
const behindTower = /* glsl */ `
  uniform float uTowerRadius;
  float behindTower(vec3 world) {
    vec3 d = normalize(world - cameraPosition);
    float toTower = max(length(cameraPosition), 1e-4);
    float off = acos(clamp(dot(d, -cameraPosition / toTower), -1.0, 1.0));
    float span = asin(clamp(uTowerRadius / toTower, 0.0, 1.0));
    return 1.0 - smoothstep(span * 0.8, span * 1.3, off);
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uBase;
  uniform vec3 uEdge;
  varying vec3 vNormal;
  varying vec3 vWorld;
  ${behindTower}
  void main() {
    vec3 v = normalize(cameraPosition - vWorld);
    vec3 n = normalize(vNormal);
    float facing = abs(dot(n, v));
    // Lit a little from the bay (toward the centre) and at the grazing edges
    float inward = max(dot(n, normalize(-vWorld)), 0.0);
    // Seen through the decks from high up, the struts step back to silhouettes
    float behind = behindTower(vWorld);
    vec3 col = uBase * (0.55 + 0.45 * inward) * (1.0 - 0.3 * behind)
      + uEdge * pow(1.0 - facing, 4.0) * (1.0 - 0.7 * behind);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const at = (azimuth: number, elevation: number) =>
  new Vector3(
    Math.sin(azimuth) * Math.cos(elevation) * RADIUS,
    Math.sin(elevation) * RADIUS,
    Math.cos(azimuth) * Math.cos(elevation) * RADIUS,
  );

const ring = (el: number, tube: number) =>
  new TorusGeometry(Math.cos(el) * RADIUS, tube, 6, 160)
    .rotateX(Math.PI / 2)
    .translate(0, Math.sin(el) * RADIUS, 0);

const strut = (azimuth: number) => {
  const points = Array.from({ length: 9 }, (_, k) =>
    at(azimuth, INNER + ((OUTER - INNER) * k) / 8),
  );
  return new TubeGeometry(new CatmullRomCurve3(points), 16, 0.55, 6, false);
};

export const Station = () => {
  const { geometry, material } = useMemo(() => {
    const parts: BufferGeometry[] = [ring(INNER, 0.8), ring(OUTER, 0.65), ring(CEILING, 0.7)];
    for (let i = 0; i < STRUTS; i++) parts.push(strut(((i + 0.5) * 2 * Math.PI) / STRUTS));
    const geometry = mergeGeometries(parts.map((p) => p.toNonIndexed()));
    parts.forEach((p) => p.dispose());
    const material = new ShaderMaterial({
      fog: false,
      uniforms: {
        uBase: { value: new Color('#070a10') },
        uEdge: { value: new Color('#26344a') },
        uTowerRadius: { value: TOWER_RADIUS },
      },
      vertexShader: vertex,
      fragmentShader: fragment,
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
  return (
    <>
      <mesh
        geometry={geometry}
        material={material}
        renderOrder={-998}
        raycast={noRaycast}
        frustumCulled={false}
      />
      <RunningLights />
    </>
  );
};

const lightVertex = /* glsl */ `
  attribute float aSize;
  uniform float uDpr;
  varying float vBehind;
  ${behindTower}
  void main() {
    vBehind = behindTower((modelMatrix * vec4(position, 1.0)).xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uDpr;
  }`;

const lightFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vBehind;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float a = exp(-dot(q, q) * 3.5) * (1.0 - 0.8 * vBehind);
    if (a < 0.02) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }`;

/**
 * Small steady lights along the ceiling's rim and the window's outer ring,
 * as a station's structure is picked out at night: they give the bay its
 * scale. Dim and static.
 */
const RunningLights = () => {
  const dpr = useThree((s) => s.viewport.dpr);
  const { geometry, material } = useMemo(() => {
    const pos: number[] = [];
    const size: number[] = [];
    const add = (el: number, count: number, px: number, inset: number) => {
      for (let i = 0; i < count; i++) {
        const p = at(((i + 0.25) * 2 * Math.PI) / count, el).multiplyScalar(inset);
        pos.push(p.x, p.y, p.z);
        size.push(px);
      }
    };
    add(CEILING, 72, 3, 0.975);
    add(OUTER, 32, 3.5, 0.97);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geometry.setAttribute('aSize', new BufferAttribute(new Float32Array(size), 1));
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: {
        uColor: { value: new Color('#b89a74') },
        uDpr: { value: 1 },
        uTowerRadius: { value: TOWER_RADIUS },
      },
      vertexShader: lightVertex,
      fragmentShader: lightFragment,
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
      renderOrder={-997}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};
