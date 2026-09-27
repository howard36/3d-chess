import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Color, DoubleSide, ShaderMaterial } from 'three';
import { LAYER } from '../kit/layers';
import { ribbonData, tracePath } from '../kit/markerGeometry';
import type { TracePathOptions } from '../kit/markerGeometry';
import { noRaycast } from '../kit/noRaycast';
import type { Vec3 } from '../types';

// The last move's route, drawn as a plotted course: a violet ribbon with a
// thin dark outline (so it holds over ice pieces and bright glass alike),
// bright chevrons flowing gently toward the destination, and an arrowhead.
// Built on the kit's trace geometry (tracePath, ribbonData); the shading is
// this design's own, since the kit trace paints its chevrons and its outline
// in one colour (dark chevrons read as a zipper).

const vertexShader = /* glsl */ `
  attribute vec3 aTangent;
  attribute float aSide;
  attribute float aHalf;
  attribute float aAlong;
  varying float vAcross;
  varying float vHalf;
  varying float vAlong;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 t = normalize(mat3(modelMatrix) * aTangent);
    vec3 toCamera = normalize(cameraPosition - world.xyz);
    vec3 across = cross(t, toCamera);
    float l = length(across);
    across = l > 1e-4 ? across / l : vec3(1.0, 0.0, 0.0);
    world.xyz += across * aSide * aHalf;
    vAcross = aSide * aHalf;
    vHalf = aHalf;
    vAlong = aAlong;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uGlint;
  uniform vec3 uEdge;
  uniform float uEdgeWidth;
  uniform float uChevron;
  uniform float uShaftEnd;
  uniform float uFlow;
  uniform float uReveal;
  varying float vAcross;
  varying float vHalf;
  varying float vAlong;
  void main() {
    if (vAlong > uReveal) discard;
    float d = abs(vAcross);
    float aa = max(fwidth(vAcross), 1e-4);
    float body = 1.0 - smoothstep(vHalf - aa, vHalf + aa * 0.5, d);
    float rim = smoothstep(vHalf - uEdgeWidth - aa, vHalf - uEdgeWidth + aa, d);
    vec3 col = uColor;
    if (vAlong < uShaftEnd - uChevron * 0.3) {
      // Chevrons: narrow bright bands bent back at the edges, pointing ahead
      float phase = fract((vAlong - d * 1.4 - uFlow) / uChevron);
      float ab = max(fwidth(phase), 1e-4);
      float band = smoothstep(0.0, ab, phase) * (1.0 - smoothstep(0.2 - ab, 0.2, phase));
      col = mix(col, uGlint, band * 0.85);
    } else {
      // The arrowhead: a brighter core
      col = mix(col, uGlint, 0.3 * (1.0 - d / max(vHalf, 1e-3)));
    }
    col = mix(col, uEdge, rim);
    if (body < 0.003) discard;
    gl_FragColor = vec4(col, body);
    #include <colorspace_fragment>
  }`;

export interface RouteProps extends TracePathOptions {
  from: Vec3;
  to: Vec3;
  color: string;
  glint: string;
  edge: string;
  width?: number;
  headLength?: number;
  headWidth?: number;
  /** Distance between chevrons (world units). */
  chevrons?: number;
  /** How fast the chevrons drift toward the destination (world units a second). */
  flowSpeed?: number;
  /** Draw the route in from its source over this long on mount (0: all at once). */
  drawInMs?: number;
  /** Wait this long after mount before drawing in. */
  drawInDelayMs?: number;
}

const ALL = 1e6;

/** The last move's route between two cell floors, flowing toward `to`. */
export const Route = ({
  from,
  to,
  color,
  glint,
  edge,
  width = 0.1,
  headLength = 0.4,
  headWidth = 0.36,
  chevrons = 0.4,
  flowSpeed = 0.3,
  drawInMs = 0,
  drawInDelayMs = 0,
  ...pathOptions
}: RouteProps) => {
  const invalidate = useThree((s) => s.invalidate);
  // How much of the route is drawn, from its source (world units), as time:
  // the reveal starts below zero while it waits
  const since = useRef(drawInMs > 0 ? -drawInDelayMs : Infinity);
  const key = JSON.stringify([from, to, width, headLength, headWidth, pathOptions]);
  const { geometry, shaftEnd, length } = useMemo(() => {
    const data = ribbonData(tracePath(from, to, pathOptions), { width, headLength, headWidth });
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(data.position, 3));
    g.setAttribute('aTangent', new BufferAttribute(data.tangent, 3));
    g.setAttribute('aSide', new BufferAttribute(data.side, 1));
    g.setAttribute('aHalf', new BufferAttribute(data.halfWidth, 1));
    g.setAttribute('aAlong', new BufferAttribute(data.along, 1));
    g.setIndex(data.index);
    g.computeBoundingSphere();
    return {
      geometry: g,
      shaftEnd: data.length - Math.min(headLength, data.length * 0.6),
      length: data.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the values themselves
  }, [key]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        uniforms: {
          uColor: { value: new Color() },
          uGlint: { value: new Color() },
          uEdge: { value: new Color() },
          uEdgeWidth: { value: 0.02 },
          uChevron: { value: 0.4 },
          uShaftEnd: { value: 1 },
          uFlow: { value: 0 },
          uReveal: { value: ALL },
        },
        vertexShader,
        fragmentShader,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const u = material.uniforms;
  (u.uColor.value as Color).set(color);
  (u.uGlint.value as Color).set(glint);
  (u.uEdge.value as Color).set(edge);
  u.uEdgeWidth.value = Math.min(width * 0.16, 0.018);
  u.uChevron.value = chevrons;
  u.uShaftEnd.value = shaftEnd;
  // Hidden until the draw-in starts (the first frame sets the reveal)
  if (since.current < 0) u.uReveal.value = -1;

  useEffect(() => invalidate(), [invalidate]);
  useFrame((state, delta) => {
    if (since.current < drawInMs) {
      since.current += Math.min(delta, 1 / 20) * 1000;
      const k = since.current / drawInMs;
      // Eased out: the route shoots from the source and settles onto the target
      u.uReveal.value = k < 0 ? -1 : k >= 1 ? ALL : (1 - (1 - k) ** 2) * length;
      invalidate();
    }
    if (flowSpeed === 0) return;
    u.uFlow.value = state.clock.elapsedTime * flowSpeed;
    invalidate();
  });

  return (
    <mesh
      geometry={geometry}
      material={material}
      renderOrder={LAYER.trace}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};
