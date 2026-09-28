import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  GreaterDepth,
  InstancedMesh,
  Matrix4,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import { prefersReducedMotion } from '../../motion';
import { LAYER } from './layers';
import { pathDistances, pointAlong, tracePath, tubeData } from './markerGeometry';
import type { TracePathOptions } from './markerGeometry';
import { noRaycast } from './noRaycast';
import type { Vec3 } from '../types';

// The last move's line: a thin tube of real geometry from the centre of the
// source square's floor to the centre of the destination's, straight (or a
// knight's arc, when knights arc), with a calm flow along it from source to
// destination. No arrowhead: the destination's own marker says where the move
// ended. The line is depth-tested like any solid, and drawn after the
// platforms and markers.
//
// The piece standing on the destination would hide the end of the line, and
// a line that comes down onto it (from a level above, from behind it or
// straight down, or over a knight's arc) would then seem to end at the
// piece's head, above the square. So the stretch the piece hides, inside the
// column the piece stands in, shows through it, fainter (`throughPiece`):
// the line always visibly reaches the centre of the destination's floor.

export type LinePattern = 'solid' | 'dashed' | 'dotted';

export interface LineStyle extends Omit<TracePathOptions, 'arc'> {
  color?: string;
  /** Colour the flow brightens toward (default: `color` lifted toward white). */
  pulseColor?: string;
  opacity?: number;
  /** Radius of the tube (world units). Thin: the line should not take much room. */
  radius?: number;
  /**
   * 'solid': a soft pulse drifts along the line. 'dashed': the dashes drift,
   * each brightening toward its front. 'dotted': a row of small beads drifts.
   */
  pattern?: LinePattern;
  /** Speed of the flow toward the destination, world units a second (0: still). */
  flowSpeed?: number;
  /**
   * Contrast of the flow, 0–1: how far the pulse brightens the line toward
   * `pulseColor` (solid), or how much brighter a dash's front is than its
   * back (dashed).
   */
  pulse?: number;
  /** Length of the solid line's pulse (world units). */
  pulseLength?: number;
  /** Distance between pulses, dashes or beads (world units). */
  spacing?: number;
  /** Share of each spacing a dash fills (dashed). */
  dash?: number;
  /** Radius of a bead (dotted; default twice the tube's radius). */
  beadRadius?: number;
  /** How much darker the tube's sides are than its middle, so it reads as round (0: flat). */
  shade?: number;
  /**
   * A thin keyline round the tube in this colour (solid and dashed), for a
   * line that must hold on any background or a drawn, inked look.
   */
  outline?: string;
  /** Width of the keyline (world units; default 0.6 of the radius). */
  outlineWidth?: number;
  /** Vertices round the tube. */
  radialSegments?: number;
  /**
   * Draw the line in from its source over this long when it mounts (0: all
   * at once). Pass it only for a fresh move (LastMoveMarkerProps.fresh).
   */
  drawInMs?: number;
  /** Wait this long after mounting before drawing in. */
  drawInDelayMs?: number;
  /**
   * How strongly the end of the line shows through the piece standing on the
   * destination, as a share of `opacity` (0: the piece hides it). Only the
   * stretch inside that piece's column shows through, and only where
   * something hides it.
   */
  throughPiece?: number;
}

/** The kit's defaults, for designs that want to start from them. */
export const LINE_DEFAULTS = {
  color: '#4cc9f0',
  opacity: 0.95,
  radius: 0.018,
  pattern: 'solid',
  flowSpeed: 0.6,
  pulse: 0.5,
  pulseLength: 0.3,
  shade: 0.35,
  dash: 0.55,
  throughPiece: 0.55,
} as const satisfies LineStyle;

/**
 * The column a piece stands in, about the centre of its square's floor
 * (world units): wider and taller than any piece at the kit's scales (0.27
 * and 0.87 at scale 1, 0.8 in the tower designs) lifted off its floor, and
 * well short of the level above (a gap of 1.35 or more).
 */
export const PIECE_COLUMN = { radius: 0.3, height: 1 } as const;

const SPACING: Record<LinePattern, number> = { solid: 1.6, dashed: 0.16, dotted: 0.14 };
// A reveal past any line's length: the whole line
const ALL = 1e6;

const tubeGeometry = (points: Vec3[], radius: number, radialSegments: number) => {
  const data = tubeData(points, { radius, radialSegments });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(data.position, 3));
  g.setAttribute('normal', new BufferAttribute(data.normal, 3));
  g.setAttribute('aAlong', new BufferAttribute(data.along, 1));
  g.setIndex(new BufferAttribute(data.index, 1));
  g.computeBoundingSphere();
  return g;
};

const lineMaterial = (clock: { value: number }) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      // Above 0, the see-through pass: only inside the destination's column
      // (uColumn, the floor's centre; uColumnSize, radius and height), at this
      // share of the opacity
      uThrough: { value: 0 },
      uColumn: { value: new Vector3() },
      uColumnSize: { value: new Vector2(PIECE_COLUMN.radius, PIECE_COLUMN.height) },
      uColor: { value: new Color() },
      uPulseColor: { value: new Color() },
      uOpacity: { value: 1 },
      uShade: { value: 0.35 },
      uTime: clock,
      uFlow: { value: 0 },
      uPulse: { value: 0 },
      uPulseLength: { value: 0.3 },
      uSpacing: { value: 1 },
      uDash: { value: 0.5 },
      uReveal: { value: ALL },
      uPattern: { value: 0 },
    },
    vertexShader,
    fragmentShader,
  });

/**
 * The see-through pass of `line`: the same line (it shares every uniform but
 * its own three), drawn only where something hides it (GreaterDepth) inside
 * the destination's column.
 */
const throughMaterial = (line: ShaderMaterial, clock: { value: number }) => {
  const m = lineMaterial(clock);
  m.uniforms = {
    ...line.uniforms,
    uThrough: { value: 0 },
    uColumn: { value: new Vector3() },
    uColumnSize: { value: new Vector2(PIECE_COLUMN.radius, PIECE_COLUMN.height) },
  };
  m.depthFunc = GreaterDepth;
  return m;
};

const vertexShader = /* glsl */ `
  attribute float aAlong;
  varying float vAlong;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vWorld;
  void main() {
    mat4 model = modelMatrix;
    #ifdef USE_INSTANCING
      model = modelMatrix * instanceMatrix;
    #endif
    vec4 world = model * vec4(position, 1.0);
    #ifdef USE_INSTANCING
      vAlong = 0.0;
    #else
      vAlong = aAlong;
    #endif
    vNormal = normalize(mat3(model) * normal);
    vView = cameraPosition - world.xyz;
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uPulseColor;
  uniform float uOpacity;
  uniform float uShade;
  uniform float uTime;
  uniform float uFlow;
  uniform float uPulse;
  uniform float uPulseLength;
  uniform float uSpacing;
  uniform float uDash;
  uniform float uReveal;
  uniform int uPattern;
  uniform float uThrough;
  uniform vec3 uColumn;
  uniform vec2 uColumnSize;
  varying float vAlong;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vWorld;
  void main() {
    if (vAlong > uReveal) discard;
    if (uThrough > 0.0) {
      vec3 c = vWorld - uColumn;
      if (length(c.xz) > uColumnSize.x || c.y > uColumnSize.y || c.y < -uColumnSize.x) discard;
    }
    // Position within the repeating flow, moving toward the destination
    float phase = (vAlong - uTime * uFlow) / uSpacing;
    float f = fract(phase);
    float a = uOpacity;
    float glow = 0.0;
    if (uPattern == 1) {
      // Dashes centred in each period, antialiased along the line, each
      // brightening toward its front
      float d = abs(f - 0.5) - uDash * 0.5;
      float aa = max(fwidth(phase), 1e-4);
      float on = 1.0 - smoothstep(-aa, aa, d);
      if (on < 0.01) discard;
      a *= on;
      glow = uPulse * clamp((f - 0.5 + uDash * 0.5) / max(uDash, 1e-3), 0.0, 1.0);
    } else if (uPattern == 0) {
      // One soft pulse per period
      float x = (f - 0.5) * uSpacing / max(uPulseLength, 1e-3);
      glow = uPulse * exp(-x * x * 4.0);
    }
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    vec3 col = uColor * (1.0 - uShade + uShade * facing);
    col = mix(col, uPulseColor, glow);
    if (uThrough > 0.0) a *= uThrough;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }`;

const PATTERN_ID: Record<LinePattern, number> = { solid: 0, dashed: 1, dotted: 2 };
const bead = new SphereGeometry(1, 12, 8);
const matrix = new Matrix4();
const WHITE = new Color('#ffffff');
/**
 * The last move's line between two cell floors (MarkerProps.floor), with
 * the move's `arc` (LastMoveMarkerProps.arc) so a knight's line follows its
 * arc. See LineStyle for the look; everything has a calm default.
 */
export const LastMoveLine = ({
  from,
  to,
  arc = 0,
  color = LINE_DEFAULTS.color,
  pulseColor,
  opacity = LINE_DEFAULTS.opacity,
  radius = LINE_DEFAULTS.radius,
  pattern = LINE_DEFAULTS.pattern,
  flowSpeed = LINE_DEFAULTS.flowSpeed,
  pulse = LINE_DEFAULTS.pulse,
  pulseLength = LINE_DEFAULTS.pulseLength,
  spacing,
  dash = LINE_DEFAULTS.dash,
  beadRadius,
  shade = LINE_DEFAULTS.shade,
  outline,
  outlineWidth,
  radialSegments = 8,
  drawInMs = 0,
  drawInDelayMs = 0,
  throughPiece = LINE_DEFAULTS.throughPiece,
  lift,
  segments,
}: LineStyle & { from: Vec3; to: Vec3; arc?: number }) => {
  const invalidate = useThree((s) => s.invalidate);
  const beadSize = beadRadius ?? radius * 2;
  // Clear of the platform, whatever the thickness
  const height = lift ?? (pattern === 'dotted' ? beadSize : radius) + 0.012;
  const gap = spacing ?? SPACING[pattern];
  const flow = prefersReducedMotion() ? 0 : flowSpeed;

  const keyline = outline && pattern !== 'dotted' ? (outlineWidth ?? radius * 0.6) : 0;
  const key = JSON.stringify([from, to, arc, height, segments, radius, radialSegments, pattern]);
  const { geometry, points, distances, length } = useMemo(() => {
    const points = tracePath(from, to, { lift: height, arc, segments });
    const distances = pathDistances(points);
    const length = distances[distances.length - 1];
    const geometry = pattern === 'dotted' ? null : tubeGeometry(points, radius, radialSegments);
    return { geometry, points, distances, length };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the values themselves
  }, [key]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  // The keyline: a slightly fatter tube showing only its far side, round the line
  const hull = useMemo(
    () => (keyline > 0 ? tubeGeometry(points, radius + keyline, radialSegments) : null),
    [points, radius, keyline, radialSegments],
  );
  useEffect(() => () => hull?.dispose(), [hull]);

  // The flow's clock: time on r3f's clock since the line appeared
  const clock = useMemo(() => ({ value: 0 }), []);
  const material = useMemo(() => lineMaterial(clock), [clock]);
  const hullMaterial = useMemo(() => {
    const m = lineMaterial(clock);
    m.side = BackSide;
    return m;
  }, [clock]);
  const through = useMemo(() => throughMaterial(material, clock), [material, clock]);
  useEffect(
    () => () => {
      material.dispose();
      hullMaterial.dispose();
      through.dispose();
    },
    [material, hullMaterial, through],
  );
  const u = material.uniforms;
  const h = hullMaterial.uniforms;
  (u.uColor.value as Color).set(color);
  if (pulseColor) (u.uPulseColor.value as Color).set(pulseColor);
  else (u.uPulseColor.value as Color).set(color).lerp(WHITE, 0.6);
  (h.uColor.value as Color).set(outline ?? color);
  for (const v of [u, h]) {
    v.uOpacity.value = opacity;
    v.uFlow.value = flow;
    v.uSpacing.value = gap;
    v.uDash.value = dash;
    v.uPattern.value = PATTERN_ID[pattern];
  }
  u.uShade.value = shade;
  u.uPulse.value = pulse;
  u.uPulseLength.value = pulseLength;
  h.uShade.value = 0;
  h.uPulse.value = 0;
  // The end of the line shows through the piece standing on the destination
  const shows = throughPiece > 0;
  through.uniforms.uThrough.value = throughPiece;
  (through.uniforms.uColumn.value as Vector3).set(to[0], to[1], to[2]);

  // Beads: as many as fit the line, plus one entering while another leaves
  const beads = useRef<InstancedMesh>(null);
  const throughBeads = useRef<InstancedMesh>(null);
  const beadCount = pattern === 'dotted' ? Math.max(1, Math.ceil(length / gap) + 1) : 0;
  const placeBeads = (revealed: number) => {
    const mesh = beads.current;
    if (!mesh) return;
    const cycle = beadCount * gap;
    const offset = (((clock.value * flow) % cycle) + cycle) % cycle;
    for (let k = 0; k < beadCount; k++) {
      const s = (k * gap + offset) % cycle;
      // Grow in at the source, shrink away past the destination's centre
      const grow = Math.min(s / (gap * 0.8), 1, Math.max((length - s) / (gap * 0.5), 0));
      const shown = s <= length && s <= revealed ? grow : 0;
      const { point } = pointAlong(points, Math.min(s, length), distances);
      const r = beadSize * Math.max(shown, 1e-4);
      matrix.makeScale(r, r, r).setPosition(point[0], point[1], point[2]);
      mesh.setMatrixAt(k, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    const other = throughBeads.current;
    if (other) {
      (other.instanceMatrix.array as Float32Array).set(mesh.instanceMatrix.array);
      other.instanceMatrix.needsUpdate = true;
    }
  };

  // How much of the line is drawn, from its source, as time since mounting
  // (below zero while it waits to start)
  const since = useRef(drawInMs > 0 ? -drawInDelayMs : Infinity);
  const reveal = () => {
    if (since.current >= drawInMs) return ALL;
    const k = since.current / drawInMs;
    return k < 0 ? -1 : (1 - (1 - k) ** 2) * length;
  };
  u.uReveal.value = h.uReveal.value = reveal();
  useLayoutEffect(() => placeBeads(reveal()));
  useEffect(() => invalidate(), [invalidate]);

  useFrame((_, delta) => {
    let moving = false;
    if (since.current < drawInMs) {
      since.current += Math.min(delta, 1 / 20) * 1000;
      moving = true;
    }
    if (flow !== 0) {
      // Clamped: the first frame after an idle stretch reports all of it
      clock.value += Math.min(delta, 1 / 20);
      moving = true;
    }
    u.uReveal.value = h.uReveal.value = reveal();
    if (pattern === 'dotted') placeBeads(reveal());
    if (moving) invalidate();
  });

  if (pattern === 'dotted') {
    return (
      <>
        <instancedMesh
          ref={(m) => {
            beads.current = m;
            m?.instanceMatrix.setUsage(DynamicDrawUsage);
          }}
          key={beadCount}
          args={[bead, material, beadCount]}
          renderOrder={LAYER.trace}
          raycast={noRaycast}
          frustumCulled={false}
        />
        {shows && (
          <instancedMesh
            ref={(m) => {
              throughBeads.current = m;
              m?.instanceMatrix.setUsage(DynamicDrawUsage);
            }}
            key={`through-${beadCount}`}
            args={[bead, through, beadCount]}
            renderOrder={LAYER.trace}
            raycast={noRaycast}
            frustumCulled={false}
          />
        )}
      </>
    );
  }
  return (
    <>
      {hull && (
        <mesh
          geometry={hull}
          material={hullMaterial}
          renderOrder={LAYER.trace}
          raycast={noRaycast}
          frustumCulled={false}
        />
      )}
      <mesh
        geometry={geometry!}
        material={material}
        // After its keyline, which it covers but for the rim
        renderOrder={LAYER.trace + 0.1}
        raycast={noRaycast}
        frustumCulled={false}
      />
      {shows && (
        <mesh
          geometry={geometry!}
          material={through}
          renderOrder={LAYER.trace + 0.1}
          raycast={noRaycast}
          frustumCulled={false}
        />
      )}
    </>
  );
};
