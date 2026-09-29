import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Color, ShaderMaterial } from 'three';
import { LAYER } from './layers';
import { pathDistances, tracePath, tubeData } from './markerGeometry';
import type { TracePathOptions } from './markerGeometry';
import { noRaycast } from '../noRaycast';
import type { Vec3 } from '../types';

// The last move's line: a thin tube of real geometry from the centre of the
// source square's floor to the centre of the destination's, drawn in from the
// source when the move is fresh. No arrowhead: the destination's own marker
// says where the move ended. The line is depth-tested like any solid, and
// drawn after the platforms and markers, so pieces hide it where it passes
// behind them; with an `inset` (TracePathOptions) it lands on the
// destination's floor beside the piece standing there rather than running
// into it.

interface LineStyle extends TracePathOptions {
  color: string;
  opacity: number;
  /** Radius of the tube (world units). Thin: the line should not take much room. */
  radius: number;
  /**
   * Draw the line in from its source over this long when it mounts (0: all
   * at once). Pass it only for a fresh move (LastMoveMarkerProps.fresh).
   */
  drawInMs?: number;
  /** Wait this long after mounting before drawing in. */
  drawInDelayMs?: number;
}

/** How much darker the tube's sides are than its middle, so it reads as round. */
const SHADE = 0.3;

// A reveal past any line's length: the whole line
const ALL = 1e6;

const tubeGeometry = (points: Vec3[], radius: number) => {
  const data = tubeData(points, { radius });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(data.position, 3));
  g.setAttribute('normal', new BufferAttribute(data.normal, 3));
  g.setAttribute('aAlong', new BufferAttribute(data.along, 1));
  g.setIndex(new BufferAttribute(data.index, 1));
  g.computeBoundingSphere();
  return g;
};

const vertexShader = /* glsl */ `
  attribute float aAlong;
  varying float vAlong;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vAlong = aAlong;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vView = cameraPosition - world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uShade;
  uniform float uReveal;
  varying float vAlong;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    if (vAlong > uReveal) discard;
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    vec3 col = uColor * (1.0 - uShade + uShade * facing);
    gl_FragColor = vec4(col, uOpacity);
    #include <colorspace_fragment>
  }`;

const lineMaterial = () =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new Color() },
      uOpacity: { value: 1 },
      uShade: { value: SHADE },
      uReveal: { value: ALL },
    },
    vertexShader,
    fragmentShader,
  });

/**
 * The last move's line between two cell floors (MarkerProps.floor). See
 * LineStyle for the look.
 */
export const LastMoveLine = ({
  from,
  to,
  color,
  opacity,
  radius,
  drawInMs = 0,
  drawInDelayMs = 0,
  lift = radius + 0.012,
  inset = 0,
  insetFront,
}: LineStyle & { from: Vec3; to: Vec3 }) => {
  const invalidate = useThree((s) => s.invalidate);

  const key = JSON.stringify([from, to, lift, radius, inset, insetFront]);
  const { geometry, length } = useMemo(() => {
    const points = tracePath(from, to, { lift, inset, insetFront });
    const distances = pathDistances(points);
    const length = distances[distances.length - 1];
    const geometry = tubeGeometry(points, radius);
    return { geometry, length };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the values themselves
  }, [key]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = useMemo(lineMaterial, []);
  useEffect(() => () => material.dispose(), [material]);
  const u = material.uniforms;
  (u.uColor.value as Color).set(color);
  u.uOpacity.value = opacity;

  // How much of the line is drawn, from its source, as time since mounting
  // (below zero while it waits to start)
  const since = useRef(drawInMs > 0 ? -drawInDelayMs : Infinity);
  const reveal = () => {
    if (since.current >= drawInMs) return ALL;
    const k = since.current / drawInMs;
    return k < 0 ? -1 : (1 - (1 - k) ** 2) * length;
  };
  u.uReveal.value = reveal();
  useEffect(() => invalidate(), [invalidate]);

  useFrame((_, delta) => {
    if (since.current >= drawInMs) return;
    since.current += Math.min(delta, 1 / 20) * 1000;
    u.uReveal.value = reveal();
    invalidate();
  });

  return (
    <mesh
      geometry={geometry}
      material={material}
      renderOrder={LAYER.trace + 0.1}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};
