import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, DoubleSide, PlaneGeometry, ShaderMaterial } from 'three';
import { LAYER } from '../kit/layers';
import { LastMoveLine } from '../kit/line';
import { noRaycast } from '../kit/noRaycast';
import type { LastMoveMarkerProps, MarkerProps, Vec3 } from '../types';
import { pitch } from './layout';
import { CAPTURE, CHECK, INK, LASER, LASER_HOT } from './palette';

// Markers are projections on the tray, drawn as signed-distance shapes on one
// quad each, so they stay crisp at any angle:
//
// - a legal destination: a thin laser ring broken at its four diagonals, with
//   a hot core, a soft halo and a centre point (the laser's aiming dot);
// - a capture: the same ring, red, widened to go round the victim's base,
//   with two hazard-striped arcs;
// - the selection: four laser corner brackets framing the held piece's
//   square (a different shape from a destination, so a move straight up or
//   down still shows its own ring);
// - the last move: graphite ink, like a measured drawing: a dashed origin
//   circle where the piece left, a ring where it stands, and the kit's thin
//   line between them with a slow gleam running along it;
// - check: a red ring with a slow rotating beacon sweep inside it.

const KIND = { quiet: 0, capture: 1, selection: 2, from: 3, to: 4, check: 5 } as const;
type Kind = keyof typeof KIND;

const vertexShader = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const fragmentShader = /* glsl */ `
  uniform int uKind;
  uniform vec3 uColor;
  uniform vec3 uHot;
  uniform float uHover;
  uniform float uTime;
  uniform float uPitch;
  varying vec2 vP;

  const float TAU = 6.2831853;
  float stroke(float d, float w) {
    float fw = max(fwidth(d), 1e-4);
    float hw = max(w, fw * 0.5);
    return (1.0 - smoothstep(hw - fw * 0.5, hw + fw * 0.5, d)) * min(1.0, w / (fw * 0.5));
  }
  // Distance along the ring from the nearest of n evenly spaced angles (offset by phase)
  float fromSpokes(float ang, float n, float phase, float r) {
    float step = TAU / n;
    return abs(mod(ang - phase + step * 0.5, step) - step * 0.5) * r;
  }

  void main() {
    vec2 p = vP / uPitch;
    float r = length(p);
    float ang = atan(p.y, p.x);
    vec3 col = uColor;
    float a = 0.0;

    if (uKind == 0 || uKind == 1) {
      bool capture = uKind == 1;
      float R = (capture ? 0.37 : 0.3) + 0.03 * uHover;
      float d = abs(r - R);
      float gaps = smoothstep(0.018, 0.034, fromSpokes(ang, 4.0, 0.7853982, R));
      float line = stroke(d, 0.016 + 0.006 * uHover) * gaps;
      float core = stroke(d, 0.005) * gaps;
      float halo = exp(-(d * d) / (0.035 * 0.035)) * (0.2 + 0.12 * uHover);
      float aim = capture ? 0.0 : stroke(r, 0.028 + 0.012 * uHover) * 0.85;
      float fill = (1.0 - smoothstep(R - 0.02, R, r)) * 0.2 * uHover;
      a = max(max(line, halo), max(aim, fill));
      col = mix(uColor, uHot, max(core, aim) * 0.55);
      if (capture) {
        // Two hazard arcs, front-left and back-right, striped red and white
        float arc = min(fromSpokes(ang, 2.0, 2.3561945, R), 10.0);
        float inArc = 1.0 - smoothstep(0.2, 0.215, arc);
        float band = 1.0 - smoothstep(0.03 - fwidth(r), 0.03 + fwidth(r), abs(r - R - 0.035));
        float stripes = step(0.5, fract((ang * R - (r - R)) / 0.055));
        float hz = band * inArc;
        a = max(a, hz);
        col = mix(col, mix(uColor, vec3(1.0), stripes * 0.92), hz);
        // Keep the arc's edge red, so the white stripes read as a band
        float edge = stroke(abs(abs(r - R - 0.035) - 0.03), 0.004) * inArc;
        col = mix(col, uColor, edge);
        a = max(a, edge);
      }
    } else if (uKind == 2) {
      // The selection: four corner brackets framing the square (never a ring,
      // so a move straight up or down still shows its own ring inside)
      vec2 q = abs(p);
      float H = 0.44;
      float arm = 0.14;
      float bx = stroke(abs(q.x - H), 0.009) * step(H - arm, q.y) * step(q.y, H + 0.009);
      float by = stroke(abs(q.y - H), 0.009) * step(H - arm, q.x) * step(q.x, H + 0.009);
      float line = max(bx, by);
      float glow = exp(-pow(min(abs(q.x - H), abs(q.y - H)) / 0.025, 2.0)) * 0.2 *
        step(H - arm, min(q.x, q.y));
      a = max(line, glow);
      col = mix(uColor, uHot, line * 0.3);
    } else if (uKind == 3) {
      float R = 0.2;
      float dash = step(0.5, fract(ang / TAU * 14.0));
      a = max(stroke(abs(r - R), 0.008) * dash, stroke(r, 0.022));
      a *= 0.9;
    } else if (uKind == 4) {
      float R = 0.4;
      float ticks = stroke(fromSpokes(ang, 4.0, 0.7853982, 1.0) * r, 0.007) * step(R, r) * step(r, R + 0.06);
      a = max(stroke(abs(r - R), 0.008), ticks) * 0.9;
    } else {
      // Check: a red ring, a faint wash, and two beacon lamps sweeping slowly round
      float R = 0.41;
      float line = stroke(abs(r - R), 0.016);
      float lag = mod(uTime * 2.1 - ang, TAU * 0.5);
      float sweep = exp(-lag * 2.4) * smoothstep(0.08, 0.16, r) * (1.0 - smoothstep(R - 0.02, R, r));
      float wash = (1.0 - smoothstep(R - 0.02, R, r)) * 0.1;
      a = max(line, max(wash, sweep * 0.42));
      col = mix(uColor, uHot, sweep * 0.3);
    }
    if (a < 0.004) discard;
    gl_FragColor = vec4(col, min(a, 1.0));
    #include <colorspace_fragment>
  }`;

const plane = new PlaneGeometry(pitch, pitch);
// Every animated marker reads one clock
const clock = { value: 0 };

const useMarkerMaterial = (kind: Kind, color: string, hot: string) => {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        uniforms: {
          uKind: { value: KIND[kind] },
          uColor: { value: new Color(color) },
          uHot: { value: new Color(hot) },
          uHover: { value: 0 },
          uTime: clock,
          uPitch: { value: pitch },
        },
        vertexShader,
        fragmentShader,
      }),
    [kind, color, hot],
  );
  useEffect(() => () => material.dispose(), [material]);
  return material;
};

const Mark = ({
  kind,
  floor,
  color,
  hot = color,
  hovered = false,
}: {
  kind: Kind;
  floor: Vec3;
  color: string;
  hot?: string;
  hovered?: boolean;
}) => {
  const material = useMarkerMaterial(kind, color, hot);
  material.uniforms.uHover.value = hovered ? 1 : 0;
  return (
    <mesh
      geometry={plane}
      material={material}
      position={[floor[0], floor[1] + 0.012, floor[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={LAYER.marker}
      raycast={noRaycast}
    />
  );
};

const Quiet = ({ floor, hovered }: MarkerProps) => (
  <Mark kind="quiet" floor={floor} color={LASER} hot={LASER_HOT} hovered={hovered} />
);

const Capture = ({ floor, hovered }: MarkerProps) => (
  <Mark kind="capture" floor={floor} color={CAPTURE} hot="#ff6a55" hovered={hovered} />
);

const Selection = ({ floor }: MarkerProps) => (
  <Mark kind="selection" floor={floor} color={LASER} hot={LASER_HOT} />
);

const LastMove = ({ from, to, fresh = false, arc = 0 }: LastMoveMarkerProps) => (
  <>
    <Mark kind="from" floor={from.floor} color={INK} />
    <Mark kind="to" floor={to.floor} color={INK} />
    <LastMoveLine
      from={from.floor}
      to={to.floor}
      arc={arc}
      color={INK}
      pulseColor="#a9bccf"
      radius={0.011}
      pulse={0.75}
      pulseLength={0.22}
      spacing={1.5}
      flowSpeed={0.45}
      shade={0.25}
      drawInMs={fresh ? 360 : 0}
    />
  </>
);

/** The beacon turns while it is up (a slow sweep; the board is waiting on a reply). */
const Check = ({ floor }: MarkerProps) => {
  const invalidate = useThree((s) => s.invalidate);
  useFrame((state) => {
    clock.value = state.clock.elapsedTime;
    invalidate();
  });
  return <Mark kind="check" floor={floor} color={CHECK} hot="#ff8a7a" />;
};

export const markers = { Quiet, Capture, Selection, LastMove, Check };
